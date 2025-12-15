from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from elasticsearch.exceptions import TransportError
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    Journal,
    Publication,
    ResearcherInstitutionalEmailToken,
    ResearcherProfile,
    UserToken,
)


User = get_user_model()


class SessionConfigTests(APITestCase):
    def test_refresh_token_lifetime_is_two_hours(self):
        self.assertEqual(
            settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'], timedelta(hours=2))

    def test_session_cookie_age_is_two_hours(self):
        self.assertEqual(settings.SESSION_COOKIE_AGE, 60 * 60 * 2)
        self.assertTrue(settings.SESSION_SAVE_EVERY_REQUEST)


class AuthenticationTests(APITestCase):
    def test_user_registration_and_verification_flow(self):
        response = self.client.post(
            reverse("auth-register"),
            {
                "email": "alice@example.com",
                "first_name": "Alice",
                "password": "Secretpass123",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email="alice@example.com")
        self.assertFalse(user.is_active)
        token = UserToken.objects.get(
            user=user, token_type=UserToken.REGISTRATION)

        verify_response = self.client.post(
            reverse("auth-verify-email"),
            {"token": token.token},
            format="json",
        )
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_verified)

    def test_login_requires_verified_email(self):
        user = User.objects.create_user(
            email="bob@example.com", password="Secretpass123", is_active=False)
        token = self.client.post(
            reverse("auth-token"),
            {"email": "bob@example.com", "password": "Secretpass123"},
            format="json",
        )
        self.assertEqual(token.status_code, status.HTTP_400_BAD_REQUEST)

        user.is_active = True
        user.is_verified = True
        user.save(update_fields=["is_active", "is_verified"])
        token = self.client.post(
            reverse("auth-token"),
            {"email": "bob@example.com", "password": "Secretpass123"},
            format="json",
        )
        self.assertEqual(token.status_code, status.HTTP_200_OK)
        self.assertIn("access", token.data)
        self.assertIn("refresh", token.data)

    def test_password_reset_flow(self):
        user = User.objects.create_user(
            email="carol@example.com", password="Secretpass123", is_active=True, is_verified=True)
        response = self.client.post(
            reverse("auth-password-request"),
            {"email": "carol@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token = UserToken.objects.get(user=user, token_type=UserToken.RESET)
        reset_response = self.client.post(
            reverse("auth-password-reset"),
            {"token": token.token, "password": "NewSecret123"},
            format="json",
        )
        self.assertEqual(reset_response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewSecret123"))

    def test_user_can_delete_their_account(self):
        user = User.objects.create_user(
            email="diana@example.com",
            password="Secretpass123",
            is_active=True,
            is_verified=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.delete(reverse("user-profile"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(User.objects.filter(pk=user.pk).exists())


class AdminUserTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email="admin@example.com", password="Adminpass123")
        self.client.force_authenticate(user=self.admin)

    def test_admin_can_invite_user_and_trigger_reset(self):
        response = self.client.post(
            reverse("admin-user-list"),
            {
                "email": "invited@example.com",
                "first_name": "Invited",
                "last_name": "User",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email="invited@example.com")
        token = UserToken.objects.get(user=user, token_type=UserToken.INVITE)
        self.assertFalse(user.is_active)
        self.assertFalse(token.is_used)

        complete_response = self.client.post(
            reverse("auth-invite-complete"),
            {"token": token.token, "password": "InvitePass123"},
            format="json",
        )
        self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_verified)

        trigger_response = self.client.post(
            reverse("admin-user-trigger-reset", args=[user.pk]))
        self.assertEqual(trigger_response.status_code, status.HTTP_200_OK)
        reset_token = UserToken.objects.filter(
            user=user, token_type=UserToken.RESET).latest("created_at")
        self.assertFalse(reset_token.is_used)


class JournalApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email="editor@example.com", password="Adminpass123")

    class PublicationFilterTests(APITestCase):
        def setUp(self):
            self.journal = Journal.objects.create(
                name="Applied Research Journal")
            self.other_journal = Journal.objects.create(
                name="Community Insights Quarterly")

            self.recent_publication = Publication.objects.create(
                journal=self.journal,
                title="Climate Resilience in Northern Kenya",
                issued=date(2023, 5, 20),
            )
            self.recent_publication.metadata_entries.create(
                schema="dc",
                element="subject",
                value="Climate resilience",
            )
            self.recent_publication.metadata_entries.create(
                schema="dc",
                element="subject",
                value="Community adaptation",
            )

            self.older_publication = Publication.objects.create(
                journal=self.journal,
                title="Agricultural Innovation in 2008",
                issued=date(2008, 7, 1),
            )
            self.older_publication.metadata_entries.create(
                schema="dc",
                element="subject",
                value="Agriculture",
            )

            self.other_publication = Publication.objects.create(
                journal=self.other_journal,
                title="Data Science for Policy",
                issued=date(2022, 1, 15),
            )
            self.other_publication.metadata_entries.create(
                schema="dc",
                element="subject",
                value="Data science",
            )

        def _result_slugs(self, response):
            payload = response.data
            items = payload["results"] if isinstance(
                payload, dict) and "results" in payload else payload
            return [item["slug"] for item in items]

        def test_filter_by_journal_and_year_range(self):
            response = self.client.get(
                reverse("publication-list"),
                {
                    "journal": self.journal.slug,
                    "issued_from": "2020",
                    "issued_to": "2024",
                },
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            slugs = self._result_slugs(response)
            self.assertIn(self.recent_publication.slug, slugs)
            self.assertNotIn(self.older_publication.slug, slugs)
            self.assertNotIn(self.other_publication.slug, slugs)

        def test_filter_by_subject_keyword(self):
            response = self.client.get(
                reverse("publication-list"),
                {"subject": "Climate"},
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            slugs = self._result_slugs(response)
            self.assertEqual(slugs.count(self.recent_publication.slug), 1)
            self.assertIn(self.recent_publication.slug, slugs)
            self.assertNotIn(self.older_publication.slug, slugs)

        def test_filter_by_multiple_subject_terms(self):
            response = self.client.get(
                reverse("publication-list"),
                {"subject": "Climate, Data"},
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            slugs = self._result_slugs(response)
            self.assertIn(self.recent_publication.slug, slugs)
            self.assertIn(self.other_publication.slug, slugs)
            self.assertNotIn(self.older_publication.slug, slugs)

    def test_anonymous_can_list_journals(self):
        Journal.objects.create(
            name="African Medical Journal",
            description="**Leading** medical research journal.",
            homepage_url="https://example.com",
            chief_editor="Dr. Grace Mwangi",
            publisher="Healthy Africa Publishing",
        )

        response = self.client.get(reverse("journal-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data
        items = payload["results"] if isinstance(
            payload, dict) and "results" in payload else payload
        self.assertGreaterEqual(len(items), 1)

    def test_only_admin_can_manage_journal(self):
        create_payload = {
            "name": "Kenyan Science Review",
            "description": "Focuses on STEM breakthroughs.",
            "homepage_url": "https://journals.example.org/ksr",
            "oai_url": "https://www.example.org/oai?verb=ListRecords&metadataPrefix=oai_dc",
            "chief_editor": "Prof. Amina Yusuf",
            "publisher": "Nairobi Science Press",
            "language": "English",
            "country": "Kenya",
            "founded_year": 1998,
        }

        # Non-authenticated user cannot create
        response = self.client.post(
            reverse("journal-list"), create_payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Authenticated but non-admin user still blocked
        researcher = User.objects.create_user(
            email="researcher@example.com", password="Research123", is_active=True, is_verified=True
        )
        self.client.force_authenticate(user=researcher)
        response = self.client.post(
            reverse("journal-list"), create_payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=None)

        # Admin can create
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            reverse("journal-list"), create_payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        slug = response.data["slug"]
        detail_url = reverse("journal-detail", args=[slug])

        patch_response = self.client.patch(
            detail_url, {"publisher": "Kenya STEM Press"}, format="json")
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data["publisher"], "Kenya STEM Press")

        delete_response = self.client.delete(detail_url)
        self.assertEqual(delete_response.status_code,
                         status.HTTP_204_NO_CONTENT)

    def test_journal_detail_includes_publications(self):
        journal = Journal.objects.create(
            name="Regional Journal of Information and Knowledge Management",
            oai_url="https://example.org/oai?verb=ListRecords&metadataPrefix=oai_dc",
        )
        publication = Publication.objects.create(
            journal=journal,
            title="Knowledge Management in Africa",
        )

        response = self.client.get(
            reverse("journal-detail", args=[journal.slug]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("publications", response.data)
        publications = response.data["publications"]
        self.assertEqual(len(publications), 1)
        self.assertEqual(publications[0]["slug"], publication.slug)

    def test_admin_can_validate_oai_endpoint(self):
        self.client.force_authenticate(user=self.admin)
        with patch("api.views.validate_oai_endpoint") as mock_validate:
            mock_validate.return_value = SimpleNamespace(ok=True, message="ok")
            response = self.client.post(
                reverse("journal-validate-oai"),
                {"oai_url": "https://example.org/oai"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["ok"])
        mock_validate.assert_called_once()

    def test_non_admin_cannot_validate_oai_endpoint(self):
        user = User.objects.create_user(
            email="member@example.com", password="Pass12345", is_active=True, is_verified=True
        )
        self.client.force_authenticate(user=user)
        response = self.client.post(
            reverse("journal-validate-oai"),
            {"oai_url": "https://example.org/oai"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_publication_search_returns_results(self):
        publication = Publication.objects.create(
            title="Digital Preservation Strategies",
        )
        publication.metadata_entries.create(
            schema="dc",
            element="creator",
            value="Doe, Jane",
        )
        hits = self._DummyHits(
            [SimpleNamespace(meta=SimpleNamespace(id=str(publication.id)))],
            total_value=1,
        )
        response = self._DummyResponse(hits)
        search_instance = self._DummySearch(response)

        with patch("api.views.PublicationDocument.search", return_value=search_instance):
            result = self.client.get(
                reverse("publication-search"), {"q": "digital"})

        self.assertEqual(result.status_code, status.HTTP_200_OK)
        self.assertEqual(result.data["count"], 1)
        self.assertEqual(len(result.data["results"]), 1)
        self.assertEqual(result.data["results"][0]["id"], str(publication.id))

    def test_publication_search_includes_pagination_links(self):
        publication = Publication.objects.create(title="Open Access Policies")
        publication.metadata_entries.create(
            schema="dc",
            element="subject",
            value="Open Access",
        )
        hits = self._DummyHits(
            [SimpleNamespace(meta=SimpleNamespace(
                id=str(publication.id)))],
            total_value=3,
        )
        response = self._DummyResponse(hits)
        search_instance = self._DummySearch(response)

        with patch("api.views.PublicationDocument.search", return_value=search_instance):
            result = self.client.get(
                reverse("publication-search"),
                {"q": "access", "page": 2, "page_size": 1},
            )

        self.assertEqual(result.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(result.data["previous"])
        self.assertIsNotNone(result.data["next"])

    def test_publication_search_handles_service_unavailable(self):
        class FailingSearch:
            def query(self, *args, **kwargs):
                return self

            def sort(self, *args, **kwargs):
                return self

            def __getitem__(self, *_):
                return self

            def execute(self):
                raise TransportError(503, "unavailable")

        with patch("api.views.PublicationDocument.search", return_value=FailingSearch()):
            result = self.client.get(
                reverse("publication-search"), {"q": "digital"})

        self.assertEqual(result.status_code,
                         status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn("detail", result.data)

    def test_client_can_override_page_size(self):
        Journal.objects.all().delete()
        for idx in range(4):
            Journal.objects.create(name=f"Test Journal {idx}")

        response = self.client.get(reverse("journal-list"), {"page_size": 2})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data
        self.assertIn("results", payload)
        self.assertEqual(len(payload["results"]), 2)
        self.assertEqual(payload["count"], 4)

        second_page = self.client.get(
            reverse("journal-list"), {"page_size": 2, "page": 2}
        )
        self.assertEqual(second_page.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second_page.data["results"]), 2)


class ResearcherProfileTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="researcher@example.com",
            password="Research123",
            is_active=True,
            is_verified=True,
        )
        self.publication = Publication.objects.create(
            title="Research Methods Primer")
        mail.outbox.clear()

    def authenticate(self):
        self.client.force_authenticate(user=self.user)

    def _create_profile_payload(self) -> dict:
        return {
            "title": "Dr.",
            "display_name": "Dr. Jane Doe",
            "institutional_email": "jane.doe@university.edu",
            "affiliation": "University of Nairobi",
            "current_position": "Senior Lecturer",
            "short_bio": "Researches digital scholarship across East Africa.",
            "research_interests": "Digital scholarship; Open access",
            "google_scholar_url": "https://scholar.google.com/citations?user=abc123",
            "linkedin_url": "https://www.linkedin.com/in/janedoe",
            "orcid": "0000-0000-0000-0001",
            "personal_website": "https://janedoe.example.edu",
            "experiences": [
                {
                    "employer": "University of Nairobi",
                    "role": "Senior Lecturer",
                    "start_date": "2020-01-01",
                    "is_current": True,
                    "description": "Leads postgraduate supervision in information science.",
                }
            ],
            "publications": [
                {
                    "publication_id": str(self.publication.id),
                    "contribution": "Author",
                }
            ],
        }

    def test_user_can_create_profile_with_institutional_email(self):
        self.authenticate()
        payload = self._create_profile_payload()
        response = self.client.post(
            reverse("researcher-list"), payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        profile = ResearcherProfile.objects.get(user=self.user)
        self.assertEqual(profile.institutional_email,
                         "jane.doe@university.edu")
        self.assertFalse(profile.institutional_email_verified)
        token = ResearcherInstitutionalEmailToken.objects.get(
            profile=profile, is_used=False
        )
        self.assertEqual(token.email, profile.institutional_email)
        self.assertEqual(len(mail.outbox), 1)

    def test_profile_rejects_personal_email_domains(self):
        self.authenticate()
        payload = self._create_profile_payload()
        payload["institutional_email"] = "jane.doe@gmail.com"

        response = self.client.post(
            reverse("researcher-list"), payload, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("personal email providers",
                      response.data["institutional_email"][0])
        self.assertEqual(ResearcherProfile.objects.count(), 0)

    def test_verification_endpoint_marks_email_verified(self):
        profile = ResearcherProfile.objects.create(
            user=self.user,
            display_name="Dr. Jane Doe",
            institutional_email="jane.doe@university.edu",
        )
        token = profile.initiate_institutional_email_verification()

        response = self.client.post(
            reverse("researcher-verify-institutional-email"),
            {"token": token.token},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile.refresh_from_db()
        token.refresh_from_db()
        self.assertTrue(profile.institutional_email_verified)
        self.assertTrue(token.is_used)

    def test_public_listing_only_returns_verified_profiles(self):
        verified_user = User.objects.create_user(
            email="verified@example.com",
            password="Secret123",
            is_active=True,
            is_verified=True,
        )
        verified_profile = ResearcherProfile.objects.create(
            user=verified_user,
            display_name="Prof. Verified",
            institutional_email="verified@university.edu",
        )
        verified_profile.mark_institutional_email_verified()

        ResearcherProfile.objects.create(
            user=self.user,
            display_name="Pending Researcher",
            institutional_email="pending@campus.edu",
        )

        response = self.client.get(reverse("researcher-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["institutional_email"],
            "verified@university.edu",
        )

    def test_owner_can_update_profile_and_sync_relations(self):
        self.authenticate()
        create_response = self.client.post(
            reverse("researcher-list"), self._create_profile_payload(), format="json"
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        profile = ResearcherProfile.objects.get(user=self.user)
        experience_id = profile.experiences.first().id
        new_publication = Publication.objects.create(
            title="Advanced Research Design")

        patch_response = self.client.patch(
            reverse("researcher-me"),
            {
                "current_position": "Associate Professor",
                "experiences": [
                    {
                        "id": experience_id,
                        "employer": "University of Nairobi",
                        "role": "Associate Professor",
                        "start_date": "2020-01-01",
                        "is_current": True,
                        "description": "Promoted to associate professor.",
                    }
                ],
                "publications": [
                    {
                        "publication_id": str(new_publication.id),
                        "contribution": "Editor",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        profile.refresh_from_db()
        self.assertEqual(profile.current_position, "Associate Professor")
        self.assertEqual(profile.researcher_publications.count(), 1)
        link = profile.researcher_publications.first()
        self.assertEqual(link.publication, new_publication)
        self.assertEqual(link.contribution, "Editor")
        experience = profile.experiences.get(id=experience_id)
        self.assertEqual(experience.role, "Associate Professor")
        self.assertTrue(experience.is_current)


class PublicationApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            email="librarian@example.com", password="Adminpass123"
        )

    class _DummyHits(list):
        def __init__(self, iterable=None, total_value=None):
            super().__init__(iterable or [])
            self._total_value = total_value if total_value is not None else len(
                self)

        @property
        def total(self):
            return SimpleNamespace(value=self._total_value, relation="eq")

    class _DummyResponse:
        def __init__(self, hits):
            self.hits = hits

        def __iter__(self):
            return iter(self.hits)

    class _DummySearch:
        def __init__(self, response):
            self._response = response

        def query(self, *args, **kwargs):
            return self

        def sort(self, *args, **kwargs):
            return self

        def __getitem__(self, *_):
            return self

        def execute(self):
            return self._response

    def test_anonymous_can_list_publications(self):
        publication = Publication.objects.create(title="Open Access Primer")
        publication.metadata_entries.create(
            schema="dc",
            element="creator",
            value="Doe, Jane",
        )

        response = self.client.get(reverse("publication-list"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data
        items = payload["results"] if isinstance(
            payload, dict) and "results" in payload else payload
        self.assertGreaterEqual(len(items), 1)

    def test_only_admin_can_manage_publication(self):
        payload = {
            "title": "Digital Repositories in Africa",
            "description": "Explores repository infrastructure across the continent.",
            "metadata": [
                {
                    "schema": "dc",
                    "element": "creator",
                    "value": "Omondi, Peter",
                },
                {
                    "schema": "dc",
                    "element": "creator",
                    "value": "Wanjiku, Amina",
                },
                {
                    "schema": "dc",
                    "element": "language",
                    "value": "en",
                },
                {
                    "schema": "dc",
                    "element": "language",
                    "value": "sw",
                },
                {
                    "schema": "dc",
                    "element": "identifier",
                    "value": "doi:10.1234/example",
                },
            ],
        }

        response = self.client.post(
            reverse("publication-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        researcher = User.objects.create_user(
            email="archivist@example.com",
            password="Research123",
            is_active=True,
            is_verified=True,
        )
        self.client.force_authenticate(user=researcher)
        response = self.client.post(
            reverse("publication-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=None)

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            reverse("publication-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        slug = response.data["slug"]
        detail_url = reverse("publication-detail", args=[slug])

        patch_response = self.client.patch(
            detail_url,
            {
                "metadata": [
                    {
                        "schema": "dc",
                        "element": "language",
                        "value": "eng",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            patch_response.data["metadata"][0]["value"],
            "eng",
        )

        delete_response = self.client.delete(detail_url)
        self.assertEqual(delete_response.status_code,
                         status.HTTP_204_NO_CONTENT)
