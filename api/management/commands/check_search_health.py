from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import TransportError


class Command(BaseCommand):
    help = "Check Elasticsearch cluster health."

    def add_arguments(self, parser):
        parser.add_argument(
            "--timeout",
            type=float,
            default=5.0,
            help="Request timeout in seconds.",
        )

    def handle(self, *args, **options):
        config = settings.ELASTICSEARCH_DSL.get("default", {})
        hosts = config.get("hosts") or "http://localhost:9200"
        if isinstance(hosts, str):
            hosts = [hosts]

        client = Elasticsearch(hosts)
        try:
            response = client.cluster.health(
                request_timeout=options["timeout"])
        except TransportError as exc:
            raise CommandError(
                f"Elasticsearch health check failed: {exc}") from exc

        status = response.get("status")
        self.stdout.write(self.style.SUCCESS(f"Cluster status: {status}"))
        if status not in {"green", "yellow"}:
            raise CommandError(f"Cluster status is {status}")
