"""Check scaled textured high/low GLBs from a completed scene, using only public API fields."""
import argparse
import gc
import json
from pathlib import Path
import struct

import httpx
import numpy as np
import trimesh

parser = argparse.ArgumentParser()
parser.add_argument("scene_id")
parser.add_argument("--require-complete", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]


def inspect_model(url, expected, low):
    path = root / "tmp/models" / url.rsplit("/", 1)[-1]
    with path.open("rb") as file:
        magic, version, size, json_length, chunk_type = struct.unpack("<4sIIII", file.read(20))
        assert magic == b"glTF" and version == 2 and size == path.stat().st_size and chunk_type == 0x4E4F534A
        document = json.loads(file.read(json_length))
    assert document.get("textures") and document.get("images"), "Generated GLB lost its textures"
    assert all("bufferView" in image for image in document["images"]), "Textures are not embedded in the GLB"
    assert any(material.get("pbrMetallicRoughness", {}).get("baseColorTexture") for material in document.get("materials", [])), "No material uses the generated color texture"
    model = trimesh.load(path, force="scene", process=False, skip_materials=True)
    extents = model.extents
    tolerance = 0.03 if low else 0.0001
    np.testing.assert_allclose(extents, expected, rtol=tolerance, atol=0.0001)
    faces = sum(len(mesh.faces) for mesh in model.geometry.values())
    assert faces > 0
    bounds_center = model.bounds.mean(axis=0)
    assert np.linalg.norm(bounds_center) < max(expected) * tolerance + 0.001, "Furniture root is no longer centered"
    summary = {"faces": faces, "textures": len(document["textures"]), "sizeMeters": extents.tolist()}
    del model
    gc.collect()
    return summary


with httpx.Client(base_url="http://127.0.0.1:8000", timeout=60) as client:
    scene = client.get(f"/api/scenes/{args.scene_id}").raise_for_status().json()
    result = []
    for item in scene["furniture"]:
        if item["generationStatus"] != "succeeded":
            assert not args.require_complete, f"Furniture is not ready: {item['id']} {item['generationStatus']}"
            continue
        high = inspect_model(item["modelUrl"], item["size"], False)
        low = inspect_model(item["editModelUrl"], item["size"], True)
        assert low["faces"] <= high["faces"], "Edit mesh is denser than Play mesh"
        for url in [item["modelUrl"], item["editModelUrl"]]:
            # FastAPI exposes GET; verify GLB headers without retaining a second full copy.
            with client.stream("GET", url) as response:
                response.raise_for_status()
                first = next(response.iter_bytes())
                assert first[:4] == b"glTF"
        result.append({"id": item["id"], "high": high, "low": low})
        print(json.dumps(result[-1]), flush=True)
    print(json.dumps({"result": "PASS", "scene": scene["id"], "completed": len(result), "total": len(scene["furniture"])}))
