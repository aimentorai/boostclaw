# -*- coding: utf-8 -*-
from __future__ import annotations

import json

from click.testing import CliRunner

from copaw.cli.env_cmd import env_group
from copaw.envs import store as env_store


def test_env_set_list_delete_roundtrip(tmp_path, monkeypatch) -> None:
    envs_path = tmp_path / "secret" / "envs.json"
    monkeypatch.setattr(env_store, "_ENVS_JSON", envs_path)
    monkeypatch.setattr(env_store, "_LEGACY_ENVS_JSON_CANDIDATES", ())
    monkeypatch.delenv("BOOSTCLAW_TEST_KEY", raising=False)

    runner = CliRunner()

    set_result = runner.invoke(
        env_group,
        ["set", "BOOSTCLAW_TEST_KEY", "value-123"],
    )
    assert set_result.exit_code == 0
    assert "BOOSTCLAW_TEST_KEY = value-123" in set_result.output
    assert json.loads(envs_path.read_text(encoding="utf-8")) == {
        "BOOSTCLAW_TEST_KEY": "value-123",
    }

    list_result = runner.invoke(env_group, ["list"])
    assert list_result.exit_code == 0
    assert "BOOSTCLAW_TEST_KEY" in list_result.output
    assert "value-123" in list_result.output

    delete_result = runner.invoke(env_group, ["delete", "BOOSTCLAW_TEST_KEY"])
    assert delete_result.exit_code == 0
    assert "Deleted: BOOSTCLAW_TEST_KEY" in delete_result.output
    assert json.loads(envs_path.read_text(encoding="utf-8")) == {}

    empty_list_result = runner.invoke(env_group, ["list"])
    assert empty_list_result.exit_code == 0
    assert "No environment variables configured." in empty_list_result.output


def test_env_delete_missing_key_returns_error(tmp_path, monkeypatch) -> None:
    envs_path = tmp_path / "secret" / "envs.json"
    monkeypatch.setattr(env_store, "_ENVS_JSON", envs_path)
    monkeypatch.setattr(env_store, "_LEGACY_ENVS_JSON_CANDIDATES", ())

    result = CliRunner().invoke(env_group, ["delete", "MISSING_KEY"])

    assert result.exit_code != 0
    assert "Env var 'MISSING_KEY' not found." in result.output

