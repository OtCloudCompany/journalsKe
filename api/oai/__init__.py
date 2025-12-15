"""Utilities for interacting with OAI-PMH endpoints."""

from .client import (
    OAIClientError,
    OAIValidationError,
    fetch_oai_response,
    prepare_oai_endpoint,
    validate_oai_endpoint,
    OAI_NAMESPACES,
)

__all__ = [
    "OAIClientError",
    "OAIValidationError",
    "fetch_oai_response",
    "prepare_oai_endpoint",
    "validate_oai_endpoint",
    "OAI_NAMESPACES",
]
