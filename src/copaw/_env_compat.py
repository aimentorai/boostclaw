# -*- coding: utf-8 -*-
"""Environment variable compatibility: BOOSTCLAW_* only (breaking change v1.0+).

Starting from v1.0, we only read BOOSTCLAW_<SUFFIX> environment variables.
The legacy COPAW_* prefix is no longer supported. Users must update their configs.
"""
from __future__ import annotations

import os


def get_app_env(suffix: str, default: str = "") -> str:
    """Return value for BOOSTCLAW_<suffix> only."""
    return os.environ.get(f"BOOSTCLAW_{suffix}", default)


def get_app_env_bool(suffix: str, default: bool = False) -> bool:
    """Return bool for BOOSTCLAW_<suffix> only (true/1/yes)."""
    val = get_app_env(suffix, str(default)).lower()
    return val in ("true", "1", "yes")


def get_app_env_int(
    suffix: str,
    default: int = 0,
    min_value: int | None = None,
    max_value: int | None = None,
) -> int:
    """Return int for BOOSTCLAW_<suffix> only, with optional bounds."""
    try:
        value = int(get_app_env(suffix, str(default)))
        if min_value is not None and value < min_value:
            return min_value
        if max_value is not None and value > max_value:
            return max_value
        return value
    except (TypeError, ValueError):
        return default


def get_app_env_float(
    suffix: str,
    default: float = 0.0,
    min_value: float | None = None,
    max_value: float | None = None,
    allow_inf: bool = False,
) -> float:
    """Return float for BOOSTCLAW_<suffix> only, with optional bounds."""
    try:
        value = float(get_app_env(suffix, str(default)))
        if min_value is not None and value < min_value:
            return min_value
        if max_value is not None and value > max_value:
            return max_value
        if not allow_inf and value in (float("inf"), float("-inf")):
            return default
        return value
    except (TypeError, ValueError):
        return default
