from django.db import migrations, models


def forwards(apps, schema_editor):
    Publication = apps.get_model("api", "Publication")
    PublicationMetadata = apps.get_model("api", "PublicationMetadata")

    field_map = (
        ("creator", "creator", None),
        ("subject", "subject", None),
        ("contributor", "contributor", None),
        ("identifier", "identifier", None),
        ("source", "source", None),
        ("language", "language", None),
        ("relation", "relation", None),
        ("coverage", "coverage", None),
    )

    batch = []
    for publication in Publication.objects.all():
        position = 0
        for field_name, element, qualifier in field_map:
            values = getattr(publication, field_name, None)
            if values in (None, ""):
                continue
            if isinstance(values, str):
                values = [values]
            for value in values:
                if value in (None, ""):
                    continue
                if isinstance(value, str):
                    normalized = value.strip()
                else:
                    normalized = str(value).strip()
                if not normalized:
                    continue
                batch.append(
                    PublicationMetadata(
                        publication=publication,
                        schema="dc",
                        element=element,
                        qualifier=qualifier or "",
                        value=normalized,
                        language="",
                        position=position,
                    )
                )
                position += 1
        if len(batch) >= 500:
            PublicationMetadata.objects.bulk_create(batch)
            batch = []

    if batch:
        PublicationMetadata.objects.bulk_create(batch)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0006_merge_20251211_1345"),
    ]

    operations = [
        migrations.CreateModel(
            name="PublicationMetadata",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("schema", models.CharField(default="dc", max_length=32)),
                ("element", models.CharField(max_length=64)),
                ("qualifier", models.CharField(blank=True, max_length=64)),
                ("value", models.TextField()),
                ("language", models.CharField(blank=True, max_length=16)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("publication", models.ForeignKey(on_delete=models.CASCADE,
                 related_name="metadata_entries", to="api.publication")),
            ],
            options={
                "ordering": ("position", "id"),
            },
        ),
        migrations.AddIndex(
            model_name="publicationmetadata",
            index=models.Index(fields=("publication", "schema", "element",
                               "qualifier"), name="api_publica_public_30de68_idx"),
        ),
        migrations.AddIndex(
            model_name="publicationmetadata",
            index=models.Index(fields=(
                "schema", "element", "qualifier"), name="api_publica_schema_0125f0_idx"),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.RemoveField(model_name="publication", name="contributor"),
        migrations.RemoveField(model_name="publication", name="coverage"),
        migrations.RemoveField(model_name="publication", name="creator"),
        migrations.RemoveField(model_name="publication", name="identifier"),
        migrations.RemoveField(model_name="publication", name="language"),
        migrations.RemoveField(model_name="publication", name="relation"),
        migrations.RemoveField(model_name="publication", name="source"),
        migrations.RemoveField(model_name="publication", name="subject"),
    ]
