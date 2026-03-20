# -*- coding: utf-8 -*-
from __future__ import annotations

from click.testing import CliRunner

from copaw.cli import clean_cmd as clean_cmd_module
from copaw.cli.clean_cmd import clean_cmd
from copaw.utils.telemetry import TELEMETRY_MARKER_FILE


def test_clean_dry_run_keeps_files_and_preserves_telemetry(tmp_path, monkeypatch) -> None:
    working_dir = tmp_path / "boostclaw-home"
    working_dir.mkdir()
    keep_marker = working_dir / TELEMETRY_MARKER_FILE
    keep_marker.write_text("1", encoding="utf-8")
    subdir = working_dir / "workspace"
    subdir.mkdir()
    nested_file = subdir / "data.txt"
    nested_file.write_text("payload", encoding="utf-8")
    root_file = working_dir / "config.json"
    root_file.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(clean_cmd_module, "WORKING_DIR", working_dir)

    result = CliRunner().invoke(clean_cmd, ["--dry-run"])

    assert result.exit_code == 0
    assert "Will remove:" in result.output
    assert str(root_file) in result.output
    assert str(subdir) in result.output
    assert f"Will keep: {TELEMETRY_MARKER_FILE}" in result.output
    assert root_file.exists()
    assert nested_file.exists()
    assert keep_marker.exists()


def test_clean_yes_removes_children_but_keeps_directory_and_telemetry(
    tmp_path,
    monkeypatch,
) -> None:
    working_dir = tmp_path / "boostclaw-home"
    working_dir.mkdir()
    keep_marker = working_dir / TELEMETRY_MARKER_FILE
    keep_marker.write_text("1", encoding="utf-8")
    (working_dir / "config.json").write_text("{}", encoding="utf-8")
    workspace_dir = working_dir / "workspaces"
    workspace_dir.mkdir()
    (workspace_dir / "agent.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(clean_cmd_module, "WORKING_DIR", working_dir)

    result = CliRunner().invoke(clean_cmd, ["--yes"])

    assert result.exit_code == 0
    assert "Done." in result.output
    assert working_dir.exists()
    assert keep_marker.exists()
    assert list(working_dir.iterdir()) == [keep_marker]


def test_clean_reports_empty_directory(tmp_path, monkeypatch) -> None:
    working_dir = tmp_path / "boostclaw-home"
    working_dir.mkdir()

    monkeypatch.setattr(clean_cmd_module, "WORKING_DIR", working_dir)

    result = CliRunner().invoke(clean_cmd, ["--yes"])

    assert result.exit_code == 0
    assert f"WORKING_DIR is already empty: {working_dir}" in result.output

