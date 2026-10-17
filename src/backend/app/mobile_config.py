"""Local upload pairing settings, separate from provider credentials."""
import os
from pathlib import Path
import secrets

from .scans import read_json, write_json


def upload_token(root: Path) -> str:
    configured = os.getenv("ROOMCANVAS_UPLOAD_TOKEN", "").strip()
    if configured:
        if len(configured) < 32:
            raise ValueError("ROOMCANVAS_UPLOAD_TOKEN must contain at least 32 characters")
        return configured
    path = root / "tmp/mobile-upload/config.json"
    if path.is_file():
        return read_json(path)["token"]
    token = secrets.token_urlsafe(36)
    write_json(path, {"token": token})
    return token


def mobile_library(root: Path) -> Path:
    return Path(os.getenv("ROOMCANVAS_LIBRARY_DIR", str(root / "reference/ToCodex/room"))).resolve()


def public_endpoint(root: Path) -> str:
    configured = os.getenv("ROOMCANVAS_UPLOAD_PUBLIC_URL", "").strip()
    if configured:
        return configured
    path = root / "tmp/mobile-upload/endpoint.json"
    return read_json(path).get("endpoint", "") if path.is_file() else ""
