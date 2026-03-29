# -*- coding: utf-8 -*-
"""Retry wrapper for ChatModelBase instances.

Transparently retries LLM API calls on transient errors (rate-limit,
timeout, connection) with configurable exponential back-off.

Also detects "input too long" errors (400) and automatically truncates
the message list before retrying once, preventing context-window overflows
from crashing the agent loop.

Configuration via environment variables (or use defaults from constant.py):
    BOOSTCLAW_LLM_MAX_RETRIES   – max retry attempts (default 3)
    BOOSTCLAW_LLM_BACKOFF_BASE  – base delay in seconds (default 1.0)
    BOOSTCLAW_LLM_BACKOFF_CAP   – max delay cap in seconds (default 10.0)
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, AsyncGenerator

from agentscope.model import ChatModelBase
from agentscope.model._model_response import ChatResponse

from ..constant import LLM_BACKOFF_BASE, LLM_BACKOFF_CAP, LLM_MAX_RETRIES

logger = logging.getLogger(__name__)

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

# Number of most-recent messages to preserve when truncating.
_TRUNCATE_KEEP_TAIL = 10

# Patterns that indicate the API rejected the request because the input
# exceeds the model's context window.  Covers OpenAI-compatible providers,
# DashScope, Anthropic, and generic phrasing.
_INPUT_TOO_LONG_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"input.{0,10}length", re.IGNORECASE),
    re.compile(r"maximum context length", re.IGNORECASE),
    re.compile(r"context.{0,10}window", re.IGNORECASE),
    re.compile(r"token.{0,20}(limit|exceed|max)", re.IGNORECASE),
    re.compile(r"input.{0,10}too.{0,10}(long|large)", re.IGNORECASE),
    re.compile(r"prompt is too long", re.IGNORECASE),
    re.compile(r"reduce.{0,20}(length|prompt|input)", re.IGNORECASE),
]

_openai_retryable: tuple[type[Exception], ...] | None = None
_anthropic_retryable: tuple[type[Exception], ...] | None = None
_openai_bad_request: type[Exception] | None = None
_anthropic_bad_request: type[Exception] | None = None


def _get_bad_request_types() -> tuple[type[Exception], ...]:
    global _openai_bad_request, _anthropic_bad_request  # noqa: PLW0603
    types: list[type[Exception]] = []
    if _openai_bad_request is None:
        try:
            import openai  # noqa: PLC0415

            _openai_bad_request = openai.BadRequestError
        except ImportError:
            _openai_bad_request = type(None)  # type: ignore[assignment]
    if _openai_bad_request is not type(None):
        types.append(_openai_bad_request)  # type: ignore[arg-type]
    if _anthropic_bad_request is None:
        try:
            import anthropic  # noqa: PLC0415

            _anthropic_bad_request = anthropic.BadRequestError
        except ImportError:
            _anthropic_bad_request = type(None)  # type: ignore[assignment]
    if _anthropic_bad_request is not type(None):
        types.append(_anthropic_bad_request)  # type: ignore[arg-type]
    return tuple(types)


def _is_input_too_long(exc: Exception) -> bool:
    """Return *True* if *exc* is a 400-class error about input length."""
    bad_request_types = _get_bad_request_types()
    if not bad_request_types or not isinstance(exc, bad_request_types):
        status = getattr(exc, "status_code", None)
        if status != 400:
            return False
    msg = str(exc)
    return any(p.search(msg) for p in _INPUT_TOO_LONG_PATTERNS)


def _truncate_messages(
    messages: list[dict[str, Any]],
    keep_tail: int = _TRUNCATE_KEEP_TAIL,
) -> list[dict[str, Any]]:
    """Drop middle messages, keeping the system prompt and recent tail.

    Returns a new list; does not mutate *messages*.
    """
    if len(messages) <= keep_tail + 1:
        return messages

    head = [messages[0]] if messages[0].get("role") == "system" else []
    tail = messages[-keep_tail:]
    dropped = len(messages) - len(head) - len(tail)
    logger.warning(
        "Truncating prompt: dropped %d middle message(s), keeping %d head + %d tail",
        dropped,
        len(head),
        len(tail),
    )
    return head + tail


def _get_openai_retryable() -> tuple[type[Exception], ...]:
    global _openai_retryable  # noqa: PLW0603
    if _openai_retryable is None:
        try:
            import openai  # noqa: PLC0415

            _openai_retryable = (
                openai.RateLimitError,
                openai.APITimeoutError,
                openai.APIConnectionError,
            )
        except ImportError:
            _openai_retryable = ()
    return _openai_retryable


def _get_anthropic_retryable() -> tuple[type[Exception], ...]:
    global _anthropic_retryable  # noqa: PLW0603
    if _anthropic_retryable is None:
        try:
            import anthropic  # noqa: PLC0415

            _anthropic_retryable = (
                anthropic.RateLimitError,
                anthropic.APITimeoutError,
                anthropic.APIConnectionError,
            )
        except ImportError:
            _anthropic_retryable = ()
    return _anthropic_retryable


def _is_retryable(exc: Exception) -> bool:
    """Return *True* if *exc* should trigger a retry."""
    retryable = _get_openai_retryable() + _get_anthropic_retryable()
    if retryable and isinstance(exc, retryable):
        return True

    status = getattr(exc, "status_code", None)
    if status is not None and status in RETRYABLE_STATUS_CODES:
        return True

    return False


def _compute_backoff(attempt: int) -> float:
    """Exponential back-off: base * 2^(attempt-1), capped."""
    return min(LLM_BACKOFF_CAP, LLM_BACKOFF_BASE * (2 ** max(0, attempt - 1)))


class RetryChatModel(ChatModelBase):
    """Transparent retry wrapper around any :class:`ChatModelBase`.

    The wrapper delegates every call to the underlying *inner* model and
    retries on transient errors with exponential back-off.  Streaming
    responses are also covered: if the stream fails mid-consumption the
    entire request is retried from scratch.
    """

    def __init__(self, inner: ChatModelBase) -> None:
        super().__init__(model_name=inner.model_name, stream=inner.stream)
        self._inner = inner

    # Expose the real model's class so that formatter mapping keeps working
    # when code inspects ``model.__class__`` after wrapping.
    @property
    def inner_class(self) -> type:
        return self._inner.__class__

    async def __call__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        retries = LLM_MAX_RETRIES
        attempts = retries + 1
        last_exc: Exception | None = None
        truncated = False

        for attempt in range(1, attempts + 1):
            try:
                result = await self._inner(*args, **kwargs)

                if isinstance(result, AsyncGenerator):
                    return self._wrap_stream(
                        result,
                        args,
                        kwargs,
                        attempt,
                        attempts,
                    )
                return result

            except Exception as exc:
                last_exc = exc

                if not truncated and _is_input_too_long(exc):
                    messages = (
                        kwargs.get("messages")
                        if "messages" in kwargs
                        else (args[0] if args else None)
                    )
                    if isinstance(messages, list) and len(messages) > (
                        _TRUNCATE_KEEP_TAIL + 1
                    ):
                        shorter = _truncate_messages(messages)
                        if "messages" in kwargs:
                            kwargs = {**kwargs, "messages": shorter}
                        elif args:
                            args = (shorter, *args[1:])
                        truncated = True
                        logger.warning(
                            "Input too long (attempt %d/%d): %s. "
                            "Retrying with truncated prompt …",
                            attempt,
                            attempts,
                            exc,
                        )
                        continue

                if not _is_retryable(exc) or attempt >= attempts:
                    raise
                delay = _compute_backoff(attempt)
                logger.warning(
                    "LLM call failed (attempt %d/%d): %s. Retrying in %.1fs …",
                    attempt,
                    attempts,
                    exc,
                    delay,
                )
                await asyncio.sleep(delay)

        # Should be unreachable, but satisfies the type-checker.
        raise last_exc  # type: ignore[misc]

    async def _wrap_stream(
        self,
        stream: AsyncGenerator[ChatResponse, None],
        call_args: tuple,
        call_kwargs: dict,
        current_attempt: int,
        max_attempts: int,
    ) -> AsyncGenerator[ChatResponse, None]:
        """Yield chunks from *stream*; on transient failure, retry the
        full request and yield from the new stream instead."""
        failed_exc: Exception | None = None
        try:
            async for chunk in stream:
                yield chunk
        except Exception as exc:
            failed_exc = exc
        finally:
            await stream.aclose()

        if failed_exc is None:
            return

        if not _is_retryable(failed_exc) or current_attempt >= max_attempts:
            raise failed_exc
        delay = _compute_backoff(current_attempt)
        logger.warning(
            "LLM stream failed (attempt %d/%d): %s. Retrying in %.1fs …",
            current_attempt,
            max_attempts,
            failed_exc,
            delay,
        )
        await asyncio.sleep(delay)

        new_stream: AsyncGenerator | None = None
        for attempt in range(current_attempt + 1, max_attempts + 1):
            try:
                result = await self._inner(*call_args, **call_kwargs)
                if isinstance(result, AsyncGenerator):
                    new_stream = result
                    async for chunk in new_stream:
                        yield chunk
                    new_stream = None
                else:
                    yield result
                return
            except Exception as retry_exc:
                if new_stream is not None:
                    await new_stream.aclose()
                    new_stream = None
                if not _is_retryable(retry_exc) or attempt >= max_attempts:
                    raise
                retry_delay = _compute_backoff(attempt)
                logger.warning(
                    "LLM stream retry failed (attempt %d/%d): %s. Retrying in %.1fs …",
                    attempt,
                    max_attempts,
                    retry_exc,
                    retry_delay,
                )
                await asyncio.sleep(retry_delay)
