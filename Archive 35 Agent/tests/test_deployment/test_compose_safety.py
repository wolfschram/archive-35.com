from pathlib import Path

import yaml


COMPOSE_FILE = Path(__file__).parents[2] / "docker-compose.yml"
START_SCRIPT = Path(__file__).parents[2] / "docker-start.sh"
DOCKER_GUIDE = Path(__file__).parents[2] / "DOCKER.md"


def test_default_compose_stack_excludes_legacy_automation():
    compose = yaml.safe_load(COMPOSE_FILE.read_text())
    services = compose["services"]

    assert "profiles" not in services["agent-api"]
    assert services["agent-scheduler"]["profiles"] == ["legacy-social"]
    assert services["agent-telegram"]["profiles"] == ["telegram"]


def test_optional_services_keep_live_source_mounts():
    compose = yaml.safe_load(COMPOSE_FILE.read_text())
    services = compose["services"]

    assert "./src:/app/src" in services["agent-scheduler"]["volumes"]
    assert "./src:/app/src" in services["agent-telegram"]["volumes"]


def test_start_script_keeps_optional_services_explicit():
    script = START_SCRIPT.read_text()

    assert "docker compose up -d" in script
    assert "--profile legacy-social up -d agent-scheduler" in script
    assert "--profile telegram up -d agent-telegram" in script
    assert "pipeline/run?dry_run=false" not in script


def test_operator_guide_has_no_unsafe_start_commands():
    guide = DOCKER_GUIDE.read_text()

    assert "docker-compose " not in guide
    assert "pipeline/run?dry_run=false" not in guide
    assert "docker compose --profile legacy-social" in guide
