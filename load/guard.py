"""Refuse to load-test anything but a local instance (003 FR-008).

A load run against production would post to X and spend real money, so this is a hard refusal rather than
a warning: every entry point in `load/` calls `check_target` before it does anything.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "db"})

# Env vars that mean a real account or a real bill. A load run must not see any of them set.
REAL_CREDENTIALS = (
    "X_BEARER_TOKEN",
    "X_API_KEY",
    "X_API_KEY_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_TOKEN_SECRET",
    "X_OAUTH2_CLIENT_ID",
    "X_OAUTH2_CLIENT_SECRET",
    "GEMINI_API_KEY",
    "SENTRY_DSN",
)

# Hosts that are production by definition, whatever else the string says.
REMOTE_MARKERS = ("supabase.co", "supabase.com", "pooler.supabase", "digitalocean", "209.38.255.111")


class NotLocal(Exception):
    """The target, or the environment, is not safe to load-test."""


def check_target(url: str, env: dict[str, str] | None = None) -> str:
    """The url to drive, or a refusal. Checks the host, then the environment it would run with."""
    env = os.environ if env is None else env
    host = _host(url)
    if host is None:
        raise NotLocal(f"{url!r} is not a url with a host")
    if any(marker in url for marker in REMOTE_MARKERS):
        raise NotLocal(f"{host} is production")
    if host not in LOCAL_HOSTS:
        raise NotLocal(f"{host} is not local; load runs drive localhost only (003 FR-008)")
    _check_env(env)
    return url


def _check_env(env: dict[str, str]) -> None:
    present = [name for name in REAL_CREDENTIALS if env.get(name)]
    if present:
        raise NotLocal(f"real credentials in the environment: {', '.join(present)}. Unset them and re-run")
    database = env.get("DATABASE_URL", "")
    if database and any(marker in database for marker in REMOTE_MARKERS):
        raise NotLocal("DATABASE_URL points at production")
    if database and (host := _host(database)) and host not in LOCAL_HOSTS:
        raise NotLocal(f"DATABASE_URL host {host} is not local")
    if env.get("LLM_MODE") not in (None, "", "replay"):
        raise NotLocal(f"LLM_MODE={env.get('LLM_MODE')} would make paid calls; load runs use replay")


def _host(url: str) -> str | None:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    return parsed.hostname
