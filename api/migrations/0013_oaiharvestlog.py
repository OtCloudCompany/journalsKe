from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_researcher_profiles"),
    ]

    operations = [
        migrations.CreateModel(
            name="OAIHarvestLog",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("started_at", models.DateTimeField(
                    default=django.utils.timezone.now)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("endpoint", models.URLField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("running", "Running"),
                            ("success", "Success"),
                            ("failed", "Failed"),
                        ],
                        default="running",
                        max_length=16,
                    ),
                ),
                ("record_count", models.PositiveIntegerField(default=0)),
                ("error_message", models.TextField(blank=True)),
                (
                    "journal",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="harvest_logs",
                        to="api.journal",
                    ),
                ),
            ],
            options={
                "verbose_name": "OAI harvest log",
                "verbose_name_plural": "OAI harvest logs",
                "ordering": ("-started_at", "-id"),
            },
        ),
    ]
