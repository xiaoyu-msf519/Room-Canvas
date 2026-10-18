"""Catalog hierarchy, bounded images and safe opaque-ID serving; no paid API calls."""
import asyncio
import io
from pathlib import Path
import sys

import httpx
from fastapi import FastAPI
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.catalog import catalog, coverage_meters, router


async def verify():
    app = FastAPI()
    app.include_router(router)
    records = catalog()
    assert len(records) == 5500
    assert coverage_meters("150x150cm") == [1.5, 1.5]
    assert coverage_meters("2.4x1.2m") == [2.4, 1.2]
    assert coverage_meters("未标注") is None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://catalog") as client:
        data = (await client.get("/api/catalog/items")).json()
        assert data["total"] == 5000 and len(data["items"]) == 24
        assert len(data["categories"]) == 25
        item = data["items"][0]
        filtered = (await client.get("/api/catalog/items", params={"category": item["category"], "color": item["color"], "texture": item["texture"]})).json()
        assert filtered["total"] > 0
        assert all(entry["category"] == item["category"] and entry["color"] == item["color"] and entry["texture"] == item["texture"] for entry in filtered["items"])
        second = (await client.get("/api/catalog/items?page=2")).json()
        assert not set(entry["id"] for entry in data["items"]) & set(entry["id"] for entry in second["items"])
        assert "_path" not in str(data) and str(ROOT) not in str(data)
        thumbnail = await client.get(item["thumbnailUrl"])
        assert thumbnail.status_code == 200
        with Image.open(io.BytesIO(thumbnail.content)) as image:
            assert max(image.size) <= 224
        original = await client.get(item["imageUrl"])
        assert original.content == records[item["id"]]["_path"].read_bytes()
        wall = (await client.get("/api/catalog/items?kind=wall")).json()
        floor = (await client.get("/api/catalog/items?kind=floor")).json()
        assert wall["total"] == 329 and floor["total"] == 297
        for target in ("wall", "floor"):
            shared = (await client.get("/api/catalog/items", params={"kind": target, "category": "墙地两用_瓷砖与马赛克"})).json()
            assert shared["total"] == 126
        texture = await client.get(wall["items"][0]["textureUrl"])
        with Image.open(io.BytesIO(texture.content)) as image:
            assert max(image.size) <= 2048
        wallpapers = (await client.get("/api/catalog/items", params={"kind": "wall", "category": "墙面_壁纸与墙纸"})).json()
        assert wallpapers["total"] == 7
        for wallpaper in wallpapers["items"]:
            for variant in ("thumbnailUrl", "textureUrl"):
                response = await client.get(wallpaper[variant])
                assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
                with Image.open(io.BytesIO(response.content)) as image:
                    image.load()
                    assert image.width > 0 and image.height > 0
        for path in ("API.md", "id_ed25519", "..%2F..%2FAPI.md", "_采集记录"):
            response = await client.get(f"/api/catalog/items/{path}/image?variant=original")
            assert response.status_code == 404
        assert (await client.get(item["imageUrl"] + "&variant=../../API.md")).status_code == 422
        assert (await client.get("/api/catalog/items?page_size=10000")).status_code == 422
    print("PASS: 5,500 resources; three-level filters, pagination, dual-use finishes, metric coverage, bounded thumbnails/textures and private-file rejection.")


asyncio.run(verify())
