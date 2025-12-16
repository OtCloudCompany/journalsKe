from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone

from api.models import Journal, OAIHarvestLog


@dataclass
class HarvestLogContext:
    """State shared with the harvest command while a run is active."""

    journal: Journal
    entry: OAIHarvestLog

    def mark_success(self, record_count: int) -> None:
        if record_count < 0:
            record_count = 0
        self.entry.mark_success(record_count)

    def mark_failure(self, reason: str, record_count: int = 0) -> None:
        if record_count < 0:
            record_count = 0
        self.entry.mark_failure(reason, record_count)

    @property
    def is_closed(self) -> bool:
        return self.entry.status in {
            OAIHarvestLog.Status.SUCCESS,
            OAIHarvestLog.Status.FAILED,
        }


class HarvestLogWriter:
    """Helper responsible for persisting OAI harvest attempts."""

    def __init__(self, context: HarvestLogContext):
        self._context = context

    @classmethod
    def start(cls, *, journal: Journal, endpoint: str | None = None) -> "HarvestLogWriter":
        resolved_endpoint = endpoint or journal.oai_url or ""
        entry = OAIHarvestLog.objects.create(
            journal=journal,
            endpoint=resolved_endpoint,
            started_at=timezone.now(),
            status=OAIHarvestLog.Status.RUNNING,
        )
        return cls(HarvestLogContext(journal=journal, entry=entry))

    @property
    def entry(self) -> OAIHarvestLog:
        return self._context.entry

    def mark_success(self, record_count: int) -> None:
        if not self._context.is_closed:
            self._context.mark_success(record_count)

    def mark_failure(self, reason: str, record_count: int = 0) -> None:
        if not self._context.is_closed:
            self._context.mark_failure(reason, record_count)

    def ensure_closed(self, record_count: int = 0) -> None:
        if not self._context.is_closed:
            # Default to success if nothing else was recorded, matching previous behaviour
            self._context.mark_success(record_count)
