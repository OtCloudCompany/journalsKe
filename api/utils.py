from __future__ import annotations

from typing import Literal, TYPE_CHECKING

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

from .models import User, UserToken

if TYPE_CHECKING:
    from .models import ResearcherInstitutionalEmailToken, ResearcherProfile

EmailTemplate = Literal["verify", "reset", "invite"]


def build_frontend_url(path: str) -> str:
    base_url = getattr(settings, "FRONTEND_BASE_URL", "http://localhost:4200")
    if path.startswith("/"):
        path = path[1:]
    return f"{base_url.rstrip('/')}/{path}"


def send_user_email(template: EmailTemplate, user: User, token: UserToken, triggered_by_admin: bool = False) -> None:
    subject_map = {
        "verify": "Verify your Journals KE account",
        "reset": "Reset your Journals KE password",
        "invite": "You have been invited to Journals KE",
    }
    path_map = {
        "verify": f"auth/verify-email?token={token.token}",
        "reset": f"auth/reset-password?token={token.token}",
        "invite": f"auth/complete-registration?token={token.token}",
    }
    context = {
        "user": user,
        "token": token,
        "action_url": build_frontend_url(path_map[template]),
        "triggered_by_admin": triggered_by_admin,
    }
    message = render_to_string(f"emails/{template}.txt", context)
    html_message = render_to_string(f"emails/{template}.html", context)
    send_mail(subject_map[template], message, getattr(settings, "DEFAULT_FROM_EMAIL",
              "no-reply@journals-ke.local"), [user.email], html_message=html_message)


def send_institutional_email_verification(
    profile: "ResearcherProfile",
    token: "ResearcherInstitutionalEmailToken",
) -> None:
    subject = "Verify your institutional affiliation"
    path = f"researchers/verify-institutional-email?token={token.token}"
    context = {
        "profile": profile,
        "token": token,
        "action_url": build_frontend_url(path),
    }
    message = render_to_string(
        "emails/researcher_institutional_verify.txt", context)
    html_message = render_to_string(
        "emails/researcher_institutional_verify.html", context)
    send_mail(
        subject,
        message,
        getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@journals-ke.local"),
        [token.email],
        html_message=html_message,
    )
