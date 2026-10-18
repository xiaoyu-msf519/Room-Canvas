from __future__ import annotations

import hashlib
import json
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[3]
INPUT_ROOT = ROOT / "reference" / "ToCodex"
CACHE_ROOT = ROOT / "tmp" / "catalog"
router = APIRouter(prefix="/api/catalog", tags=["catalog"])
CatalogKind = Literal["furniture", "wall", "floor"]


def coverage_meters(value: str) -> list[float] | None:
    # Metadata describes the WHOLE image footprint, not an individual tile.
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(cm|m)\s*", value)
    if not match:
        return None
    factor = 0.01 if match[3] == "cm" else 1
    size = [float(match[1]) * factor, float(match[2]) * factor]
    return size if all(0 < number <= 1000 for number in size) else None


@lru_cache(maxsize=1)
def catalog() -> dict[str, dict]:
    records = {}
    for collection in ("furniture", "decoration"):
        root = (INPUT_ROOT / collection).resolve()
        metadata = {}
        manifest = root / "_采集记录" / "图片清单.jsonl"
        if manifest.is_file():
            with manifest.open(encoding="utf-8-sig") as stream:
                for line in stream:
                    if line.strip():
                        record = json.loads(line)
                        metadata[str(record.get("id", ""))] = record
        for path in sorted(root.glob("*/*/*/*")):
            if path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp") or not path.is_file():
                continue
            relative = path.relative_to(root)
            if len(relative.parts) != 4 or relative.parts[0].startswith("_"):
                continue
            resolved = path.resolve()
            if not resolved.is_relative_to(root):
                continue
            category, color, texture, _ = relative.parts
            record = metadata.get(path.stem, {})
            kinds = ["furniture"] if collection == "furniture" else (
                ["wall", "floor"] if category.startswith("墙地两用_") else
                ["wall"] if category.startswith("墙面_") else ["floor"] if category.startswith("地面_") else []
            )
            if not kinds:
                continue
            item_id = f"{collection}-{path.stem}"
            records[item_id] = {
                "id": item_id, "name": record.get("name") or f"{texture} {path.stem}",
                "category": category, "color": color, "texture": texture, "kinds": kinds,
                "thumbnailUrl": f"/api/catalog/items/{item_id}/image?variant=thumbnail",
                "imageUrl": f"/api/catalog/items/{item_id}/image?variant=original",
                "textureUrl": f"/api/catalog/items/{item_id}/image?variant=texture",
                "coverageMeters": coverage_meters(str(record.get("coverage_size", ""))),
                "coverageNote": record.get("coverage_size") or "覆盖尺寸未标注",
                "sizeOriginal": record.get("size_original"),
                "source": record.get("source"), "rights": record.get("rights"),
                "_path": resolved,
            }
    return records


def public(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.startswith("_")}


@router.get("/items")
def list_items(kind: CatalogKind = "furniture", category: str = "", color: str = "", texture: str = "",
               q: str = "", page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=60)):
    items = [item for item in catalog().values() if kind in item["kinds"]]
    categories = sorted({item["category"] for item in items})
    if category:
        items = [item for item in items if item["category"] == category]
    colors = sorted({item["color"] for item in items})
    if color:
        items = [item for item in items if item["color"] == color]
    textures = sorted({item["texture"] for item in items})
    if texture:
        items = [item for item in items if item["texture"] == texture]
    if q.strip():
        query = q.strip().casefold()
        items = [item for item in items if query in " ".join(str(item[field]) for field in ("id", "name", "category", "color", "texture")).casefold()]
    start = (page - 1) * page_size
    return {"items": [public(item) for item in items[start:start + page_size]], "total": len(items),
            "categories": categories, "colors": colors, "textures": textures, "page": page, "pageSize": page_size}


@router.get("/items/{item_id}")
def get_item(item_id: str):
    item = catalog().get(item_id)
    if not item:
        raise HTTPException(404, "资源不存在")
    return public(item)


@router.get("/items/{item_id}/image")
def get_image(item_id: str, variant: Literal["thumbnail", "texture", "original"] = "thumbnail"):
    item = catalog().get(item_id)
    if not item or not item["_path"].is_file():
        raise HTTPException(404, "资源不存在")
    path: Path = item["_path"]
    headers = {"Cache-Control": "private, max-age=3600"}
    if variant == "original":
        return FileResponse(path, headers=headers)
    stamp = hashlib.sha256(f"{path}:{path.stat().st_mtime_ns}:{path.stat().st_size}".encode()).hexdigest()[:16]
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    target = CACHE_ROOT / f"{item_id}-{stamp}-{variant}.jpg"
    if not target.is_file():
        temporary = CACHE_ROOT / f"{uuid.uuid4().hex}.jpg"
        try:
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                limit = 224 if variant == "thumbnail" else 2048
                image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
                image.save(temporary, "JPEG", quality=85 if variant == "thumbnail" else 93)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return FileResponse(target, headers=headers)
