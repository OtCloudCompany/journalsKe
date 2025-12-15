import logging

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger(__name__)


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        super().ready()
        self._init_search_indexes()

    def _init_search_indexes(self) -> None:
        search_settings = getattr(settings, "ELASTICSEARCH_DSL", None)
        if not search_settings:
            return

        default_alias = search_settings.get("default")
        if not default_alias:
            return

        try:
            from elastic_transport import ConnectionError as ElasticConnectionError  # type: ignore
        except ImportError:  # pragma: no cover - elasticsearch optional
            ElasticConnectionError = Exception  # type: ignore[misc]

        try:
            from elasticsearch import ElasticsearchException  # type: ignore
        except ImportError:  # pragma: no cover - elasticsearch optional
            ElasticsearchException = Exception  # type: ignore[misc]

        try:
            from .search.publication_index import PublicationDocument

            PublicationDocument.init()
        except (ElasticConnectionError, ElasticsearchException) as exc:
            logger.warning(
                "Skipping Elasticsearch index initialisation: %s", exc)
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.warning(
                "Unexpected error initialising search indexes: %s", exc)
