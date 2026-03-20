# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import types


def _ensure_google_genai_stub() -> None:
    # Some CLI modules eagerly import provider code that depends on google.genai.
    # Tests in this folder do not execute Gemini logic, so a light stub is enough.
    if "google.genai" in sys.modules:
        return

    google = sys.modules.get("google")
    if google is None:
        google = types.ModuleType("google")
        google.__path__ = []
        sys.modules["google"] = google

    genai = types.ModuleType("google.genai")
    errors = types.ModuleType("google.genai.errors")
    types_mod = types.ModuleType("google.genai.types")

    class APIError(Exception):
        pass

    class HttpOptions:
        def __init__(self, *args, **kwargs):
            pass

    class Client:
        def __init__(self, *args, **kwargs):
            pass

    errors.APIError = APIError
    types_mod.HttpOptions = HttpOptions
    genai.Client = Client
    genai.errors = errors
    genai.types = types_mod

    setattr(google, "genai", genai)
    sys.modules["google.genai"] = genai
    sys.modules["google.genai.errors"] = errors
    sys.modules["google.genai.types"] = types_mod


_ensure_google_genai_stub()


