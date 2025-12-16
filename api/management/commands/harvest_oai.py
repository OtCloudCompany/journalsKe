import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, time, timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse, urlunparse
from xml.etree import ElementTree as ET

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from api.harvesting.logging import HarvestLogWriter
from api.models import Journal, Publication
from api.oai import OAI_NAMESPACES, fetch_oai_response
from api.search.publication_index import PublicationDocument
from api.serializers import PublicationSerializer

logger = logging.getLogger(__name__)


@dataclass
class HarvestSummary:
    created: int = 0
    updated: int = 0

    @property
    def harvested(self) -> int:
        return self.created + self.updated


class HarvestExecutionError(Exception):
    def __init__(self, message: str, *, summary: Optional[HarvestSummary] = None):
        super().__init__(message)
        self.summary = summary or HarvestSummary()


class Command(BaseCommand):
    help = "Harvest Dublin Core metadata via OAI-PMH for one or more journals."

    def add_arguments(self, parser):
        parser.add_argument(
            "journal_slug",
            nargs="?",
            help="Slug of the journal to harvest. If omitted, all journals with an OAI URL are processed.",
        )
        parser.add_argument(
            "--from-date",
            dest="from_date",
            help="Override the OAI 'from' parameter (ISO-8601). Defaults to the journal's last harvested timestamp.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of records to harvest (useful for testing).",
        )

    def handle(self, *args, **options):
        slug = options.get("journal_slug")
        from_override = options.get("from_date")
        limit = options.get("limit")

        if slug:
            journals = Journal.objects.filter(slug=slug)
            if not journals.exists():
                raise CommandError(f"Journal '{slug}' was not found.")
        else:
            journals = Journal.objects.exclude(
                oai_url__isnull=True).exclude(oai_url="")

        if not journals.exists():
            raise CommandError(
                "No journals with an OAI-PMH URL are available to harvest.")

        total_created = 0
        total_updated = 0
        for journal in journals:
            log_writer = HarvestLogWriter.start(
                journal=journal, endpoint=journal.oai_url)
            summary: Optional[HarvestSummary] = None
            try:
                summary = self._harvest_journal(journal, from_override, limit)
            except HarvestExecutionError as exc:
                failure_summary = exc.summary
                log_writer.mark_failure(str(exc), failure_summary.harvested)
                self.stderr.write(
                    self.style.ERROR(
                        f"{journal.name}: {exc}"
                    )
                )
                continue
            except Exception as exc:  # pylint: disable=broad-except
                log_writer.mark_failure(str(exc))
                logger.exception(
                    "Unexpected error while harvesting journal %s", journal)
                self.stderr.write(
                    self.style.ERROR(
                        f"{journal.name}: unexpected error during harvest: {exc}"
                    )
                )
                continue
            else:
                log_writer.mark_success(summary.harvested)
                total_created += summary.created
                total_updated += summary.updated
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{journal.name}: harvested {summary.created} new, {summary.updated} updated publications."
                    )
                )
            finally:
                if summary is not None:
                    log_writer.ensure_closed(summary.harvested)
                else:
                    log_writer.ensure_closed()

        self.stdout.write(
            self.style.SUCCESS(
                f"Harvest complete. {total_created} new and {total_updated} updated publications processed."
            )
        )

    def _harvest_journal(
        self,
        journal: Journal,
        from_override: Optional[str],
        record_limit: Optional[int],
    ) -> HarvestSummary:
        if not journal.oai_url:
            raise HarvestExecutionError(
                f"Journal '{journal}' does not have an OAI-PMH URL configured.")

        base_url, base_params = self._prepare_oai_endpoint(journal.oai_url)
        since = self._parse_oai_datestamp(
            from_override) if from_override else journal.last_harvested_at
        if since:
            base_params["from"] = self._format_oai_datestamp(since)
        if "metadataPrefix" not in base_params:
            base_params["metadataPrefix"] = "oai_dc"
        if base_params.get("verb") is None:
            base_params["verb"] = "ListRecords"

        created = 0
        updated = 0
        processed = 0
        latest_datestamp = journal.last_harvested_at
        publication_ids: List[str] = []
        resumption_token: Optional[str] = None
        params = dict(base_params)

        try:
            while True:
                if resumption_token:
                    params = {"verb": "ListRecords",
                              "resumptionToken": resumption_token}
                else:
                    params = dict(base_params)
                try:
                    xml_payload = self._fetch_oai_response(base_url, params)
                except (HTTPError, URLError) as exc:
                    raise HarvestExecutionError(
                        f"Failed to harvest '{journal.name}': {exc}",
                        summary=HarvestSummary(
                            created=created, updated=updated),
                    ) from exc

                records, resumption_token = self._parse_oai_records(
                    xml_payload)
                if not records and not resumption_token:
                    break

                for record in records:
                    if record_limit is not None and processed >= record_limit:
                        resumption_token = None
                        break

                    identifier = record.get("identifier")
                    if not identifier:
                        logger.warning(
                            "Skipping record with missing identifier for journal %s", journal)
                        processed += 1
                        continue

                    datestamp = self._parse_oai_datestamp(
                        record.get("datestamp"))
                    publication = Publication.objects.filter(
                        oai_identifier=identifier).first()
                    was_existing = publication is not None
                    if (
                        was_existing
                        and datestamp
                        and publication.oai_datestamp
                        and datestamp <= publication.oai_datestamp
                    ):
                        processed += 1
                        continue

                    payload = self._build_publication_payload(record)
                    if not payload:
                        processed += 1
                        continue

                    try:
                        with transaction.atomic():
                            serializer = PublicationSerializer(
                                instance=publication, data=payload)
                            serializer.is_valid(raise_exception=True)
                            publication = serializer.save()
                            update_fields = ["journal", "oai_datestamp"]
                            publication.journal = journal
                            publication.oai_datestamp = datestamp
                            if identifier:
                                publication.oai_identifier = identifier
                                update_fields.append("oai_identifier")
                            publication.save(update_fields=update_fields)
                    except Exception as exc:  # pylint: disable=broad-except
                        logger.exception(
                            "Failed to persist OAI record %s: %s", identifier, exc)
                        processed += 1
                        continue

                    if publication.oai_datestamp and (
                        latest_datestamp is None or publication.oai_datestamp > latest_datestamp
                    ):
                        latest_datestamp = publication.oai_datestamp

                    publication_ids.append(str(publication.pk))
                    if was_existing:
                        updated += 1
                    else:
                        created += 1
                    processed += 1

                if not resumption_token:
                    break
        except HarvestExecutionError:
            raise
        except Exception as exc:  # pylint: disable=broad-except
            raise HarvestExecutionError(
                f"Unexpected error while harvesting '{journal.name}': {exc}",
                summary=HarvestSummary(created=created, updated=updated),
            ) from exc

        if latest_datestamp and latest_datestamp != journal.last_harvested_at:
            journal.last_harvested_at = latest_datestamp
            journal.save(update_fields=["last_harvested_at"])

        if publication_ids:
            queryset = Publication.objects.filter(pk__in=publication_ids)
            PublicationDocument().update(queryset)

        return HarvestSummary(created=created, updated=updated)

    def _prepare_oai_endpoint(self, oai_url: str) -> Tuple[str, Dict[str, str]]:
        parsed = urlparse(oai_url)
        base_url = urlunparse(
            (parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
        params = {key: values[-1] for key,
                  values in parse_qs(parsed.query).items() if values}
        return base_url, params

    def _fetch_oai_response(self, base_url: str, params: Dict[str, str]) -> str:
        # Delegate to shared helper so API tests can reuse consistent behaviour.
        return fetch_oai_response(base_url, params, timeout=60)

    def _parse_oai_records(self, xml_payload: str) -> Tuple[List[Dict[str, object]], Optional[str]]:
        try:
            root = ET.fromstring(xml_payload)
        except ET.ParseError as exc:  # pragma: no cover - defensive
            raise CommandError(f"Could not parse OAI response: {exc}") from exc

        records: List[Dict[str, object]] = []
        for record in root.findall(".//oai:record", OAI_NAMESPACES):
            header = record.find("oai:header", OAI_NAMESPACES)
            if header is None or header.get("status") == "deleted":
                continue

            metadata = record.find("oai:metadata", OAI_NAMESPACES)
            if metadata is None:
                continue

            dc_node = metadata.find("oai_dc:dc", OAI_NAMESPACES)
            if dc_node is None:
                continue

            values: Dict[str, List[str]] = defaultdict(list)
            for child in list(dc_node):
                text = (child.text or "").strip()
                if not text:
                    continue
                local_name = child.tag.split("}")[-1].lower()
                values[local_name].append(text)

            records.append(
                {
                    "identifier": header.findtext("oai:identifier", default="", namespaces=OAI_NAMESPACES),
                    "datestamp": header.findtext("oai:datestamp", default="", namespaces=OAI_NAMESPACES),
                    "values": values,
                }
            )

        resumption = root.findtext(
            ".//oai:resumptionToken", default="", namespaces=OAI_NAMESPACES) or None
        if resumption:
            resumption = resumption.strip() or None
        return records, resumption

    def _build_publication_payload(self, record: Dict[str, object]) -> Optional[Dict[str, object]]:
        values: Dict[str, List[str]] = record.get(
            "values", {})  # type: ignore[assignment]
        if not isinstance(values, dict):
            return None

        title = self._first(values.get("title"))
        if not title:
            return None

        description = "\n\n".join(values.get("description", []))
        publisher = self._first(values.get("publisher")) or ""
        resource_type = self._first(values.get("type")) or ""
        resource_format = self._first(values.get("format")) or ""
        rights = "\n".join(values.get("rights", []))
        issued_str = self._first(values.get("date"))
        issued = self._parse_date_only(issued_str)

        metadata_entries: List[Dict[str, object]] = []
        position = 0

        def extend_metadata(element: str, entries: Iterable[str]):
            nonlocal position
            for entry in entries:
                cleaned = entry.strip()
                if not cleaned:
                    continue
                metadata_entries.append(
                    {
                        "schema": "dc",
                        "element": element,
                        "qualifier": "",
                        "value": cleaned,
                        "language": "",
                        "position": position,
                    }
                )
                position += 1

        extend_metadata("creator", values.get("creator", []))
        extend_metadata("contributor", values.get("contributor", []))
        extend_metadata("subject", values.get("subject", []))
        extend_metadata("identifier", values.get("identifier", []))
        extend_metadata("language", values.get("language", []))
        extend_metadata("relation", values.get("relation", []))
        extend_metadata("coverage", values.get("coverage", []))
        extend_metadata("source", values.get("source", []))

        additional_dates = values.get("date", [])[1:]
        extend_metadata("date", additional_dates)

        payload: Dict[str, object] = {
            "title": title,
            "description": description,
            "publisher": publisher,
            "issued": issued.isoformat() if issued else None,
            "resource_type": resource_type,
            "resource_format": resource_format,
            "rights": rights,
            "metadata": metadata_entries,
        }
        return payload

    def _parse_oai_datestamp(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        dt = parse_datetime(value)
        if dt is None:
            parsed_date = parse_date(value)
            if parsed_date is None:
                return None
            dt = datetime.combine(parsed_date, time.min)
        if timezone.is_naive(dt):
            dt = dt.replace(tzinfo=dt_timezone.utc)
        else:
            dt = dt.astimezone(dt_timezone.utc)
        return dt.replace(microsecond=0)

    def _format_oai_datestamp(self, value: datetime) -> str:
        if timezone.is_naive(value):
            value = value.replace(tzinfo=dt_timezone.utc)
        dt_utc = value.astimezone(dt_timezone.utc).replace(microsecond=0)
        return dt_utc.isoformat().replace("+00:00", "Z")

    def _parse_date_only(self, value: Optional[str]):
        if not value:
            return None
        parsed_date = parse_date(value)
        return parsed_date

    @staticmethod
    def _first(values: Optional[Iterable[str]]) -> Optional[str]:
        if not values:
            return None
        for value in values:
            if value:
                return value.strip()
        return None
