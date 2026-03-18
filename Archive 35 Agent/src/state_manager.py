"""Persistent state manager for Archive-35 agents.

Each agent has its own state file in data/agent_state/.
On startup, agents read their last state to resume work.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

STATE_DIR = Path(__file__).resolve().parents[1] / "data" / "agent_state"
STATE_DIR.mkdir(parents=True, exist_ok=True)


def save_state(agent_name: str, state: dict[str, Any]) -> None:
    """Save agent state to persistent JSON file.

    Args:
        agent_name: Identifier for the agent (e.g., "instagram", "reddit").
        state: Dict of state data to persist.
    """
    state["_updated_at"] = datetime.now(timezone.utc).isoformat()
    state_file = STATE_DIR / f"{agent_name}.json"
    try:
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
        logger.debug("State saved for agent '%s'", agent_name)
    except OSError as e:
        logger.error("Failed to save state for '%s': %s", agent_name, e)


def load_state(agent_name: str, defaults: Optional[dict] = None) -> dict[str, Any]:
    """Load agent state from file. Returns defaults if no state exists.

    Args:
        agent_name: Identifier for the agent.
        defaults: Fallback dict if no state file found.

    Returns:
        The agent's persisted state, or defaults.
    """
    state_file = STATE_DIR / f"{agent_name}.json"
    if state_file.exists():
        try:
            with open(state_file) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to load state for '%s': %s", agent_name, e)
    return defaults or {}


def get_all_states() -> dict[str, Any]:
    """Load all agent states for dashboard display.

    Returns:
        Dict mapping agent_name -> state dict.
    """
    states: dict[str, Any] = {}
    for f in STATE_DIR.glob("*.json"):
        try:
            with open(f) as fh:
                states[f.stem] = json.load(fh)
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to load state file '%s': %s", f.name, e)
            states[f.stem] = {"_error": str(e)}
    return states


def clear_state(agent_name: str) -> bool:
    """Delete an agent's state file (for testing or reset).

    Args:
        agent_name: Identifier for the agent.

    Returns:
        True if file was deleted, False if it didn't exist.
    """
    state_file = STATE_DIR / f"{agent_name}.json"
    if state_file.exists():
        state_file.unlink()
        logger.info("State cleared for agent '%s'", agent_name)
        return True
    return False
