# -*- coding: utf-8 -*-
from __future__ import annotations

import runpy
import sys
import types

import click


def test_python_module_entrypoint_invokes_cli(monkeypatch) -> None:
    called: dict[str, bool] = {}

    @click.command()
    def _fake_cli() -> None:
        called["invoked"] = True

    fake_cli_main = types.ModuleType("copaw.cli.main")
    fake_cli_main.cli = _fake_cli
    monkeypatch.setitem(sys.modules, "copaw.cli.main", fake_cli_main)
    monkeypatch.delitem(sys.modules, "copaw.__main__", raising=False)
    # __main__.py calls click command directly, so argv should contain only
    # the program name (no Python launcher flags).
    monkeypatch.setattr(sys, "argv", ["copaw"])

    try:
        runpy.run_module("copaw", run_name="__main__")
    except SystemExit as exc:
        assert exc.code == 0

    assert called.get("invoked") is True



