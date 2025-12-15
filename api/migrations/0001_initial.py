# Generated manually for Journals KE user module
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4,
                 editable=False, primary_key=True, serialize=False)),
                ("password", models.CharField(
                    max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(
                    blank=True, null=True, verbose_name="last login")),
                ("email", models.EmailField(max_length=254, unique=True)),
                ("first_name", models.CharField(blank=True, max_length=150)),
                ("last_name", models.CharField(blank=True, max_length=150)),
                ("is_active", models.BooleanField(default=False)),
                ("is_staff", models.BooleanField(default=False)),
                ("is_verified", models.BooleanField(default=False)),
                ("date_joined", models.DateTimeField(
                    default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "is_superuser",
                    models.BooleanField(
                        default=False,
                        help_text="Designates that this user has all permissions without explicitly assigning them.",
                        verbose_name="superuser status",
                    ),
                ),
                (
                    "groups",
                    models.ManyToManyField(
                        blank=True,
                        help_text="The groups this user belongs to.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.group",
                        verbose_name="groups",
                    ),
                ),
                (
                    "user_permissions",
                    models.ManyToManyField(
                        blank=True,
                        help_text="Specific permissions for this user.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.permission",
                        verbose_name="user permissions",
                    ),
                ),
            ],
            options={
                "ordering": ("-date_joined",),
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="UserToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True,
                 primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.CharField(
                    editable=False, max_length=128, unique=True)),
                ("token_type", models.CharField(choices=[("registration", "Registration"), (
                    "invite", "Invite"), ("reset", "Password reset")], max_length=32)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("is_used", models.BooleanField(default=False)),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                      related_name="tokens", to=settings.AUTH_USER_MODEL),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.AddIndex(
            model_name="usertoken",
            index=models.Index(fields=("token", "token_type"),
                               name="api_usertok_token_b5f09c_idx"),
        ),
    ]
