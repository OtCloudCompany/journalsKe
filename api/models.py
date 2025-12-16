from __future__ import annotations

import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class UserManager(BaseUserManager):
    def create_user(self, email: str, password: str | None = None, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields):
        if not password:
            raise ValueError("Superusers must have a password.")
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("is_verified", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    is_verified = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        ordering = ("-date_joined",)

    def __str__(self) -> str:
        return self.email


class UserToken(models.Model):
    REGISTRATION = "registration"
    INVITE = "invite"
    RESET = "reset"
    RESEARCHER_INSTITUTIONAL = "researcher_institutional"

    TOKEN_TYPE_CHOICES = (
        (REGISTRATION, "Registration"),
        (INVITE, "Invite"),
        (RESET, "Password reset"),
        (RESEARCHER_INSTITUTIONAL, "Researcher institutional email"),
    )

    user = models.ForeignKey(settings.AUTH_USER_MODEL,
                             on_delete=models.CASCADE, related_name="tokens")
    token = models.CharField(max_length=128, unique=True, editable=False)
    token_type = models.CharField(max_length=32, choices=TOKEN_TYPE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=("token", "token_type"))]
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.user.email} ({self.token_type})"

    @classmethod
    def issue(cls, user: "User", token_type: str, ttl_hours: int) -> "UserToken":
        cls.objects.filter(user=user, token_type=token_type,
                           is_used=False).update(is_used=True)
        expires_at = timezone.now() + timedelta(hours=ttl_hours)
        token = secrets.token_urlsafe(48)
        return cls.objects.create(user=user, token=token, token_type=token_type, expires_at=expires_at)

    def mark_used(self) -> None:
        self.is_used = True
        self.save(update_fields=["is_used"])

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at


class Journal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    slug = models.SlugField(max_length=255, unique=True, editable=False)
    description = models.TextField(blank=True)
    homepage_url = models.URLField(blank=True)
    oai_url = models.URLField(blank=True)
    last_harvested_at = models.DateTimeField(null=True, blank=True)
    chief_editor = models.CharField(max_length=255, blank=True)
    publisher = models.CharField(max_length=255, blank=True)
    issn_print = models.CharField(max_length=32, blank=True)
    issn_online = models.CharField(max_length=32, blank=True)
    language = models.CharField(max_length=128, blank=True)
    country = models.CharField(max_length=128, blank=True)
    founded_year = models.PositiveIntegerField(null=True, blank=True)
    contact_email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        verbose_name = "Journal"
        verbose_name_plural = "Journals"

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 1
            while Journal.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                counter += 1
                slug = f"{base_slug}-{counter}"
            self.slug = slug
        super().save(*args, **kwargs)


class OAIHarvestLog(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    id = models.BigAutoField(primary_key=True)
    journal = models.ForeignKey(
        Journal,
        related_name="harvest_logs",
        on_delete=models.CASCADE,
    )
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    endpoint = models.URLField(blank=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.RUNNING,
    )
    record_count = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ("-started_at", "-id")
        verbose_name = "OAI harvest log"
        verbose_name_plural = "OAI harvest logs"

    def __str__(self) -> str:
        status = self.get_status_display()
        started = self.started_at.astimezone(
            timezone.get_current_timezone()) if self.started_at else None
        ts = started.strftime("%Y-%m-%d %H:%M") if started else "unknown"
        return f"{self.journal.name} – {status} ({ts})"

    def mark_success(self, record_count: int) -> None:
        self.status = self.Status.SUCCESS
        self.record_count = max(0, record_count)
        self.error_message = ""
        self.finished_at = timezone.now()
        self.save(update_fields=[
            "status",
            "record_count",
            "error_message",
            "finished_at",
        ])

    def mark_failure(self, reason: str, record_count: int = 0) -> None:
        truncated_reason = (reason or "").strip()
        if truncated_reason and len(truncated_reason) > 2000:
            truncated_reason = f"{truncated_reason[:1997]}..."
        self.status = self.Status.FAILED
        self.record_count = max(0, record_count)
        self.error_message = truncated_reason
        self.finished_at = timezone.now()
        self.save(update_fields=[
            "status",
            "record_count",
            "error_message",
            "finished_at",
        ])


class Publication(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    journal = models.ForeignKey(
        Journal,
        related_name="publications",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    title = models.CharField(max_length=512)
    slug = models.SlugField(max_length=512, unique=True, editable=False)
    description = models.TextField(blank=True)
    publisher = models.CharField(max_length=255, blank=True)
    issued = models.DateField(
        null=True, blank=True, help_text="Date the publication was made available.")
    resource_type = models.CharField(max_length=128, blank=True)
    resource_format = models.CharField(max_length=128, blank=True)
    rights = models.TextField(blank=True)
    oai_identifier = models.CharField(
        max_length=512,
        null=True,
        blank=True,
        unique=True,
    )
    oai_datestamp = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("title",)
        indexes = [models.Index(fields=("slug",))]

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.title)
            slug = base_slug
            counter = 1
            while Publication.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                counter += 1
                slug = f"{base_slug}-{counter}"
            self.slug = slug
        super().save(*args, **kwargs)

    def metadata_values(self, element: str, qualifier: str | None = None, schema: str = "dc") -> list[str]:
        entries = self.metadata_entries.filter(
            schema__iexact=schema,
            element__iexact=element,
        )
        if qualifier is not None:
            entries = entries.filter(qualifier__iexact=qualifier)
        values: list[str] = []
        for entry in entries.order_by("position", "id"):
            value = (entry.value or "").strip()
            if value:
                values.append(value)
        return values

    def metadata_dict(self, schema: str | None = None) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        entries = self.metadata_entries.all()
        if schema:
            entries = entries.filter(schema__iexact=schema)
        for entry in entries.order_by("schema", "element", "qualifier", "position", "id"):
            key_parts = [entry.schema.lower(), entry.element.lower()]
            if entry.qualifier:
                key_parts.append(entry.qualifier.lower())
            key = ".".join(key_parts)
            value = (entry.value or "").strip()
            if not value:
                continue
            result.setdefault(key, []).append(value)
        return result


class PublicationMetadata(models.Model):
    id = models.BigAutoField(primary_key=True)
    publication = models.ForeignKey(
        Publication,
        related_name="metadata_entries",
        on_delete=models.CASCADE,
    )
    schema = models.CharField(max_length=32, default="dc")
    element = models.CharField(max_length=64)
    qualifier = models.CharField(max_length=64, blank=True)
    value = models.TextField()
    language = models.CharField(max_length=16, blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "id")
        indexes = [
            models.Index(fields=("publication", "schema",
                         "element", "qualifier")),
            models.Index(fields=("schema", "element", "qualifier")),
        ]

    def __str__(self) -> str:
        qualifier = f".{self.qualifier}" if self.qualifier else ""
        language = f" ({self.language})" if self.language else ""
        return f"{self.schema}.{self.element}{qualifier}: {self.value}{language}"

    def save(self, *args, **kwargs):
        self.schema = (self.schema or "dc").strip().lower()
        self.element = (self.element or "").strip().lower()
        self.qualifier = (self.qualifier or "").strip().lower()
        self.language = (self.language or "").strip().lower()
        super().save(*args, **kwargs)


class ResearcherProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="researcher_profile",
    )
    slug = models.SlugField(max_length=255, unique=True, editable=False)
    title = models.CharField(max_length=64, blank=True)
    display_name = models.CharField(max_length=255)
    institutional_email = models.EmailField(unique=True)
    institutional_email_verified = models.BooleanField(default=False)
    institutional_email_verified_at = models.DateTimeField(
        null=True, blank=True)
    affiliation = models.CharField(max_length=255, blank=True)
    current_position = models.CharField(max_length=255, blank=True)
    short_bio = models.TextField(blank=True)
    research_interests = models.TextField(blank=True)
    google_scholar_url = models.URLField(blank=True)
    linkedin_url = models.URLField(blank=True)
    orcid = models.CharField(max_length=64, blank=True)
    personal_website = models.URLField(blank=True)
    profile_photo = models.ImageField(
        upload_to="researchers/photos/", blank=True, null=True
    )
    publications = models.ManyToManyField(
        Publication,
        through="ResearcherPublication",
        related_name="researchers",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_name",)
        verbose_name = "Researcher profile"
        verbose_name_plural = "Researcher profiles"

    def __str__(self) -> str:
        return self.display_name

    def save(self, *args, **kwargs):
        if not self.display_name:
            full_name_parts = [self.user.first_name, self.user.last_name]
            synthesized = " ".join(
                part for part in full_name_parts if part).strip()
            self.display_name = synthesized or self.user.email.split("@")[0]
        if not self.slug:
            base_slug = slugify(self.display_name)
            slug = base_slug or slugify(self.user.email.split("@")[0])
            counter = 1
            while ResearcherProfile.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                counter += 1
                slug = f"{base_slug}-{counter}" if base_slug else f"researcher-{counter}"
            self.slug = slug
        super().save(*args, **kwargs)

    def mark_institutional_email_verified(self) -> None:
        self.institutional_email_verified = True
        self.institutional_email_verified_at = timezone.now()
        self.save(update_fields=[
            "institutional_email_verified",
            "institutional_email_verified_at",
        ])

    def reset_institutional_email_verification(self) -> None:
        self.institutional_email_verified = False
        self.institutional_email_verified_at = None
        self.save(update_fields=[
            "institutional_email_verified",
            "institutional_email_verified_at",
        ])

    def initiate_institutional_email_verification(self) -> "ResearcherInstitutionalEmailToken":
        if not self.institutional_email:
            raise ValueError(
                "Institutional email is required for verification")
        token = ResearcherInstitutionalEmailToken.issue(
            profile=self,
            email=self.institutional_email,
        )
        from .utils import send_institutional_email_verification

        send_institutional_email_verification(self, token)
        return token


class ResearcherExperience(models.Model):
    id = models.BigAutoField(primary_key=True)
    profile = models.ForeignKey(
        ResearcherProfile,
        related_name="experiences",
        on_delete=models.CASCADE,
    )
    employer = models.CharField(max_length=255)
    role = models.CharField(max_length=255)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_current = models.BooleanField(default=False)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = (
            "-is_current",
            "-start_date",
            "-end_date",
            "-id",
        )
        verbose_name = "Researcher experience"
        verbose_name_plural = "Researcher experiences"

    def __str__(self) -> str:
        return f"{self.role} at {self.employer}"


class ResearcherPublication(models.Model):
    id = models.BigAutoField(primary_key=True)
    profile = models.ForeignKey(
        ResearcherProfile,
        related_name="researcher_publications",
        on_delete=models.CASCADE,
    )
    publication = models.ForeignKey(
        Publication,
        related_name="researcher_links",
        on_delete=models.CASCADE,
    )
    contribution = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("profile", "publication")
        ordering = ("publication__title",)
        verbose_name = "Researcher publication link"
        verbose_name_plural = "Researcher publication links"

    def __str__(self) -> str:
        return f"{self.profile.display_name} -> {self.publication.title}"


class ResearcherInstitutionalEmailToken(models.Model):
    id = models.BigAutoField(primary_key=True)
    profile = models.ForeignKey(
        ResearcherProfile,
        related_name="institutional_email_tokens",
        on_delete=models.CASCADE,
    )
    email = models.EmailField()
    token = models.CharField(max_length=128, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("token",)),
            models.Index(fields=("profile", "is_used")),
        ]

    def __str__(self) -> str:
        return f"Institutional email token for {self.profile.display_name}"

    @classmethod
    def issue(
        cls,
        profile: ResearcherProfile,
        email: str,
        *,
        ttl_hours: int = 48,
    ) -> "ResearcherInstitutionalEmailToken":
        cls.objects.filter(profile=profile, is_used=False).update(is_used=True)
        token = secrets.token_urlsafe(48)
        expires_at = timezone.now() + timedelta(hours=ttl_hours)
        return cls.objects.create(
            profile=profile,
            email=email,
            token=token,
            expires_at=expires_at,
        )

    def mark_used(self) -> None:
        self.is_used = True
        self.save(update_fields=["is_used"])

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at
