from django.db import migrations


def add_core_publication_metadata(apps, schema_editor):
    Publication = apps.get_model("api", "Publication")
    PublicationMetadata = apps.get_model("api", "PublicationMetadata")

    field_specs = (
        (
            "title",
            "dc",
            "title",
            "",
            lambda publication: (
                getattr(publication, "title", "") or "").strip(),
        ),
        (
            "description",
            "dc",
            "description",
            "",
            lambda publication: (
                getattr(publication, "description", "") or "").strip(),
        ),
        (
            "publisher",
            "dc",
            "publisher",
            "",
            lambda publication: (
                getattr(publication, "publisher", "") or "").strip(),
        ),
        (
            "resource_type",
            "dc",
            "type",
            "",
            lambda publication: (
                getattr(publication, "resource_type", "") or "").strip(),
        ),
        (
            "resource_format",
            "dc",
            "format",
            "",
            lambda publication: (
                getattr(publication, "resource_format", "") or "").strip(),
        ),
        (
            "issued",
            "dc",
            "date",
            "issued",
            lambda publication: getattr(publication, "issued", None),
        ),
        (
            "rights",
            "dc",
            "rights",
            "",
            lambda publication: (
                getattr(publication, "rights", "") or "").strip(),
        ),
    )

    batch = []
    batch_size = 500

    for publication in Publication.objects.all().iterator():
        existing_count = PublicationMetadata.objects.filter(
            publication=publication
        ).count()
        position = existing_count

        for attr_name, schema, element, qualifier, extractor in field_specs:
            raw_value = extractor(publication)
            if raw_value in (None, ""):
                continue

            if schema == "dc" and element == "date" and qualifier == "issued":
                value = raw_value.isoformat() if hasattr(
                    raw_value, "isoformat") else str(raw_value)
            else:
                value = str(raw_value).strip()

            if not value:
                continue

            exists = PublicationMetadata.objects.filter(
                publication=publication,
                schema__iexact=schema,
                element__iexact=element,
                qualifier__iexact=(qualifier or ""),
            ).exists()
            if exists:
                continue

            batch.append(
                PublicationMetadata(
                    publication=publication,
                    schema=schema,
                    element=element,
                    qualifier=qualifier or "",
                    value=value,
                    language="",
                    position=position,
                )
            )
            position += 1

            if len(batch) >= batch_size:
                PublicationMetadata.objects.bulk_create(batch)
                batch = []

    if batch:
        PublicationMetadata.objects.bulk_create(batch)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0007_publicationmetadata"),
    ]

    operations = [
        migrations.RunPython(add_core_publication_metadata,
                             migrations.RunPython.noop),
    ]
