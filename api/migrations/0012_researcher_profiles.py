# Generated manually by GPT-5-Codex on 2025-12-12
from __future__ import annotations

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_publication_journal_oai_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="ResearcherProfile",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4,
                 editable=False, primary_key=True, serialize=False)),
                ("slug", models.SlugField(editable=False, max_length=255, unique=True)),
                ("title", models.CharField(blank=True, max_length=64)),
                ("display_name", models.CharField(max_length=255)),
                ("institutional_email", models.EmailField(
                    max_length=254, unique=True)),
                ("institutional_email_verified",
                 models.BooleanField(default=False)),
                ("institutional_email_verified_at",
                 models.DateTimeField(blank=True, null=True)),
                ("affiliation", models.CharField(blank=True, max_length=255)),
                ("current_position", models.CharField(blank=True, max_length=255)),
                ("short_bio", models.TextField(blank=True)),
                ("research_interests", models.TextField(blank=True)),
                ("google_scholar_url", models.URLField(blank=True)),
                ("linkedin_url", models.URLField(blank=True)),
                ("orcid", models.CharField(blank=True, max_length=64)),
                ("personal_website", models.URLField(blank=True)),
                ("profile_photo", models.ImageField(blank=True,
                 null=True, upload_to="researchers/photos/")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="researcher_profile",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ("display_name",),
                "verbose_name": "Researcher profile",
                "verbose_name_plural": "Researcher profiles",
            },
        ),
        migrations.CreateModel(
            name="ResearcherExperience",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("employer", models.CharField(max_length=255)),
                ("role", models.CharField(max_length=255)),
                ("start_date", models.DateField(blank=True, null=True)),
                ("end_date", models.DateField(blank=True, null=True)),
                ("is_current", models.BooleanField(default=False)),
                ("description", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="experiences",
                        to="api.researcherprofile",
                    ),
                ),
            ],
            options={
                "verbose_name": "Researcher experience",
                "verbose_name_plural": "Researcher experiences",
                "ordering": ("-is_current", "-start_date", "-end_date", "-id"),
            },
        ),
        migrations.CreateModel(
            name="ResearcherPublication",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("contribution", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="researcher_publications",
                        to="api.researcherprofile",
                    ),
                ),
                (
                    "publication",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="researcher_links",
                        to="api.publication",
                    ),
                ),
            ],
            options={
                "verbose_name": "Researcher publication link",
                "verbose_name_plural": "Researcher publication links",
                "ordering": ("publication__title",),
            },
        ),
        migrations.AddField(
            model_name="researcherprofile",
            name="publications",
            field=models.ManyToManyField(
                blank=True,
                related_name="researchers",
                through="api.ResearcherPublication",
                to="api.publication",
            ),
        ),
        migrations.AlterUniqueTogether(
            name="researcherpublication",
            unique_together={("profile", "publication")},
        ),
        migrations.CreateModel(
            name="ResearcherInstitutionalEmailToken",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                ("email", models.EmailField(max_length=254)),
                ("token", models.CharField(
                    editable=False, max_length=128, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("is_used", models.BooleanField(default=False)),
                (
                    "profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="institutional_email_tokens",
                        to="api.researcherprofile",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="researcherinstitutionalemailtoken",
            index=models.Index(fields=("token",),
                               name="api_research_token_9abf4f_idx"),
        ),
        migrations.AddIndex(
            model_name="researcherinstitutionalemailtoken",
            index=models.Index(
                fields=("profile", "is_used"), name="api_research_profile__03fb7f_idx"
            ),
        ),
    ]
