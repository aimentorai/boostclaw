# -*- coding: utf-8 -*-
"""Console APIs for push messages."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Query


router = APIRouter(prefix="/console", tags=["console"])
logger = logging.getLogger(__name__)

_ALLOWED_AUTH_DEBUG_FIELDS = {
    "event",
    "stage",
    "phone",
    "countryCode",
    "userId",
    "status",
    "error",
}
_SENSITIVE_FIELD_NAMES = {
    "password",
    "smsCode",
    "sms_code",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
}
_MAX_AUTH_DEBUG_VALUE_LENGTH = 256


def _sanitize_auth_debug_event(payload: dict[str, Any]) -> dict[str, str]:
    sanitized: dict[str, str] = {}

    for key, value in payload.items():
        if key in _SENSITIVE_FIELD_NAMES:
            continue
        if key not in _ALLOWED_AUTH_DEBUG_FIELDS:
            continue
        if value is None:
            continue

        value_text = str(value).strip()
        if not value_text:
            continue

        sanitized[key] = value_text[:_MAX_AUTH_DEBUG_VALUE_LENGTH]

    return sanitized


@router.get("/push-messages")
async def get_push_messages(
    session_id: str | None = Query(None, description="Optional session id"),
):
    """
    Return pending push messages. Without session_id: recent messages
    (all sessions, last 60s), not consumed so every tab sees them.
    """
    from ..console_push_store import get_recent, take

    if session_id:
        messages = await take(session_id)
    else:
        messages = await get_recent()
    return {"messages": messages}


@router.post("/auth-debug-events")
async def report_auth_debug_event(
    payload: dict[str, Any] = Body(default_factory=dict),
):
    sanitized_event = _sanitize_auth_debug_event(payload)
    if sanitized_event:
        logger.debug("auth_debug_event %s", sanitized_event)

    return {"ok": True}

