from elasticsearch_dsl import analyzer, Document, fields, Index

standard_text_analyzer = analyzer(
    'standard_text',
    type='standard',
    stopwords='_none_'
)

class PublicationDocument(Document):
    title = fields.TextField(analyzer=standard_text_analyzer)

    class Index:
        name = "publications"
        settings = {
            "number_of_shards": 1,
            "number_of_replicas": 0,
        }

if __name__ == "__main__":
    print(PublicationDocument._index.to_dict())
