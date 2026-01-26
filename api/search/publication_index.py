from django_elasticsearch_dsl import Document, fields
from django_elasticsearch_dsl.registries import registry
from elasticsearch_dsl import analyzer

from ..models import Publication

# Define the analyzer explicitly using elasticsearch_dsl
standard_text_analyzer = analyzer(
    'standard_text',
    type='standard',
    stopwords='_none_'
)

@registry.register_document
class PublicationDocument(Document):
    title = fields.TextField(analyzer=standard_text_analyzer)
    description = fields.TextField(analyzer=standard_text_analyzer)
    publisher = fields.TextField(analyzer=standard_text_analyzer)
    resource_type = fields.KeywordField()
    resource_format = fields.KeywordField()
    rights = fields.TextField(analyzer=standard_text_analyzer)
    slug = fields.KeywordField()
    issued = fields.DateField()
    created_at = fields.DateField()
    updated_at = fields.DateField()
    journal_slug = fields.KeywordField()
    journal_name = fields.TextField(
        analyzer=standard_text_analyzer,
        fields={"raw": fields.KeywordField()}
    )

    creator = fields.TextField(
        analyzer=standard_text_analyzer,
        multi=True,
        fields={"raw": fields.KeywordField()}
    )
    contributor = fields.TextField(analyzer=standard_text_analyzer, multi=True)
    subject = fields.TextField(
        analyzer=standard_text_analyzer,
        multi=True,
        fields={"raw": fields.KeywordField()}
    )
    identifier = fields.KeywordField(multi=True)
    source = fields.TextField(analyzer=standard_text_analyzer, multi=True)
    language = fields.KeywordField(multi=True)
    relation = fields.TextField(analyzer=standard_text_analyzer, multi=True)
    coverage = fields.TextField(analyzer=standard_text_analyzer, multi=True)
    metadata_text = fields.TextField(analyzer=standard_text_analyzer, multi=True)
    metadata = fields.NestedField(
        properties={
            "schema": fields.KeywordField(),
            "element": fields.KeywordField(),
            "qualifier": fields.KeywordField(),
            "value": fields.TextField(analyzer=standard_text_analyzer),
            "language": fields.KeywordField(),
            "position": fields.IntegerField(),
        },
        multi=True,
    )

    class Index:
        name = "publications"
        settings = {
            "number_of_shards": 1,
            "number_of_replicas": 0,
        }

    class Django:
        model = Publication
        fields = ()
        ignore_signals = False
        auto_refresh = True
        queryset_pagination = 100

    def get_queryset(self):
        return super().get_queryset().prefetch_related("metadata_entries")

    def prepare_creator(self, instance: Publication):
        return instance.metadata_values("creator")

    def prepare_contributor(self, instance: Publication):
        return instance.metadata_values("contributor")

    def prepare_subject(self, instance: Publication):
        return instance.metadata_values("subject")

    def prepare_identifier(self, instance: Publication):
        return instance.metadata_values("identifier")

    def prepare_source(self, instance: Publication):
        return instance.metadata_values("source")

    def prepare_language(self, instance: Publication):
        return instance.metadata_values("language")

    def prepare_relation(self, instance: Publication):
        return instance.metadata_values("relation")

    def prepare_coverage(self, instance: Publication):
        return instance.metadata_values("coverage")

    def prepare_metadata_text(self, instance: Publication):
        return [entry.value for entry in instance.metadata_entries.all()]

    def prepare_metadata(self, instance: Publication):
        return [
            {
                "schema": entry.schema,
                "element": entry.element,
                "qualifier": entry.qualifier,
                "value": entry.value,
                "language": entry.language,
                "position": entry.position,
            }
            for entry in instance.metadata_entries.all()
        ]

    def prepare_journal_slug(self, instance: Publication):
        return instance.journal.slug if instance.journal else None

    def prepare_journal_name(self, instance: Publication):
        return instance.journal.name if instance.journal else None
