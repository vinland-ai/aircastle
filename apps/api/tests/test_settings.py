import traceback

import pytest

from aircastle_api.settings import SettingsError, load_settings


def test_missing_variables_are_all_named(environment: pytest.MonkeyPatch) -> None:
    environment.delenv("ENVIRONMENT")
    environment.delenv("DATABASE_URL")

    with pytest.raises(SettingsError) as raised:
        load_settings()

    message = str(raised.value)
    assert "ENVIRONMENT: Field required" in message
    assert "DATABASE_URL: Field required" in message


def test_wrong_types_and_malformed_urls_are_all_named(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("ENVIRONMENT", "staging")
    environment.setenv("DATABASE_URL", "not a url")
    environment.setenv("DATABASE_POOL_SIZE", "many")
    environment.setenv("LOG_LEVEL", "loud")

    with pytest.raises(SettingsError) as raised:
        load_settings()

    lines = str(raised.value).splitlines()
    assert lines[0] == "Invalid environment:"
    assert {line.split(":")[0].strip() for line in lines[1:]} == {
        "ENVIRONMENT",
        "DATABASE_URL",
        "DATABASE_POOL_SIZE",
        "LOG_LEVEL",
    }


def test_startup_error_output_never_contains_a_secret(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("DATABASE_URL", "postgresql://aircastle:hunter2@db:port/app")

    with pytest.raises(SettingsError) as raised:
        load_settings()

    output = "".join(traceback.format_exception(raised.value))
    assert "DATABASE_URL" in output
    assert "hunter2" not in output


def test_printed_settings_never_contain_a_secret(
    environment: pytest.MonkeyPatch,
) -> None:
    environment.setenv("LOGFIRE_TOKEN", "pylf_v1_us_s3cr3t")
    settings = load_settings()

    for secret in ("hunter2", "pylf_v1_us_s3cr3t"):
        assert secret not in repr(settings)
        assert secret not in str(settings)
