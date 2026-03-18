"""Shared SSL certificate fix for Python 3.13 on macOS.

Import this at the top of any module that makes HTTPS calls.
Safe to import multiple times — idempotent.
"""
from __future__ import annotations
import logging
import os
import ssl
import urllib.request

_applied = False
logger = logging.getLogger(__name__)


def apply() -> None:
    """Install a valid CA bundle as urllib's default SSL context."""
    global _applied
    if _applied:
        return

    cert_paths = [
        "/etc/ssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
    ]
    try:
        import certifi
        cert_paths.insert(0, certifi.where())
    except ImportError:
        pass

    for cp in cert_paths:
        if os.path.exists(cp):
            ctx = ssl.create_default_context(cafile=cp)
            urllib.request.install_opener(
                urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
            )
            os.environ.setdefault("SSL_CERT_FILE", cp)
            logger.debug("SSL certs loaded from %s", cp)
            _applied = True
            return

    # Last resort: disable verification (logs a warning)
    logger.warning("No CA cert bundle found — disabling SSL verification")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    urllib.request.install_opener(
        urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
    )
    _applied = True


# Auto-apply on import
apply()
