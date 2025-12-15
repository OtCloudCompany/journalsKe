import calendar
import math
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.http import QueryDict
from django.db.models import Q, Count, Min, Prefetch
from django.db.models.functions import ExtractYear, Lower, Trim
from elasticsearch.exceptions import TransportError
from elasticsearch_dsl import Q as ES_Q, A
from rest_framework import filters, generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.reverse import reverse
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView, TokenVerifyView

from .models import (
    Journal,
    Publication,
    PublicationMetadata,
    ResearcherInstitutionalEmailToken,
    ResearcherProfile,
)
from .pagination import ClientPageNumberPagination
from .serializers import (
    AdminInviteSerializer,
    EmailTokenObtainPairSerializer,
    EmailVerificationSerializer,
    InviteAcceptanceSerializer,
    JournalDetailSerializer,
    JournalSerializer,
    OAIEndpointTestSerializer,
    PasswordResetRequestSerializer,
    PasswordResetSerializer,
    ProfileUpdateSerializer,
    PublicationSerializer,
    RegistrationSerializer,
    ResearcherProfilePhotoSerializer,
    ResearcherProfileSerializer,
    ResearcherProfileWriteSerializer,
    ResendVerificationSerializer,
    UserSerializer,
)
from .search.publication_index import PublicationDocument
from .oai import validate_oai_endpoint
User = get_user_model()


def _parse_date_boundary(value: str, *, end_of_period: bool = False) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            parsed = datetime.strptime(value, fmt)
            if fmt == "%Y-%m-%d":
                return parsed.date()
            if fmt == "%Y-%m":
                if end_of_period:
                    last_day = calendar.monthrange(
                        parsed.year, parsed.month)[1]
                    return date(parsed.year, parsed.month, last_day)
                return date(parsed.year, parsed.month, 1)
            if fmt == "%Y":
                if end_of_period:
                    return date(parsed.year, 12, 31)
                return date(parsed.year, 1, 1)
        except ValueError:
            continue
    return None


class RegistrationView(generics.CreateAPIView):
    serializer_class = RegistrationSerializer
    permission_classes = (permissions.AllowAny,)


class VerifyEmailView(generics.GenericAPIView):
    serializer_class = EmailVerificationSerializer
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Email verified"}, status=status.HTTP_200_OK)


class ResendVerificationView(generics.GenericAPIView):
    serializer_class = ResendVerificationSerializer
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Verification email sent"}, status=status.HTTP_200_OK)


class PasswordResetRequestView(generics.GenericAPIView):
    serializer_class = PasswordResetRequestSerializer
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password reset email sent"}, status=status.HTTP_200_OK)


class PasswordResetView(generics.GenericAPIView):
    serializer_class = PasswordResetSerializer
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password has been reset"}, status=status.HTTP_200_OK)


class InviteAcceptanceView(generics.GenericAPIView):
    serializer_class = InviteAcceptanceSerializer
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Account activated"}, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, *args, **kwargs):
        old_password = request.data.get("old_password")
        new_password = request.data.get("new_password")
        if not old_password or not new_password:
            return Response({"detail": "Old and new passwords are required"}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        if not user.check_password(old_password):
            return Response({"detail": "Old password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new_password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": list(exc.messages)})
        user.set_password(new_password)
        user.save(update_fields=["password"])
        return Response({"detail": "Password changed successfully"}, status=status.HTTP_200_OK)


class ProfileView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request, *args, **kwargs):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    def patch(self, request, *args, **kwargs):
        serializer = ProfileUpdateSerializer(
            instance=request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)

    def delete(self, request, *args, **kwargs):
        user = request.user
        email = user.email
        user.delete()
        return Response({"detail": f"Account {email} deleted"}, status=status.HTTP_200_OK)


class ResearcherProfileViewSet(viewsets.ModelViewSet):
    queryset = ResearcherProfile.objects.select_related("user").prefetch_related(
        "experiences",
        "researcher_publications__publication",
        "researcher_publications__publication__journal",
    )
    serializer_class = ResearcherProfileSerializer
    permission_classes = (permissions.AllowAny,)
    lookup_field = "slug"
    pagination_class = ClientPageNumberPagination
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = (
        "display_name",
        "affiliation",
        "current_position",
        "research_interests",
    )
    ordering_fields = (
        "display_name",
        "created_at",
        "updated_at",
        "institutional_email_verified_at",
    )
    ordering = ("display_name",)

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "action", None) == "list":
            user = getattr(self.request, "user", None)
            if not user or not user.is_authenticated or not user.is_staff:
                queryset = queryset.filter(institutional_email_verified=True)
        return queryset

    def get_permissions(self):
        if self.action in {
            "create",
            "update",
            "partial_update",
            "destroy",
            "me",
            "update_me",
            "profile_photo",
            "resend_institutional_email",
        }:
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update", "update_me"}:
            return ResearcherProfileWriteSerializer
        if self.action == "profile_photo":
            return ResearcherProfilePhotoSerializer
        return ResearcherProfileSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()
        read_serializer = ResearcherProfileSerializer(
            profile, context=self.get_serializer_context()
        )
        headers = self.get_success_headers(read_serializer.data)
        return Response(read_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        profile = serializer.instance
        read_serializer = ResearcherProfileSerializer(
            profile, context=self.get_serializer_context()
        )
        return Response(read_serializer.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def perform_update(self, serializer):
        profile = serializer.instance
        user = self.request.user
        if profile.user != user and not user.is_staff:
            raise PermissionDenied("You cannot modify this profile.")
        serializer.save()

    def perform_destroy(self, instance):
        user = self.request.user
        if instance.user != user and not user.is_staff:
            raise PermissionDenied("You cannot delete this profile.")
        if instance.profile_photo:
            instance.profile_photo.delete(save=False)
        instance.delete()

    def retrieve(self, request, *args, **kwargs):
        profile = self.get_object()
        if not profile.institutional_email_verified:
            user = request.user
            if not (user.is_authenticated and (user.is_staff or profile.user_id == user.id)):
                raise NotFound("Researcher profile not found.")
        serializer = self.get_serializer(profile)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request, *args, **kwargs):
        profile = self._get_profile_for_user(request.user)
        if profile is None:
            raise NotFound("Researcher profile not found.")
        serializer = ResearcherProfileSerializer(
            profile, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @me.mapping.patch
    def update_me(self, request, *args, **kwargs):
        profile = self._get_profile_for_user(request.user)
        if profile is None:
            raise NotFound("Researcher profile not found.")
        serializer = ResearcherProfileWriteSerializer(
            profile,
            data=request.data,
            partial=True,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()
        read_serializer = ResearcherProfileSerializer(
            profile, context=self.get_serializer_context()
        )
        return Response(read_serializer.data)

    @action(
        detail=False,
        methods=["post", "delete"],
        url_path="me/profile-photo",
        parser_classes=[MultiPartParser, FormParser],
    )
    def profile_photo(self, request, *args, **kwargs):
        profile = self._get_profile_for_user(request.user)
        if profile is None:
            raise NotFound("Researcher profile not found.")
        if request.method == "DELETE":
            if profile.profile_photo:
                profile.profile_photo.delete(save=False)
                profile.profile_photo = None
                profile.save(update_fields=["profile_photo", "updated_at"])
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = ResearcherProfilePhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        image = serializer.validated_data["profile_photo"]
        if profile.profile_photo:
            profile.profile_photo.delete(save=False)
        profile.profile_photo = image
        profile.save(update_fields=["profile_photo", "updated_at"])
        read_serializer = ResearcherProfileSerializer(
            profile, context=self.get_serializer_context()
        )
        return Response(read_serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=False,
        methods=["post"],
        url_path="me/institutional-email/resend",
    )
    def resend_institutional_email(self, request, *args, **kwargs):
        profile = self._get_profile_for_user(request.user)
        if profile is None:
            raise NotFound("Researcher profile not found.")
        if profile.institutional_email_verified:
            return Response(
                {"detail": "Institutional email already verified."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not profile.institutional_email:
            return Response(
                {"detail": "Institutional email is missing."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.initiate_institutional_email_verification()
        return Response(
            {"detail": "Verification email has been sent."},
            status=status.HTTP_200_OK,
        )

    def _get_profile_for_user(self, user):
        if not user.is_authenticated:
            return None
        return (
            ResearcherProfile.objects.select_related("user")
            .prefetch_related(
                "experiences",
                "researcher_publications__publication",
                "researcher_publications__publication__journal",
            )
            .filter(user=user)
            .first()
        )


class HomeSummaryView(APIView):
    permission_classes = (permissions.AllowAny,)

    def get(self, request, *args, **kwargs):
        now = timezone.now()
        recent_window = now - timedelta(days=30)

        verified_qs = ResearcherProfile.objects.filter(
            institutional_email_verified=True
        )
        metrics = {
            "verified_researchers": verified_qs.count(),
            "new_verified_last_30_days": verified_qs.filter(
                institutional_email_verified_at__gte=recent_window
            ).count(),
            "total_publications": Publication.objects.count(),
            "publications_added_last_30_days": Publication.objects.filter(
                created_at__gte=recent_window
            ).count(),
            "total_journals": Journal.objects.count(),
            "active_journals": Journal.objects.filter(is_active=True).count(),
        }

        return Response({"metrics": metrics})


class AdminUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = (permissions.IsAdminUser,)

    def get_serializer_class(self):
        if self.action == "create":
            return AdminInviteSerializer
        return UserSerializer

    def perform_create(self, serializer):
        serializer.save()

    @action(detail=True, methods=["post"], url_path="trigger-reset")
    def trigger_reset(self, request, pk=None):
        user = self.get_object()
        serializer = PasswordResetRequestSerializer(data={"email": user.email})
        serializer.is_valid(raise_exception=True)
        serializer.save(triggered_by_admin=True)
        return Response({"detail": "Password reset email sent"}, status=status.HTTP_200_OK)


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer


class UserTokenRefreshView(TokenRefreshView):
    pass


class UserTokenVerifyView(TokenVerifyView):
    pass


class JournalViewSet(viewsets.ModelViewSet):
    queryset = Journal.objects.all()
    serializer_class = JournalSerializer
    permission_classes = (permissions.IsAuthenticatedOrReadOnly,)
    lookup_field = "slug"
    pagination_class = ClientPageNumberPagination
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = ("name", "publisher", "chief_editor",
                     "description", "oai_url")
    ordering_fields = ("name", "created_at", "updated_at")
    ordering = ("name",)

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [permissions.IsAdminUser()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self, "action", None) == "retrieve":
            publication_prefetch = Prefetch(
                "publications",
                queryset=Publication.objects.order_by("-issued", "-created_at")
                .prefetch_related("metadata_entries")[:5],
                to_attr="recent_publications",
            )
            return queryset.prefetch_related(publication_prefetch)
        return queryset

    def get_serializer_class(self):
        if self.action == "retrieve":
            return JournalDetailSerializer
        return super().get_serializer_class()


class PublicationViewSet(viewsets.ModelViewSet):
    queryset = Publication.objects.select_related(
        "journal").prefetch_related("metadata_entries")
    serializer_class = PublicationSerializer
    permission_classes = (permissions.IsAuthenticatedOrReadOnly,)
    lookup_field = "slug"
    pagination_class = ClientPageNumberPagination
    filter_backends = (filters.SearchFilter, filters.OrderingFilter)
    search_fields = (
        "title",
        "description",
        "publisher",
        "metadata_entries__value",
    )
    ordering_fields = (
        "title",
        "issued",
        "created_at",
        "updated_at",
    )
    ordering = ("title",)

    FACET_TOP_LIMIT = 5
    FACET_PAGE_SIZE_DEFAULT = 25
    FACET_PAGE_SIZE_MAX = 100

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [permissions.IsAdminUser()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        journal_slug = params.get("journal")
        journal_id = params.get("journal_id")
        if journal_slug:
            queryset = queryset.filter(journal__slug=journal_slug)
        elif journal_id:
            queryset = queryset.filter(journal__id=journal_id)

        issued_from = params.get("issued_from")
        issued_to = params.get("issued_to")
        if issued_from:
            start_date = _parse_date_boundary(issued_from)
            if start_date:
                queryset = queryset.filter(issued__gte=start_date)
        if issued_to:
            end_date = _parse_date_boundary(issued_to, end_of_period=True)
            if end_date:
                queryset = queryset.filter(issued__lte=end_date)

        issued_year_values: list[int] = []
        for value in params.getlist("issued_year"):
            try:
                year_value = int(str(value).strip())
            except (TypeError, ValueError):
                continue
            if 1000 <= year_value <= 9999:
                issued_year_values.append(year_value)
        if issued_year_values:
            queryset = queryset.filter(issued__year__in=issued_year_values)

        metadata_filters_applied = False

        subject_param = params.get("subject")
        if subject_param:
            terms = [term.strip()
                     for term in subject_param.split(",") if term.strip()]
            if terms:
                subject_query = Q()
                for term in terms:
                    subject_query |= Q(
                        metadata_entries__schema__iexact="dc",
                        metadata_entries__element__iexact="subject",
                        metadata_entries__value__icontains=term,
                    )
                if subject_query:
                    queryset = queryset.filter(subject_query)
                    metadata_filters_applied = True

        author_param_values = params.getlist("author")
        author_terms = []
        for raw_value in author_param_values:
            if not raw_value:
                continue
            candidate = str(raw_value).strip()
            if candidate:
                author_terms.append(candidate)
        if author_terms:
            author_query = Q()
            for author_value in author_terms:
                author_query |= Q(
                    metadata_entries__schema__iexact="dc",
                    metadata_entries__element__iexact="creator",
                    metadata_entries__value__iexact=author_value,
                )
            if author_query:
                queryset = queryset.filter(author_query)
                metadata_filters_applied = True

        if metadata_filters_applied:
            queryset = queryset.distinct()
        return queryset

    def _get_author_facets_queryset(self, queryset):
        metadata_qs = PublicationMetadata.objects.filter(
            publication__in=queryset,
            schema__iexact="dc",
            element__iexact="creator",
        ).annotate(
            normalized_value=Lower(Trim("value")),
            raw_label=Trim("value"),
        ).exclude(raw_label__exact="")

        return metadata_qs.values("normalized_value").annotate(
            label=Min("raw_label"),
            count=Count("publication", distinct=True),
        ).exclude(normalized_value__isnull=True).order_by("-count", "label")

    def _get_subject_facets_queryset(self, queryset):
        metadata_qs = PublicationMetadata.objects.filter(
            publication__in=queryset,
            schema__iexact="dc",
            element__iexact="subject",
        ).annotate(
            normalized_value=Lower(Trim("value")),
            raw_label=Trim("value"),
        ).exclude(raw_label__exact="")

        return metadata_qs.values("normalized_value").annotate(
            label=Min("raw_label"),
            count=Count("publication", distinct=True),
        ).exclude(normalized_value__isnull=True).order_by("-count", "label")

    def _get_journal_facets_queryset(self, queryset):
        return queryset.exclude(journal__isnull=True).values(
            "journal__slug",
            "journal__name",
        ).annotate(
            count=Count("id", distinct=True),
        ).order_by("-count", "journal__name")

    def _get_issued_year_facets_queryset(self, queryset):
        return queryset.exclude(issued__isnull=True).annotate(
            issued_year=ExtractYear("issued"),
        ).values("issued_year").annotate(
            count=Count("id", distinct=True),
        ).order_by("-count", "-issued_year")

    def _build_more_link(self, request, facet_name: str) -> str | None:
        if request is None:
            return None
        try:
            base_url = reverse(
                "publication-facets", kwargs={"facet_name": facet_name}, request=request)
        except Exception:
            return None

        params = request.query_params.copy()
        params.pop("page", None)
        params.pop("page_size", None)
        query_string = params.urlencode()
        if query_string:
            return f"{base_url}?{query_string}"
        return base_url

    def _serialize_facet_items(self, facet_name: str, rows, active_lookup) -> list[dict[str, object]]:
        items: list[dict[str, object]] = []
        for row in rows:
            if facet_name == "authors":
                label = (row.get("label") or "").strip()
                normalized = (row.get("normalized_value")
                              or "").strip().lower()
                value = label
            elif facet_name == "subjects":
                label = (row.get("label") or "").strip()
                normalized = (row.get("normalized_value")
                              or "").strip().lower()
                value = label
            elif facet_name == "journals":
                value = row.get("journal__slug")
                label = (row.get("journal__name") or value or "").strip()
                normalized = (value or "").strip()
            elif facet_name == "issued_years":
                year_value = row.get("issued_year")
                if year_value is None:
                    continue
                value = str(int(year_value))
                label = value
                normalized = value
            else:
                continue

            if not value:
                continue

            try:
                count = int(row.get("count", 0))
            except (TypeError, ValueError):
                count = 0

            is_active = normalized in active_lookup if normalized else False
            items.append({
                "value": value,
                "label": label,
                "count": count,
                "active": is_active,
            })
        return items

    def _get_active_facet_values(self, request):
        params = request.query_params if request else QueryDict(mutable=False)
        active_author_values = [
            value.strip()
            for value in params.getlist("author")
            if isinstance(value, str) and value.strip()
        ]
        active_authors = {value.lower() for value in active_author_values}

        subject_param = params.get("subject") if request else None
        active_subjects = set()
        if subject_param:
            for part in subject_param.split(","):
                if part.strip():
                    active_subjects.add(part.strip().lower())

        active_journal = params.get("journal") if request else None
        active_years = {
            str(value).strip()
            for value in params.getlist("issued_year") if str(value).strip()
        }

        issued_from = params.get("issued_from") if request else None
        issued_to = params.get("issued_to") if request else None
        if issued_from and issued_to and issued_from == issued_to:
            active_years.add(issued_from.strip())

        return {
            "authors": active_authors,
            "subjects": active_subjects,
            "journals": {active_journal} if active_journal else set(),
            "issued_years": active_years,
        }

    def get_facets(self, request, queryset):
        search_query = (request.query_params.get("search") or "").strip()
        if search_query:
            search_facets = self._build_search_facets(request, search_query)
            if search_facets is not None:
                return search_facets
        return self._build_database_facets(request, queryset)

    def _build_search_facets(self, request, search_query: str):
        params = PublicationSearchFacetMixin._ensure_query_dict(
            request.query_params)
        mutable_params = params.copy()
        mutable_params._mutable = True
        if "search" in mutable_params:
            mutable_params.pop("search")
        mutable_params["q"] = search_query
        mutable_params._mutable = False

        search = PublicationSearchView._build_search(
            mutable_params, search_query)
        search = PublicationSearchFacetMixin._add_aggregations(
            search, self.FACET_TOP_LIMIT)
        search = search[0:0]
        try:
            response = search.execute()
        except TransportError:
            return None

        facets = PublicationSearchFacetMixin._build_facets(
            request,
            getattr(response, "aggregations", None),
            "publication-search-facets",
            self.FACET_TOP_LIMIT,
        )

        for facet in facets.values():
            more_url = facet.get("more_url")
            if isinstance(more_url, str) and "search=" in more_url:
                facet["more_url"] = more_url.replace("search=", "q=")

        return facets

    def _build_database_facets(self, request, queryset):
        active_lookup = self._get_active_facet_values(request)

        facets = {}

        author_qs = self._get_author_facets_queryset(queryset)
        author_total = author_qs.count()
        author_items = self._serialize_facet_items(
            "authors",
            author_qs[:self.FACET_TOP_LIMIT],
            active_lookup.get("authors", set()),
        )
        facets["authors"] = {
            "param": "author",
            "items": author_items,
            "total": author_total,
            "more_url": self._build_more_link(request, "authors") if author_total > self.FACET_TOP_LIMIT else None,
        }

        subject_qs = self._get_subject_facets_queryset(queryset)
        subject_total = subject_qs.count()
        subject_items = self._serialize_facet_items(
            "subjects",
            subject_qs[:self.FACET_TOP_LIMIT],
            active_lookup.get("subjects", set()),
        )
        facets["subjects"] = {
            "param": "subject",
            "items": subject_items,
            "total": subject_total,
            "more_url": self._build_more_link(request, "subjects") if subject_total > self.FACET_TOP_LIMIT else None,
        }

        journal_qs = self._get_journal_facets_queryset(queryset)
        journal_total = journal_qs.count()
        journal_items = self._serialize_facet_items(
            "journals",
            journal_qs[:self.FACET_TOP_LIMIT],
            active_lookup.get("journals", set()),
        )
        facets["journals"] = {
            "param": "journal",
            "items": journal_items,
            "total": journal_total,
            "more_url": self._build_more_link(request, "journals") if journal_total > self.FACET_TOP_LIMIT else None,
        }

        year_qs = self._get_issued_year_facets_queryset(queryset)
        year_total = year_qs.count()
        year_items = self._serialize_facet_items(
            "issued_years",
            year_qs[:self.FACET_TOP_LIMIT],
            active_lookup.get("issued_years", set()),
        )
        facets["issued_years"] = {
            "param": "issued_year",
            "items": year_items,
            "total": year_total,
            "more_url": self._build_more_link(request, "issued_years") if year_total > self.FACET_TOP_LIMIT else None,
        }

        return facets

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        response = super().list(request, *args, **kwargs)
        if hasattr(response, "data") and isinstance(response.data, dict):
            response.data["facets"] = self.get_facets(request, queryset)
        return response

    @action(detail=False, methods=["get"], url_path=r"facets/(?P<facet_name>[^/]+)")
    def facets(self, request, facet_name=None):
        facet_name = (facet_name or "").strip().lower()
        queryset = self.filter_queryset(self.get_queryset())
        active_lookup = self._get_active_facet_values(request)

        if facet_name in {"author", "authors"}:
            facet_name = "authors"
            facet_qs = self._get_author_facets_queryset(queryset)
            param_name = "author"
            active_values = active_lookup["authors"]
        elif facet_name in {"subject", "subjects"}:
            facet_name = "subjects"
            facet_qs = self._get_subject_facets_queryset(queryset)
            param_name = "subject"
            active_values = active_lookup["subjects"]
        elif facet_name in {"journal", "journals"}:
            facet_name = "journals"
            facet_qs = self._get_journal_facets_queryset(queryset)
            param_name = "journal"
            active_values = active_lookup["journals"]
        elif facet_name in {"issued", "issued_year", "issued_years", "year", "years"}:
            facet_qs = self._get_issued_year_facets_queryset(queryset)
            facet_name = "issued_years"
            param_name = "issued_year"
            active_values = active_lookup["issued_years"]
        else:
            raise ValidationError({"facet": "Unsupported facet."})

        try:
            page = max(1, int(request.query_params.get("page", "1")))
        except (TypeError, ValueError):
            page = 1

        try:
            page_size = int(request.query_params.get(
                "page_size", self.FACET_PAGE_SIZE_DEFAULT))
        except (TypeError, ValueError):
            page_size = self.FACET_PAGE_SIZE_DEFAULT

        page_size = max(1, min(page_size, self.FACET_PAGE_SIZE_MAX))

        total = facet_qs.count()
        total_pages = max(1, math.ceil(total / page_size)) if total else 1
        if page > total_pages:
            page = total_pages

        start = (page - 1) * page_size
        end = start + page_size
        rows = list(facet_qs[start:end])

        items = self._serialize_facet_items(facet_name, rows, active_values)

        base_url = request.build_absolute_uri(request.path)
        params = request.query_params.copy()
        params.pop("page", None)
        params.pop("page_size", None)
        query_string = params.urlencode()

        def _make_link(target_page: int) -> str | None:
            if target_page < 1 or target_page > total_pages:
                return None
            combined_params = params.copy()
            if target_page > 1:
                combined_params["page"] = str(target_page)
            if page_size != self.FACET_PAGE_SIZE_DEFAULT:
                combined_params["page_size"] = str(page_size)
            qs = combined_params.urlencode()
            if qs:
                return f"{base_url}?{qs}"
            return base_url

        next_link = _make_link(page + 1)
        previous_link = _make_link(page - 1)

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "next": next_link,
            "previous": previous_link,
            "param": param_name,
            "results": items,
        })


class PublicationSearchFacetMixin:
    FACET_TOP_LIMIT = 5
    FACET_PAGE_SIZE_DEFAULT = 25
    FACET_PAGE_SIZE_MAX = 100
    MAX_FACET_BUCKETS = 1000
    FACET_PARAM_MAP = {
        "authors": "author",
        "subjects": "subject",
        "journals": "journal",
        "issued_years": "issued_year",
    }

    @classmethod
    def _ensure_query_dict(cls, params) -> QueryDict:
        if isinstance(params, QueryDict):
            return params
        query_dict = QueryDict(mutable=True)
        if isinstance(params, dict):
            for key, value in params.items():
                if isinstance(value, (list, tuple)):
                    for item in value:
                        query_dict.appendlist(key, str(item))
                elif value is not None:
                    query_dict[key] = str(value)
        query_dict._mutable = False
        return query_dict

    @classmethod
    def _normalize_text(cls, value: str | None) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip().lower()

    @classmethod
    def _get_subject_terms(cls, params: QueryDict) -> list[str]:
        subject_param = params.get("subject", "")
        if not subject_param:
            return []
        return [term.strip() for term in subject_param.split(",") if term.strip()]

    @classmethod
    def _get_author_values(cls, params: QueryDict) -> list[str]:
        return [value.strip() for value in params.getlist("author") if value and value.strip()]

    @classmethod
    def _get_year_filters(cls, params: QueryDict) -> list[int]:
        years: list[int] = []
        for raw in params.getlist("issued_year"):
            try:
                year = int(str(raw).strip())
            except (TypeError, ValueError):
                continue
            if 1000 <= year <= 9999:
                years.append(year)
        return years

    @classmethod
    def _get_active_facet_values(cls, params: QueryDict) -> dict[str, set[str]]:
        active_authors = {cls._normalize_text(value) for value in params.getlist(
            "author") if value and value.strip()}

        active_subjects = set()
        subject_param = params.get("subject")
        if subject_param:
            for part in subject_param.split(","):
                if part.strip():
                    active_subjects.add(part.strip().lower())

        active_journal = params.get("journal")
        active_years = {str(value).strip()
                        for value in params.getlist("issued_year") if str(value).strip()}

        issued_from = params.get("issued_from")
        issued_to = params.get("issued_to")
        if issued_from and issued_to and issued_from == issued_to:
            active_years.add(issued_from.strip())

        return {
            "authors": active_authors,
            "subjects": active_subjects,
            "journals": {active_journal} if active_journal else set(),
            "issued_years": active_years,
        }

    @classmethod
    def _facet_param_name(cls, facet_name: str) -> str:
        return cls.FACET_PARAM_MAP.get(facet_name, facet_name)

    @classmethod
    def _build_more_link(cls, request, facet_name: str, route_name: str) -> str | None:
        if request is None:
            return None
        try:
            base_url = reverse(route_name, kwargs={
                               "facet_name": facet_name}, request=request)
        except Exception:
            return None

        params = request.query_params.copy()
        params.pop("page", None)
        params.pop("page_size", None)
        query_string = params.urlencode()
        if query_string:
            return f"{base_url}?{query_string}"
        return base_url

    @classmethod
    def _extract_author_buckets(cls, aggregations) -> tuple[list[dict[str, object]], int]:
        buckets = []
        agg = getattr(aggregations, "authors", None)
        total = int(getattr(getattr(aggregations, "authors_total",
                    None), "value", 0)) if aggregations else 0
        for bucket in getattr(agg, "buckets", []):
            key = bucket.get("key") if isinstance(
                bucket, dict) else getattr(bucket, "key", None)
            if not key:
                continue
            count = int(bucket.get("doc_count", 0)) if isinstance(
                bucket, dict) else int(getattr(bucket, "doc_count", 0))
            text_key = str(key)
            buckets.append({
                "value": text_key,
                "label": text_key,
                "count": count,
                "normalized": text_key.strip().lower(),
            })
        if not total:
            total = len(buckets)
        return buckets, total

    @classmethod
    def _extract_subject_buckets(cls, aggregations) -> tuple[list[dict[str, object]], int]:
        buckets = []
        agg = getattr(aggregations, "subjects", None)
        total = int(getattr(getattr(aggregations, "subjects_total",
                    None), "value", 0)) if aggregations else 0
        for bucket in getattr(agg, "buckets", []):
            key = bucket.get("key") if isinstance(
                bucket, dict) else getattr(bucket, "key", None)
            if not key:
                continue
            count = int(bucket.get("doc_count", 0)) if isinstance(
                bucket, dict) else int(getattr(bucket, "doc_count", 0))
            text_key = str(key)
            buckets.append({
                "value": text_key,
                "label": text_key,
                "count": count,
                "normalized": text_key.strip().lower(),
            })
        if not total:
            total = len(buckets)
        return buckets, total

    @classmethod
    def _extract_journal_buckets(cls, aggregations) -> tuple[list[dict[str, object]], int]:
        buckets = []
        agg = getattr(aggregations, "journals", None)
        total = int(getattr(getattr(aggregations, "journals_total",
                    None), "value", 0)) if aggregations else 0
        for bucket in getattr(agg, "buckets", []):
            key = bucket.get("key") if isinstance(
                bucket, dict) else getattr(bucket, "key", None)
            if not key:
                continue
            count = int(bucket.get("doc_count", 0)) if isinstance(
                bucket, dict) else int(getattr(bucket, "doc_count", 0))
            slug = str(key)
            label = slug
            top_hits = bucket.get("top_name") if isinstance(
                bucket, dict) else getattr(bucket, "top_name", None)
            if top_hits is not None:
                hits = getattr(getattr(top_hits, "hits", None), "hits", [])
                if hits:
                    first_hit = hits[0]
                    if isinstance(first_hit, dict):
                        source = first_hit.get("_source", {})
                    else:
                        source = getattr(first_hit, "_source", {})
                        if not isinstance(source, dict):
                            source = getattr(source, "to_dict", lambda: {})()
                    if isinstance(source, dict):
                        label = source.get("journal_name", label)
            buckets.append({
                "value": slug,
                "label": label,
                "count": count,
                "normalized": slug.strip(),
            })
        if not total:
            total = len(buckets)
        return buckets, total

    @classmethod
    def _extract_year_buckets(cls, aggregations) -> tuple[list[dict[str, object]], int]:
        buckets = []
        agg = getattr(aggregations, "issued_years", None)
        total = int(getattr(getattr(aggregations, "issued_years_total",
                    None), "value", 0)) if aggregations else 0
        for bucket in getattr(agg, "buckets", []):
            key = bucket.get("key") if isinstance(
                bucket, dict) else getattr(bucket, "key", None)
            if key is None:
                continue
            if isinstance(key, (int, float)):
                year = datetime.utcfromtimestamp(key / 1000).year
            else:
                key_str = str(key)
                try:
                    year = datetime.fromisoformat(
                        key_str.replace("Z", "+00:00")).year
                except ValueError:
                    try:
                        year = int(key_str[:4])
                    except (TypeError, ValueError):
                        continue
            count = int(bucket.get("doc_count", 0)) if isinstance(
                bucket, dict) else int(getattr(bucket, "doc_count", 0))
            year_text = str(year)
            buckets.append({
                "value": year_text,
                "label": year_text,
                "count": count,
                "normalized": year_text,
            })
        if not total:
            total = len(buckets)
        return buckets, total

    @classmethod
    def _extract_facet_buckets(cls, aggregations, facet_name: str) -> tuple[list[dict[str, object]], int]:
        if aggregations is None:
            return [], 0
        if facet_name == "authors":
            return cls._extract_author_buckets(aggregations)
        if facet_name == "subjects":
            return cls._extract_subject_buckets(aggregations)
        if facet_name == "journals":
            return cls._extract_journal_buckets(aggregations)
        if facet_name == "issued_years":
            return cls._extract_year_buckets(aggregations)
        return [], 0

    @classmethod
    def _build_facets(cls, request, aggregations, route_name: str, limit: int):
        params = cls._ensure_query_dict(
            request.query_params if request else QueryDict(mutable=False))
        active_lookup = cls._get_active_facet_values(params)

        facets: dict[str, dict[str, object]] = {}
        for facet_name in ("authors", "subjects", "journals", "issued_years"):
            buckets, total = cls._extract_facet_buckets(
                aggregations, facet_name)
            active_set = active_lookup.get(facet_name, set())
            items = []
            for bucket in buckets[:limit]:
                normalized = bucket.get("normalized", "")
                items.append({
                    "value": bucket.get("value"),
                    "label": bucket.get("label"),
                    "count": bucket.get("count", 0),
                    "active": normalized in active_set if normalized else False,
                })

            facets[facet_name] = {
                "param": cls._facet_param_name(facet_name),
                "items": items,
                "total": total,
                "more_url": cls._build_more_link(request, facet_name, route_name) if total > limit else None,
            }

        return facets

    @classmethod
    def _collect_facet_results(cls, aggregations, facet_name: str) -> tuple[list[dict[str, object]], int]:
        return cls._extract_facet_buckets(aggregations, facet_name)

    @classmethod
    def _add_aggregations(cls, search, bucket_size: int):
        search.aggs.bucket(
            "authors",
            "terms",
            field="creator.raw",
            size=bucket_size,
            order={"_count": "desc"}
        )
        search.aggs.metric(
            "authors_total",
            "cardinality",
            field="creator.raw"
        )

        search.aggs.bucket(
            "subjects",
            "terms",
            field="subject.raw",
            size=bucket_size,
            order={"_count": "desc"}
        )
        search.aggs.metric(
            "subjects_total",
            "cardinality",
            field="subject.raw"
        )

        journals_bucket = search.aggs.bucket(
            "journals",
            "terms",
            field="journal_slug",
            size=bucket_size,
            order={"_count": "desc"}
        )
        journals_bucket.metric(
            "top_name",
            "top_hits",
            size=1,
            _source={"includes": ["journal_name"]}
        )
        search.aggs.metric(
            "journals_total",
            "cardinality",
            field="journal_slug"
        )

        issued_years_bucket = search.aggs.bucket(
            "issued_years",
            "date_histogram",
            field="issued",
            calendar_interval="year",
            min_doc_count=1
        )
        issued_years_bucket.pipeline(
            "issued_years_sort",
            "bucket_sort",
            sort=[{"_count": {"order": "desc"}}, {"_key": {"order": "desc"}}],
            size=bucket_size,
        )
        search.aggs.metric(
            "issued_years_total",
            "cardinality",
            script="doc['issued'].value.year"
        )

        return search


class PublicationSearchView(PublicationSearchFacetMixin, APIView):
    permission_classes = (permissions.AllowAny,)
    pagination_class = ClientPageNumberPagination

    @classmethod
    def _build_search(cls, params: QueryDict, query: str):
        search = PublicationDocument.search()
        must_clauses = []
        filter_clauses = []

        normalized_query = query.strip()
        if normalized_query:
            must_clauses.append(ES_Q(
                "multi_match",
                query=normalized_query,
                fields=[
                    "title",
                    "creator",
                    "subject",
                    "description",
                    "publisher",
                    "contributor",
                    "identifier",
                    "source",
                    "relation",
                    "coverage",
                    "rights",
                    "metadata_text",
                    "journal_name",
                ],
                fuzziness="AUTO",
            ))

        subject_terms = cls._get_subject_terms(params)
        for term in subject_terms:
            must_clauses.append(ES_Q("match", subject=term))

        author_values = cls._get_author_values(params)
        if author_values:
            filter_clauses.append(
                ES_Q("terms", **{"creator.raw": author_values}))

        journal_slug = params.get("journal")
        if journal_slug:
            filter_clauses.append(ES_Q("term", journal_slug=journal_slug))

        issued_from = _parse_date_boundary(params.get("issued_from"))
        if issued_from:
            filter_clauses.append(
                ES_Q("range", issued={"gte": issued_from.isoformat()}))

        issued_to = _parse_date_boundary(
            params.get("issued_to"), end_of_period=True)
        if issued_to:
            filter_clauses.append(
                ES_Q("range", issued={"lte": issued_to.isoformat()}))

        issued_years = cls._get_year_filters(params)
        if issued_years:
            year_filters = []
            for year in issued_years:
                start_of_year = date(year, 1, 1)
                end_of_year = date(year, 12, 31)
                year_filters.append(ES_Q("range", issued={
                    "gte": start_of_year.isoformat(),
                    "lte": end_of_year.isoformat(),
                }))
            if year_filters:
                filter_clauses.append(
                    ES_Q("bool", should=year_filters, minimum_should_match=1))

        if must_clauses or filter_clauses:
            def _normalize_clause(clause):
                return clause.to_dict() if hasattr(clause, "to_dict") else clause

            bool_kwargs: dict[str, object] = {}
            if must_clauses:
                bool_kwargs["must"] = [_normalize_clause(
                    clause) for clause in must_clauses]
            if filter_clauses:
                bool_kwargs["filter"] = [_normalize_clause(
                    clause) for clause in filter_clauses]
            search = search.query("bool", **bool_kwargs)
        else:
            search = search.query("match_all")

        return search

    def get(self, request, *args, **kwargs):
        params = self._ensure_query_dict(request.query_params)
        query = params.get("q", "").strip()
        paginator = self.pagination_class()
        page_size = paginator.get_page_size(request) or paginator.page_size
        try:
            page_number = int(params.get("page", "1"))
        except ValueError:
            page_number = 1
        if page_number < 1:
            page_number = 1

        search = self._build_search(params, query)
        if not query:
            search = search.sort("-created_at")

        search = self._add_aggregations(search, self.FACET_TOP_LIMIT)

        start = (page_number - 1) * page_size
        search_slice = search[start:start + page_size]

        try:
            response = search_slice.execute()
        except TransportError:
            return Response(
                {"detail": "Search service is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        hits = list(response)
        total_object = getattr(getattr(response, "hits", None), "total", None)
        if isinstance(total_object, dict):
            total_count = total_object.get("value", len(hits))
        elif hasattr(total_object, "value"):
            total_count = getattr(total_object, "value", len(hits))
        else:
            total_count = len(hits)

        total_pages = max(1, math.ceil(
            total_count / page_size)) if total_count else 1
        if (total_count == 0 and page_number > 1) or (total_count > 0 and page_number > total_pages):
            raise NotFound("Invalid page.")

        hit_ids = [str(hit.meta.id) for hit in hits]
        publications = Publication.objects.filter(
            id__in=hit_ids).prefetch_related("metadata_entries")
        publication_map = {str(pub.id): pub for pub in publications}
        ordered_publications = [publication_map[pk]
                                for pk in hit_ids if pk in publication_map]
        serialized = PublicationSerializer(
            ordered_publications,
            many=True,
            context={"request": request},
        ).data

        default_page_size = paginator.page_size or 10
        next_link = self._build_page_link(request, page_number +
                                          1, page_size, default_page_size, total_pages)
        previous_link = self._build_page_link(request, page_number -
                                              1, page_size, default_page_size, total_pages)

        facets = self._build_facets(request, getattr(
            response, "aggregations", None), "publication-search-facets", self.FACET_TOP_LIMIT)

        return Response(
            {
                "count": total_count,
                "next": next_link,
                "previous": previous_link,
                "results": serialized,
                "facets": facets,
            }
        )

    def _build_page_link(self, request, target_page, page_size, default_page_size, total_pages):
        if target_page < 1 or target_page > total_pages:
            return None

        params = request.query_params.dict()
        if target_page == 1:
            params.pop("page", None)
        else:
            params["page"] = str(target_page)

        if page_size == default_page_size:
            params.pop("page_size", None)
        else:
            params["page_size"] = str(page_size)

        base_url = request.build_absolute_uri(request.path)
        if not params:
            return base_url
        return f"{base_url}?{urlencode(params)}"


class PublicationSearchFacetView(PublicationSearchFacetMixin, APIView):
    permission_classes = (permissions.AllowAny,)

    def get(self, request, facet_name: str, *args, **kwargs):
        facet_key = (facet_name or "").strip().lower()
        if facet_key in {"author", "authors"}:
            facet_key = "authors"
        elif facet_key in {"subject", "subjects"}:
            facet_key = "subjects"
        elif facet_key in {"journal", "journals"}:
            facet_key = "journals"
        elif facet_key in {"issued", "issued_year", "issued_years", "year", "years"}:
            facet_key = "issued_years"
        else:
            raise ValidationError({"facet": "Unsupported facet."})

        params = self._ensure_query_dict(request.query_params)
        query = params.get("q", "")

        search = PublicationSearchView._build_search(params, query)
        search = self._add_aggregations(search, self.MAX_FACET_BUCKETS)
        search = search[0:0]

        try:
            response = search.execute()
        except TransportError:
            return Response(
                {"detail": "Search service is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        buckets, total = self._collect_facet_results(
            getattr(response, "aggregations", None), facet_key)
        active_values = self._get_active_facet_values(
            params).get(facet_key, set())

        try:
            page = max(1, int(params.get("page", "1")))
        except (TypeError, ValueError):
            page = 1

        try:
            page_size = int(params.get(
                "page_size", self.FACET_PAGE_SIZE_DEFAULT))
        except (TypeError, ValueError):
            page_size = self.FACET_PAGE_SIZE_DEFAULT

        page_size = max(1, min(page_size, self.FACET_PAGE_SIZE_MAX))

        total_pages = max(1, math.ceil(total / page_size)) if total else 1
        if page > total_pages:
            page = total_pages

        start = (page - 1) * page_size
        end = start + page_size
        sliced_buckets = buckets[start:end]

        items = []
        for bucket in sliced_buckets:
            normalized = bucket.get("normalized", "")
            items.append({
                "value": bucket.get("value"),
                "label": bucket.get("label"),
                "count": bucket.get("count", 0),
                "active": normalized in active_values if normalized else False,
            })

        base_url = request.build_absolute_uri(request.path)
        params_for_links = params.copy()
        params_for_links.pop("page", None)
        params_for_links.pop("page_size", None)

        def _make_link(target_page: int) -> str | None:
            if target_page < 1 or target_page > total_pages:
                return None
            query_params = params_for_links.copy()
            if target_page > 1:
                query_params["page"] = str(target_page)
            if page_size != self.FACET_PAGE_SIZE_DEFAULT:
                query_params["page_size"] = str(page_size)
            query_string = query_params.urlencode()
            if query_string:
                return f"{base_url}?{query_string}"
            return base_url

        next_link = _make_link(page + 1)
        previous_link = _make_link(page - 1)

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "next": next_link,
            "previous": previous_link,
            "param": self._facet_param_name(facet_key),
            "results": items,
        })


class JournalOAIValidationView(APIView):
    permission_classes = (permissions.IsAdminUser,)

    def post(self, request, *args, **kwargs):
        serializer = OAIEndpointTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = validate_oai_endpoint(serializer.validated_data["oai_url"])
        status_code = status.HTTP_200_OK if result.ok else status.HTTP_400_BAD_REQUEST
        return Response({"ok": result.ok, "detail": result.message}, status=status_code)


class ResearcherInstitutionalEmailVerificationView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request, *args, **kwargs):
        token_value = request.data.get("token")
        if not token_value:
            raise ValidationError({"token": "Verification token is required."})
        try:
            token = ResearcherInstitutionalEmailToken.objects.select_related("profile").get(
                token=token_value
            )
        except ResearcherInstitutionalEmailToken.DoesNotExist as exc:
            raise ValidationError(
                {"token": "Invalid or expired token."}) from exc

        if token.is_used:
            raise ValidationError({"token": "Token has already been used."})
        if token.is_expired():
            raise ValidationError({"token": "Token has expired."})

        profile = token.profile
        if not profile.institutional_email:
            raise ValidationError(
                {"token": "Profile is missing institutional email."})
        if profile.institutional_email.lower() != token.email.lower():
            raise ValidationError({"token": "Institutional email mismatch."})

        profile.mark_institutional_email_verified()
        token.mark_used()
        return Response({"detail": "Institutional email verified successfully."}, status=status.HTTP_200_OK)
