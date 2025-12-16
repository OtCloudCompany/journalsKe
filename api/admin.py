from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from .models import (
    Journal,
    OAIHarvestLog,
    Publication,
    ResearcherExperience,
    ResearcherInstitutionalEmailToken,
    ResearcherProfile,
    ResearcherPublication,
    User,
    UserToken,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name",
                    "is_staff", "is_verified", "is_active")
    list_filter = ("is_staff", "is_superuser", "is_verified", "is_active")
    search_fields = ("email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name")}),
        (
            _("Permissions"),
            {"fields": ("is_active", "is_staff", "is_superuser",
                        "is_verified", "groups", "user_permissions")},
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2", "is_staff", "is_superuser", "is_verified"),
            },
        ),
    )
    filter_horizontal = ("groups", "user_permissions")


@admin.register(UserToken)
class UserTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "token_type", "created_at",
                    "expires_at", "is_used")
    list_filter = ("token_type", "is_used", "created_at")
    search_fields = ("user__email", "token")


class OAIHarvestLogInline(admin.TabularInline):
    model = OAIHarvestLog
    extra = 0
    can_delete = False
    fields = (
        "started_at",
        "finished_at",
        "endpoint",
        "status",
        "record_count",
        "error_message",
    )
    readonly_fields = fields
    ordering = ("-started_at",)
    verbose_name_plural = "Harvest logs"

    def has_add_permission(self, request, obj=None):  # noqa: D401
        """Inline is read-only."""
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Journal)
class JournalAdmin(admin.ModelAdmin):
    list_display = ("name", "publisher", "chief_editor",
                    "is_active", "created_at")
    list_filter = ("is_active", "language", "country")
    search_fields = ("name", "publisher", "chief_editor",
                     "issn_print", "issn_online", "oai_url")
    readonly_fields = ("slug", "created_at", "updated_at", "last_harvested_at")
    inlines = (OAIHarvestLogInline,)


@admin.register(OAIHarvestLog)
class OAIHarvestLogAdmin(admin.ModelAdmin):
    list_display = (
        "journal",
        "status",
        "started_at",
        "finished_at",
        "record_count",
    )
    list_filter = ("status", "journal")
    search_fields = ("journal__name", "endpoint", "error_message")
    readonly_fields = (
        "journal",
        "started_at",
        "finished_at",
        "endpoint",
        "status",
        "record_count",
        "error_message",
    )
    ordering = ("-started_at", "-id")

    def has_add_permission(self, request):
        return False


@admin.register(Publication)
class PublicationAdmin(admin.ModelAdmin):
    list_display = ("title", "journal", "display_creators", "publisher",
                    "issued", "display_languages")
    list_filter = ("journal", "publisher", "metadata_entries__schema",
                   "metadata_entries__element")
    search_fields = (
        "title",
        "publisher",
        "rights",
        "metadata_entries__value",
        "oai_identifier",
    )
    readonly_fields = ("slug", "created_at", "updated_at")

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.prefetch_related("metadata_entries")

    def display_creators(self, obj):
        values = obj.metadata_values("creator")
        return ", ".join(values) if values else ""

    display_creators.short_description = "Creators"

    def display_languages(self, obj):
        values = obj.metadata_values("language")
        return ", ".join(values) if values else ""

    display_languages.short_description = "Languages"


class ResearcherExperienceInline(admin.TabularInline):
    model = ResearcherExperience
    extra = 0


class ResearcherPublicationInline(admin.TabularInline):
    model = ResearcherPublication
    extra = 0
    autocomplete_fields = ("publication",)


@admin.register(ResearcherProfile)
class ResearcherProfileAdmin(admin.ModelAdmin):
    list_display = (
        "display_name",
        "institutional_email",
        "institutional_email_verified",
        "affiliation",
        "current_position",
        "created_at",
    )
    list_filter = (
        "institutional_email_verified",
        "created_at",
    )
    search_fields = (
        "display_name",
        "institutional_email",
        "affiliation",
        "user__email",
    )
    readonly_fields = (
        "slug",
        "created_at",
        "updated_at",
        "institutional_email_verified",
        "institutional_email_verified_at",
    )
    inlines = (ResearcherExperienceInline, ResearcherPublicationInline)


@admin.register(ResearcherInstitutionalEmailToken)
class ResearcherInstitutionalEmailTokenAdmin(admin.ModelAdmin):
    list_display = (
        "profile",
        "email",
        "token",
        "is_used",
        "expires_at",
    )
    list_filter = ("is_used", "created_at")
    search_fields = ("token", "profile__display_name", "email")
