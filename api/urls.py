from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminUserViewSet,
    ChangePasswordView,
    InviteAcceptanceView,
    JournalViewSet,
    PublicationViewSet,
    PublicationSearchView,
    PublicationSearchFacetView,
    OAIHarvestLogViewSet,
    PasswordResetRequestView,
    PasswordResetView,
    ProfileView,
    RegistrationView,
    ResearcherInstitutionalEmailVerificationView,
    ResearcherProfileViewSet,
    ResendVerificationView,
    UserTokenRefreshView,
    UserTokenVerifyView,
    VerifyEmailView,
    EmailTokenObtainPairView,
    JournalOAIValidationView,
    HomeSummaryView,
)

router = DefaultRouter()
router.register(r"admin/users", AdminUserViewSet, basename="admin-user")
router.register(r"journals", JournalViewSet, basename="journal")
router.register(r"publications", PublicationViewSet, basename="publication")
router.register(r"researchers", ResearcherProfileViewSet,
                basename="researcher")
router.register(r"harvest-logs", OAIHarvestLogViewSet,
                basename="harvest-log")

urlpatterns = [
    path("auth/register/", RegistrationView.as_view(), name="auth-register"),
    path("auth/verify-email/", VerifyEmailView.as_view(), name="auth-verify-email"),
    path("auth/resend-verification/", ResendVerificationView.as_view(),
         name="auth-resend-verification"),
    path("auth/token/", EmailTokenObtainPairView.as_view(), name="auth-token"),
    path("auth/token/refresh/", UserTokenRefreshView.as_view(),
         name="auth-token-refresh"),
    path("auth/token/verify/", UserTokenVerifyView.as_view(),
         name="auth-token-verify"),
    path("auth/password/forgot/", PasswordResetRequestView.as_view(),
         name="auth-password-request"),
    path("auth/password/reset/", PasswordResetView.as_view(),
         name="auth-password-reset"),
    path("auth/invite/complete/", InviteAcceptanceView.as_view(),
         name="auth-invite-complete"),
    path("me/", ProfileView.as_view(), name="user-profile"),
    path("me/change-password/", ChangePasswordView.as_view(),
         name="user-change-password"),
    path("publications/search/", PublicationSearchView.as_view(),
         name="publication-search"),
    path("publications/search/facets/<str:facet_name>/", PublicationSearchFacetView.as_view(),
         name="publication-search-facets"),
    path("journals/validate-oai/", JournalOAIValidationView.as_view(),
         name="journal-validate-oai"),
    path("home/summary/", HomeSummaryView.as_view(), name="home-summary"),
    path(
        "researchers/verify-institutional-email/",
        ResearcherInstitutionalEmailVerificationView.as_view(),
        name="researcher-verify-institutional-email",
    ),
    path("", include(router.urls)),
]
