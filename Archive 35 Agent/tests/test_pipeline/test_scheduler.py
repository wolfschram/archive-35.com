"""Tests for the scheduler module."""

import os

import pytest


@pytest.fixture(autouse=True)
def use_memory_huey(monkeypatch):
    """Force MemoryHuey for tests."""
    monkeypatch.setenv("HUEY_IMMEDIATE", "true")


def test_huey_instance():
    """Huey instance should be configured."""
    # Re-import to pick up env var
    import importlib
    import src.pipeline.scheduler as sched
    importlib.reload(sched)
    assert sched.huey.name == "archive35"


def test_schedule_defined():
    """All cron schedules should be documented."""
    from src.pipeline.scheduler import SCHEDULE
    assert "daily_pipeline" in SCHEDULE
    assert "posting" in SCHEDULE
    assert "expire_content" in SCHEDULE
    assert "daily_summary" in SCHEDULE


def test_tasks_registered():
    """Periodic tasks should be registered with Huey."""
    from src.pipeline.scheduler import (
        daily_pipeline_task,
        daily_summary_task,
        expire_content_task,
        posting_task,
    )
    assert callable(daily_pipeline_task)
    assert callable(posting_task)
    assert callable(expire_content_task)
    assert callable(daily_summary_task)
