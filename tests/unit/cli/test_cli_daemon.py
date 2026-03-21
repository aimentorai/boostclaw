# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pytest
from click.testing import CliRunner

try:
    from copaw.cli.daemon_cmd import daemon_group
except Exception as exc:  # pragma: no cover - environment-dependent import
    daemon_group = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

pytestmark = pytest.mark.skipif(
    daemon_group is None,
    reason=f"daemon CLI import failed in this environment: {_IMPORT_ERROR}",
)


def test_daemon_status_passes_agent_workspace_to_runner(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "copaw.cli.daemon_cmd._get_agent_workspace",
        lambda _agent_id: Path("/tmp/default-agent"),
    )

    def _fake_run_daemon_status(ctx):
        captured["working_dir"] = ctx.working_dir
        return "status-ok"

    monkeypatch.setattr("copaw.cli.daemon_cmd.run_daemon_status", _fake_run_daemon_status)

    result = CliRunner().invoke(cast(Any, daemon_group), ["status"])

    assert result.exit_code == 0
    assert "Agent: default" in result.output
    assert "status-ok" in result.output
    assert captured["working_dir"] == Path("/tmp/default-agent")


def test_daemon_restart_uses_custom_agent(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "copaw.cli.daemon_cmd._get_agent_workspace",
        lambda _agent_id: Path("/tmp/custom-agent"),
    )

    async def _fake_run_daemon_restart(ctx):
        captured["working_dir"] = ctx.working_dir
        return "restart-info"

    monkeypatch.setattr(
        "copaw.cli.daemon_cmd.run_daemon_restart",
        _fake_run_daemon_restart,
    )

    result = CliRunner().invoke(
        cast(Any, daemon_group),
        ["restart", "--agent-id", "abc123"],
    )

    assert result.exit_code == 0
    assert "Agent: abc123" in result.output
    assert "restart-info" in result.output
    assert captured["working_dir"] == Path("/tmp/custom-agent")


