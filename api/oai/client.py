"""Minimal OAI-PMH client helpers shared by management commands and API views."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

OAI_NAMESPACES = {
    "oai": "http://www.openarchives.org/OAI/2.0/",
    "oai_dc": "http://www.openarchives.org/OAI/2.0/oai_dc/",
    "dc": "http://purl.org/dc/elements/1.1/",
}


class OAIClientError(Exception):
    """Raised when the remote OAI endpoint cannot be reached."""


class OAIValidationError(Exception):
    """Raised when the OAI response is not a valid XML payload."""


@dataclass
class OAIValidationResult:
    ok: bool
    message: str


def prepare_oai_endpoint(oai_url: str) -> Tuple[str, Dict[str, str]]:
    """Split an OAI URL into base endpoint and query parameters."""
    parsed = urlparse(oai_url)
    base_url = urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
    params = {key: values[-1]
              for key, values in parse_qs(parsed.query).items() if values}
    return base_url, params


def fetch_oai_response(base_url: str, params: Dict[str, str], *, timeout: int = 30) -> str:
    query = urlencode(params)
    target = f"{base_url}?{query}" if query else base_url
    request = Request(target, headers={"User-Agent": "journals-harvester/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:  # nosec: B310 - controlled input
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="ignore")
    except (HTTPError, URLError) as exc:
        raise OAIClientError(str(exc)) from exc


def _detect_oai_error(root: ET.Element) -> Optional[str]:
    error_node = root.find(".//oai:error", namespaces=OAI_NAMESPACES)
    if error_node is None:
        return None
    code = error_node.get("code", "")
    message = (error_node.text or "").strip(
    ) or "The OAI endpoint returned an error."
    if code:
        return f"{code}: {message}"
    return message


def validate_oai_endpoint(oai_url: str) -> OAIValidationResult:
    """Validate that the given URL responds with a parsable OAI Identify payload."""
    base_url, params = prepare_oai_endpoint(oai_url.strip())
    params.setdefault("verb", "Identify")

    try:
        payload = fetch_oai_response(base_url, params)
    except OAIClientError as exc:
        return OAIValidationResult(ok=False, message=f"Could not reach endpoint: {exc}")

    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        return OAIValidationResult(ok=False, message=f"Response was not valid XML: {exc}")

    error_message = _detect_oai_error(root)
    if error_message:
        return OAIValidationResult(ok=False, message=error_message)

    identify = root.find(".//oai:Identify", namespaces=OAI_NAMESPACES)
    if identify is None:
        return OAIValidationResult(ok=False, message="The endpoint did not return an Identify response.")

    repository_name = identify.findtext(
        "oai:repositoryName", namespaces=OAI_NAMESPACES)
    if repository_name:
        return OAIValidationResult(ok=True, message=f"Connected to '{repository_name}'.")

    return OAIValidationResult(ok=True, message="Endpoint responded with a valid Identify payload.")
