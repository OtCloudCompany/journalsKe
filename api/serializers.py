from __future__ import annotations

import re
from datetime import date
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils.dateparse import parse_date
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import (
    Journal,
    OAIHarvestLog,
    Publication,
    PublicationMetadata,
    ResearcherExperience,
    ResearcherProfile,
    ResearcherPublication,
    UserToken,
)
from .utils import send_user_email

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name",
                  "is_verified", "date_joined")
        read_only_fields = ("id", "is_verified", "date_joined")


class RegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "password")

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(
                "A user with this email already exists")
        return value

    def validate(self, attrs):
        password = attrs.get("password")
        if password:
            validate_password(password=password)
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User.objects.create_user(
            password=password, is_active=False, is_verified=False, **validated_data)
        token = UserToken.issue(user, UserToken.REGISTRATION, ttl_hours=24)
        send_user_email("verify", user, token)
        return user


class EmailVerificationSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)

    def validate_token(self, value: str) -> str:
        try:
            token = UserToken.objects.select_related("user").get(
                token=value, token_type=UserToken.REGISTRATION)
        except UserToken.DoesNotExist as exc:
            raise serializers.ValidationError("Invalid token") from exc
        if token.is_used:
            raise serializers.ValidationError("Token already used")
        if token.is_expired():
            raise serializers.ValidationError("Token expired")
        self.context["token_obj"] = token
        return value

    def save(self, **kwargs):
        token: UserToken = self.context["token_obj"]
        user = token.user
        user.is_active = True
        user.is_verified = True
        user.save(update_fields=["is_active", "is_verified"])
        token.mark_used()
        return user


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        try:
            user = User.objects.get(email__iexact=value)
        except User.DoesNotExist as exc:
            raise serializers.ValidationError("Email not found") from exc
        if user.is_verified:
            raise serializers.ValidationError("Account already verified")
        self.context["user"] = user
        return value

    def save(self, **kwargs):
        user = self.context["user"]
        token = UserToken.issue(user, UserToken.REGISTRATION, ttl_hours=24)
        send_user_email("verify", user, token)
        return token


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        try:
            user = User.objects.get(email__iexact=value)
        except User.DoesNotExist as exc:
            raise serializers.ValidationError("Email not found") from exc
        self.context["user"] = user
        return value

    def save(self, triggered_by_admin: bool = False, **kwargs):
        user = self.context["user"]
        token = UserToken.issue(user, UserToken.RESET, ttl_hours=2)
        send_user_email("reset", user, token,
                        triggered_by_admin=triggered_by_admin)
        return token


class PasswordResetSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        try:
            token = UserToken.objects.select_related("user").get(
                token=attrs["token"], token_type=UserToken.RESET)
        except UserToken.DoesNotExist as exc:
            raise serializers.ValidationError(
                {"token": "Invalid token"}) from exc
        if token.is_used:
            raise serializers.ValidationError({"token": "Token already used"})
        if token.is_expired():
            raise serializers.ValidationError({"token": "Token expired"})
        validate_password(attrs["password"], token.user)
        self.context["token_obj"] = token
        return attrs

    def save(self, **kwargs):
        token: UserToken = self.context["token_obj"]
        user = token.user
        user.set_password(self.validated_data["password"])
        user.is_active = True
        user.save(update_fields=["password", "is_active"])
        token.mark_used()
        return user


class AdminInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "is_staff")
        extra_kwargs = {"is_staff": {"required": False, "default": False}}

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(
                "User with this email already exists")
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            is_active=False, is_verified=False, **validated_data)
        token = UserToken.issue(user, UserToken.INVITE, ttl_hours=48)
        send_user_email("invite", user, token)
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("first_name", "last_name")

    def update(self, instance, validated_data):
        return super().update(instance, validated_data)


class InviteAcceptanceSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        try:
            token = UserToken.objects.select_related("user").get(
                token=attrs["token"], token_type=UserToken.INVITE)
        except UserToken.DoesNotExist as exc:
            raise serializers.ValidationError(
                {"token": "Invalid token"}) from exc
        if token.is_used:
            raise serializers.ValidationError({"token": "Token already used"})
        if token.is_expired():
            raise serializers.ValidationError({"token": "Token expired"})
        validate_password(attrs["password"], token.user)
        self.context["token_obj"] = token
        return attrs

    def save(self, **kwargs):
        token: UserToken = self.context["token_obj"]
        user = token.user
        user.set_password(self.validated_data["password"])
        user.is_active = True
        user.is_verified = True
        user.save(update_fields=["password", "is_active", "is_verified"])
        token.mark_used()
        return user


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        if not user.is_active or not user.is_verified:
            raise serializers.ValidationError(
                {"detail": "Account is not verified"})
        return data


class JournalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Journal
        read_only_fields = ("id", "slug", "created_at",
                            "updated_at", "last_harvested_at")
        fields = (
            "id",
            "name",
            "slug",
            "description",
            "homepage_url",
            "oai_url",
            "last_harvested_at",
            "chief_editor",
            "publisher",
            "issn_print",
            "issn_online",
            "language",
            "country",
            "founded_year",
            "contact_email",
            "is_active",
            "created_at",
            "updated_at",
        )


class OAIHarvestLogSerializer(serializers.ModelSerializer):
    journal = serializers.SerializerMethodField()

    class Meta:
        model = OAIHarvestLog
        fields = (
            "id",
            "journal",
            "started_at",
            "finished_at",
            "endpoint",
            "status",
            "record_count",
            "error_message",
        )
        read_only_fields = fields

    def get_journal(self, obj: OAIHarvestLog) -> dict[str, str] | None:
        journal = obj.journal
        if journal is None:
            return None
        return {
            "id": str(journal.id),
            "slug": journal.slug,
            "name": journal.name,
        }


class OAIEndpointTestSerializer(serializers.Serializer):
    oai_url = serializers.URLField()

    def validate_oai_url(self, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise serializers.ValidationError(
                "Provide an OAI-PMH endpoint URL.")
        if not normalized.lower().startswith(("http://", "https://")):
            raise serializers.ValidationError(
                "Only HTTP and HTTPS URLs are supported.")
        return normalized


class PublicationMetadataSerializer(serializers.ModelSerializer):
    qualifier = serializers.CharField(
        required=False, allow_blank=True, allow_null=True)
    language = serializers.CharField(
        required=False, allow_blank=True, allow_null=True)
    schema = serializers.CharField(required=False, default="dc")
    position = serializers.IntegerField(required=False, min_value=0)

    class Meta:
        model = PublicationMetadata
        fields = (
            "id",
            "schema",
            "element",
            "qualifier",
            "value",
            "language",
            "position",
        )
        read_only_fields = ("id",)


class PublicationSerializer(serializers.ModelSerializer):
    metadata = PublicationMetadataSerializer(
        source="metadata_entries",
        many=True,
        required=False,
    )
    journal = serializers.SerializerMethodField(read_only=True)

    CORE_METADATA_FIELDS: dict[str, dict[str, Any]] = {
        "title": {"schema": "dc", "element": "title", "qualifier": "", "type": "string"},
        "description": {"schema": "dc", "element": "description", "qualifier": "", "type": "string"},
        "publisher": {"schema": "dc", "element": "publisher", "qualifier": "", "type": "string"},
        "resource_type": {"schema": "dc", "element": "type", "qualifier": "", "type": "string"},
        "resource_format": {"schema": "dc", "element": "format", "qualifier": "", "type": "string"},
        "issued": {"schema": "dc", "element": "date", "qualifier": "issued", "type": "date"},
        "rights": {"schema": "dc", "element": "rights", "qualifier": "", "type": "string"},
    }

    class Meta:
        model = Publication
        read_only_fields = (
            "id",
            "slug",
            "journal",
            "oai_identifier",
            "oai_datestamp",
            "created_at",
            "updated_at",
        )
        fields = (
            "id",
            "title",
            "slug",
            "description",
            "publisher",
            "issued",
            "resource_type",
            "resource_format",
            "rights",
            "metadata",
            "journal",
            "oai_identifier",
            "oai_datestamp",
            "created_at",
            "updated_at",
        )

    def get_journal(self, obj: Publication):
        if obj.journal:
            return {
                "id": str(obj.journal.id),
                "slug": obj.journal.slug,
                "name": obj.journal.name,
            }
        return None

    def create(self, validated_data):
        metadata_payload_raw = list(validated_data.pop(
            "metadata_entries", []) or [])
        non_core_entries, core_entries = self._split_core_metadata(
            metadata_payload_raw)
        self._populate_missing_core_fields(validated_data, core_entries)
        self._sanitize_core_fields(validated_data)
        metadata_payload = self._build_metadata_payload(
            non_core_entries, core_entries, validated_data)
        with transaction.atomic():
            publication = Publication.objects.create(**validated_data)
            self._sync_metadata(publication, metadata_payload)
        return publication

    def update(self, instance, validated_data):
        metadata_payload_raw = validated_data.pop("metadata_entries", None)
        metadata_payload = None
        if metadata_payload_raw is not None:
            metadata_payload_raw = list(metadata_payload_raw or [])
            non_core_entries, core_entries = self._split_core_metadata(
                metadata_payload_raw)
            self._populate_missing_core_fields(
                validated_data, core_entries, instance=instance)
            self._sanitize_core_fields(validated_data)
            metadata_payload = self._build_metadata_payload(
                non_core_entries, core_entries, validated_data)
        else:
            self._sanitize_core_fields(validated_data)
        with transaction.atomic():
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            instance.save()
            if metadata_payload is not None:
                instance.metadata_entries.all().delete()
                self._sync_metadata(instance, metadata_payload)
            else:
                self._update_core_metadata_fields(instance, validated_data)
        return instance

    def _sync_metadata(self, publication: Publication, payload: list[dict]):
        entries: list[PublicationMetadata] = []
        for index, item in enumerate(payload):
            schema = (item.get("schema") or "dc").strip()
            element = (item.get("element") or "").strip()
            qualifier_raw = item.get("qualifier")
            qualifier = (qualifier_raw or "").strip()
            language_raw = item.get("language")
            language = (language_raw or "").strip()
            value = (item.get("value") or "").strip()
            position = item.get("position")

            if not schema or not element or not value:
                continue

            entries.append(
                PublicationMetadata(
                    publication=publication,
                    schema=schema.lower(),
                    element=element.lower(),
                    qualifier=qualifier.lower(),
                    value=value,
                    language=language.lower(),
                    position=position if isinstance(
                        position, int) and position >= 0 else index,
                )
            )

        if entries:
            PublicationMetadata.objects.bulk_create(entries)

    def _split_core_metadata(self, payload: list[dict]) -> tuple[list[dict], dict[str, list[dict]]]:
        non_core: list[dict] = []
        core_entries: dict[str, list[dict]] = {
            field: [] for field in self.CORE_METADATA_FIELDS
        }
        for item in payload:
            schema = (item.get("schema") or "dc").strip().lower()
            element = (item.get("element") or "").strip().lower()
            qualifier = (item.get("qualifier") or "").strip().lower()
            value = (item.get("value") or "").strip()
            language = (item.get("language") or "").strip().lower()
            if not schema or not element or not value:
                continue
            entry = {
                "schema": schema,
                "element": element,
                "qualifier": qualifier,
                "value": value,
                "language": language,
            }
            field_name = self._match_core_field(schema, element, qualifier)
            if field_name:
                core_entries[field_name].append(entry)
            else:
                non_core.append(entry)
        return non_core, core_entries

    def _populate_missing_core_fields(self, validated_data: dict, core_entries: dict[str, list[dict]], instance: Publication | None = None) -> None:
        for field, spec in self.CORE_METADATA_FIELDS.items():
            if field in validated_data:
                continue
            entries = core_entries.get(field) or []
            if entries:
                python_value = self._coerce_to_python(
                    field, spec, entries[0]["value"])  # type: ignore[arg-type]
                validated_data[field] = python_value
            elif instance is not None and hasattr(instance, field):
                validated_data[field] = getattr(instance, field)

    def _sanitize_core_fields(self, validated_data: dict) -> None:
        for field, spec in self.CORE_METADATA_FIELDS.items():
            if field in validated_data:
                validated_data[field] = self._coerce_to_python(
                    field, spec, validated_data[field]
                )

    def _build_metadata_payload(
        self,
        non_core_entries: list[dict],
        core_entries: dict[str, list[dict]],
        validated_data: dict,
    ) -> list[dict]:
        core_payload: list[dict] = []
        for field, spec in self.CORE_METADATA_FIELDS.items():
            entries = core_entries.get(field) or []
            value = validated_data.get(field)
            metadata_value = self._python_to_metadata(field, spec, value)
            if metadata_value:
                language = entries[0]["language"] if entries else ""
                core_payload.append({
                    "schema": spec["schema"],
                    "element": spec["element"],
                    "qualifier": (spec["qualifier"] or ""),
                    "language": language,
                    "value": metadata_value,
                })
                if len(entries) > 1:
                    core_payload.extend(entries[1:])
            elif entries:
                core_payload.extend(entries)
        return core_payload + non_core_entries

    def _match_core_field(self, schema: str, element: str, qualifier: str) -> str | None:
        for field, spec in self.CORE_METADATA_FIELDS.items():
            expected_qualifier = spec["qualifier"] or ""
            if (
                schema == spec["schema"]
                and element == spec["element"]
                and qualifier == expected_qualifier
            ):
                return field
        return None

    def _coerce_to_python(self, field: str, spec: dict[str, Any], value: Any) -> Any:
        field_type = spec.get("type")
        if field_type == "date":
            if value in (None, ""):
                return None
            if isinstance(value, date):
                return value
            if isinstance(value, str):
                parsed = parse_date(value)
                return parsed
            return None
        if value is None:
            return ""
        return str(value).strip()

    def _python_to_metadata(self, field: str, spec: dict[str, Any], value: Any) -> str:
        field_type = spec.get("type")
        if field_type == "date":
            if not value:
                return ""
            if isinstance(value, date):
                return value.isoformat()
            if isinstance(value, str):
                return value.strip()
            return ""
        return (value or "").strip()

    def _update_core_metadata_fields(self, publication: Publication, updates: dict) -> None:
        for field, value in updates.items():
            if field not in self.CORE_METADATA_FIELDS:
                continue
            spec = self.CORE_METADATA_FIELDS[field]
            metadata_value = self._python_to_metadata(field, spec, value)
            qualifier = spec["qualifier"] or ""
            queryset = publication.metadata_entries.filter(
                schema__iexact=spec["schema"],
                element__iexact=spec["element"],
                qualifier__iexact=qualifier,
            ).order_by("position", "id")

            if metadata_value:
                primary = queryset.first()
                if primary:
                    if primary.value != metadata_value:
                        primary.value = metadata_value
                        primary.save(update_fields=["value", "updated_at"])
                else:
                    PublicationMetadata.objects.create(
                        publication=publication,
                        schema=spec["schema"],
                        element=spec["element"],
                        qualifier=qualifier,
                        value=metadata_value,
                        language="",
                        position=publication.metadata_entries.count(),
                    )
            else:
                queryset.delete()


class ResearcherExperienceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResearcherExperience
        fields = (
            "id",
            "employer",
            "role",
            "start_date",
            "end_date",
            "is_current",
            "description",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ResearcherExperienceWriteSerializer(ResearcherExperienceSerializer):
    id = serializers.IntegerField(required=False)

    class Meta(ResearcherExperienceSerializer.Meta):
        read_only_fields = ()

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")
        is_current = attrs.get("is_current", False)
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": "End date cannot be earlier than start date."}
            )
        if is_current and end_date:
            raise serializers.ValidationError(
                {"end_date": "Current roles cannot include an end date."}
            )
        return attrs


class ResearcherPublicationInputSerializer(serializers.Serializer):
    publication_id = serializers.UUIDField()
    contribution = serializers.CharField(
        max_length=255, required=False, allow_blank=True, allow_null=True
    )


class PublicationSummarySerializer(serializers.ModelSerializer):
    journal = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = ("id", "slug", "title", "issued", "journal")

    def get_journal(self, obj: Publication):
        if obj.journal:
            return {
                "id": str(obj.journal.id),
                "slug": obj.journal.slug,
                "name": obj.journal.name,
            }
        return None


class ResearcherPublicationSerializer(serializers.ModelSerializer):
    publication = PublicationSummarySerializer(read_only=True)

    class Meta:
        model = ResearcherPublication
        fields = ("id", "publication", "contribution")
        read_only_fields = ("id", "publication")


class ResearcherProfileSerializer(serializers.ModelSerializer):
    experiences = ResearcherExperienceSerializer(many=True, read_only=True)
    publications = ResearcherPublicationSerializer(
        many=True, read_only=True, source="researcher_publications"
    )
    profile_photo_url = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = ResearcherProfile
        fields = (
            "id",
            "slug",
            "title",
            "display_name",
            "full_name",
            "institutional_email",
            "institutional_email_verified",
            "institutional_email_verified_at",
            "affiliation",
            "current_position",
            "short_bio",
            "research_interests",
            "google_scholar_url",
            "linkedin_url",
            "orcid",
            "personal_website",
            "profile_photo_url",
            "experiences",
            "publications",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "slug",
            "institutional_email_verified",
            "institutional_email_verified_at",
            "profile_photo_url",
            "experiences",
            "publications",
            "created_at",
            "updated_at",
        )

    def get_profile_photo_url(self, obj: ResearcherProfile) -> str | None:
        request = self.context.get("request")
        if not obj.profile_photo:
            return None
        if request is not None:
            return request.build_absolute_uri(obj.profile_photo.url)
        return obj.profile_photo.url

    def get_full_name(self, obj: ResearcherProfile) -> str:
        return obj.display_name


class ResearcherProfileWriteSerializer(serializers.ModelSerializer):
    experiences = ResearcherExperienceWriteSerializer(
        many=True, required=False, allow_empty=True
    )
    publications = ResearcherPublicationInputSerializer(
        many=True, required=False, allow_empty=True
    )

    class Meta:
        model = ResearcherProfile
        fields = (
            "title",
            "display_name",
            "institutional_email",
            "affiliation",
            "current_position",
            "short_bio",
            "research_interests",
            "google_scholar_url",
            "linkedin_url",
            "orcid",
            "personal_website",
            "experiences",
            "publications",
        )

    STRING_FIELDS = (
        "title",
        "display_name",
        "institutional_email",
        "affiliation",
        "current_position",
        "short_bio",
        "research_interests",
        "google_scholar_url",
        "linkedin_url",
        "orcid",
        "personal_website",
    )

    ORCID_REGEX = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$", re.IGNORECASE)

    def validate_display_name(self, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise serializers.ValidationError("Display name cannot be blank.")
        return normalized

    def validate_institutional_email(self, value: str) -> str:
        normalized = (value or "").strip().lower()
        if not normalized:
            raise serializers.ValidationError(
                "Institutional email is required.")
        if "@" not in normalized:
            raise serializers.ValidationError(
                "Institutional email must include a domain.")
        local_part, domain = normalized.rsplit("@", 1)
        domain = domain.strip().lower()
        if not local_part or not domain:
            raise serializers.ValidationError(
                "Institutional email must include a domain.")
        blocked_domains = {
            entry.lower()
            for entry in getattr(settings, "INSTITUTIONAL_EMAIL_BLOCKED_DOMAINS", [])
        }
        if any(domain == blocked or domain.endswith(f".{blocked}") for blocked in blocked_domains):
            raise serializers.ValidationError(
                "Institutional email cannot use personal email providers (e.g., Gmail)."
            )
        queryset = ResearcherProfile.objects.filter(
            institutional_email__iexact=normalized
        )
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError(
                "This institutional email is already linked to another researcher."
            )
        return normalized

    def validate_orcid(self, value: str | None) -> str | None:
        normalized = (value or "").strip()
        if not normalized:
            return ""
        if not self.ORCID_REGEX.match(normalized):
            raise serializers.ValidationError(
                "ORCID must follow the 0000-0000-0000-0000 format."
            )
        return normalized.upper()

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if request is None or user is None or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required.")
        if self.instance is None:
            if ResearcherProfile.objects.filter(user=user).exists():
                raise serializers.ValidationError(
                    "A researcher profile already exists for this account."
                )
        publications = attrs.get("publications") or []
        publication_ids = [item["publication_id"] for item in publications]
        if len(publication_ids) != len(set(publication_ids)):
            raise serializers.ValidationError(
                {"publications": "Duplicate publications are not allowed."}
            )
        return attrs

    def create(self, validated_data):
        experiences_data = validated_data.pop("experiences", [])
        publications_data = validated_data.pop("publications", [])
        self._normalize_strings(validated_data)
        request = self.context["request"]
        user = request.user
        profile = ResearcherProfile.objects.create(user=user, **validated_data)
        if experiences_data:
            self._sync_experiences(profile, experiences_data)
        if publications_data:
            self._sync_publications(profile, publications_data)
        profile.initiate_institutional_email_verification()
        return profile

    def update(self, instance, validated_data):
        experiences_data = validated_data.pop("experiences", None)
        publications_data = validated_data.pop("publications", None)
        self._normalize_strings(validated_data)
        email_changed = False
        if "institutional_email" in validated_data:
            new_email = validated_data["institutional_email"]
            current_email = (instance.institutional_email or "").lower()
            if new_email.lower() != current_email:
                email_changed = True

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if email_changed:
            instance.institutional_email_verified = False
            instance.institutional_email_verified_at = None
        instance.save()

        if experiences_data is not None:
            self._sync_experiences(instance, experiences_data)
        if publications_data is not None:
            self._sync_publications(instance, publications_data)
        if email_changed:
            instance.initiate_institutional_email_verification()
        return instance

    def _normalize_strings(self, payload: dict) -> None:
        for field in self.STRING_FIELDS:
            if field in payload and payload[field] is not None:
                if isinstance(payload[field], str):
                    payload[field] = payload[field].strip()

    def _sync_experiences(
        self,
        profile: ResearcherProfile,
        experiences_data: list[dict],
    ) -> None:
        existing = {exp.id: exp for exp in profile.experiences.all()}
        retained_ids: set[int] = set()
        for item in experiences_data:
            payload = {
                "employer": item["employer"].strip(),
                "role": item["role"].strip(),
                "start_date": item.get("start_date"),
                "end_date": item.get("end_date"),
                "is_current": bool(item.get("is_current", False)),
                "description": (item.get("description") or "").strip(),
            }
            if payload["is_current"]:
                payload["end_date"] = None

            experience_id = item.get("id")
            if experience_id:
                experience = existing.get(experience_id)
                if experience is None:
                    raise serializers.ValidationError(
                        {"experiences": f"Experience with id {experience_id} was not found."}
                    )
                for field, value in payload.items():
                    setattr(experience, field, value)
                experience.save()
                retained_ids.add(experience.id)
            else:
                created = ResearcherExperience.objects.create(
                    profile=profile, **payload
                )
                retained_ids.add(created.id)

        for exp_id, experience in existing.items():
            if exp_id not in retained_ids:
                experience.delete()

    def _sync_publications(
        self,
        profile: ResearcherProfile,
        publications_data: list[dict],
    ) -> None:
        desired: dict[str, dict[str, str]] = {}
        for item in publications_data:
            pub_id = str(item["publication_id"])
            if pub_id in desired:
                raise serializers.ValidationError(
                    {"publications": "Duplicate publications are not allowed."}
                )
            desired[pub_id] = {
                "contribution": (item.get("contribution") or "").strip(),
            }

        publications = {
            str(pub.id): pub
            for pub in Publication.objects.filter(id__in=desired.keys())
        }
        missing = [pub_id for pub_id in desired.keys()
                   if pub_id not in publications]
        if missing:
            raise serializers.ValidationError(
                {"publications":
                    f"Unknown publication ids: {', '.join(missing)}"}
            )

        existing_links = {
            str(link.publication_id): link
            for link in profile.researcher_publications.select_related("publication")
        }

        for pub_id, link in existing_links.items():
            if pub_id not in desired:
                link.delete()

        for pub_id, meta in desired.items():
            publication = publications[pub_id]
            link = existing_links.get(pub_id)
            contribution = meta["contribution"]
            if link:
                if link.contribution != contribution:
                    link.contribution = contribution
                    link.save(update_fields=["contribution", "updated_at"])
            else:
                ResearcherPublication.objects.create(
                    profile=profile,
                    publication=publication,
                    contribution=contribution,
                )


class ResearcherProfilePhotoSerializer(serializers.Serializer):
    profile_photo = serializers.ImageField()


class JournalDetailSerializer(JournalSerializer):
    publications = serializers.SerializerMethodField()

    class Meta(JournalSerializer.Meta):
        fields = JournalSerializer.Meta.fields + ("publications",)

    def get_publications(self, journal: Journal) -> list[dict[str, object]]:
        prefetched = getattr(journal, "recent_publications", None)
        if prefetched is None and hasattr(journal, "_prefetched_objects_cache"):
            prefetched = journal._prefetched_objects_cache.get("publications")

        if prefetched is None:
            publications = journal.publications.order_by(
                "-issued", "-created_at")[:5]
        else:
            publications = prefetched

        serializer = PublicationSerializer(
            publications, many=True, context=self.context)
        return serializer.data
