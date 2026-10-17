"""Adapter for the actual roomcanvas.scan.v1 iOS bundle."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from .heading import correct_magnetic_north


def safe_path(root: Path, relative: str) -> Path:
    path = (root / relative.replace("\\", "/")).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("扫描包包含越界路径")
    return path


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".writing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def matrix(value: Any) -> np.ndarray:
    result = np.asarray(value, dtype=float).reshape((4, 4), order="F")
    if not np.isfinite(result).all() or not np.allclose(result[3], [0, 0, 0, 1], atol=1e-4):
        raise ValueError("扫描位姿必须为有限的 column-major 4x4 仿射矩阵")
    return result


def pose(transform: np.ndarray, offset: np.ndarray) -> dict:
    rotation = transform.copy()
    rotation[:3, 3] = 0
    quaternion = trimesh.transformations.quaternion_from_matrix(rotation)
    quaternion /= np.linalg.norm(quaternion)
    w, x, y, z = quaternion
    return {"position": (transform[:3, 3] + offset).tolist(), "rotation": [float(x), float(y), float(z), float(w)]}


def wall_panels(wall: dict, apertures: list[dict]) -> list[dict]:
    """Subtract coplanar door/window rectangles from a local XY wall board."""
    transform = matrix(wall["surfaceToWorld"])
    width, height = wall["dimensions"][:2]
    holes = []
    for opening in apertures:
        opening_transform = matrix(opening["surfaceToWorld"])
        local = np.linalg.inv(transform) @ opening_transform
        if abs(local[2, 3]) > 0.2 or abs(local[2, 2]) < 0.95:
            continue
        ow, oh = opening["dimensions"][:2]
        x, y = local[:2, 3]
        hole = (max(-width/2, x-ow/2), min(width/2, x+ow/2), max(-height/2, y-oh/2), min(height/2, y+oh/2))
        if hole[1] > hole[0] and hole[3] > hole[2]:
            holes.append(hole)
    xs = sorted({-width/2, width/2, *(edge for hole in holes for edge in hole[:2])})
    ys = sorted({-height/2, height/2, *(edge for hole in holes for edge in hole[2:])})
    panels = []
    for x0, x1 in zip(xs, xs[1:]):
        for y0, y1 in zip(ys, ys[1:]):
            x, y = (x0+x1)/2, (y0+y1)/2
            if any(h[0] <= x <= h[1] and h[2] <= y <= h[3] for h in holes):
                continue
            piece = transform.copy()
            piece[:3, 3] = (transform @ [x, y, 0, 1])[:3]
            panels.append({"matrix": piece, "size": [x1-x0, y1-y0, 0.1]})
    return panels


def adapt_orientation(value: Any, captured_at: str | None = None) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("reference") not in ("true-north", "magnetic-north"):
        raise ValueError("Unknown north reference")
    north = np.asarray(value.get("northInWorld"), dtype=float)
    if north.shape != (3,) or not np.isfinite(north).all() or abs(north[1]) > 0.1 or np.linalg.norm(north[[0, 2]]) < 0.9:
        raise ValueError("Invalid world north vector")
    accuracy = value.get("accuracyDegrees")
    coherence = value.get("coherence")
    count = value.get("sampleCount")
    if not isinstance(accuracy, (int, float)) or not math.isfinite(accuracy) or not 0 <= accuracy <= 25:
        raise ValueError("Unreliable heading accuracy")
    if not isinstance(coherence, (int, float)) or not math.isfinite(coherence) or not 0.94 <= coherence <= 1.00001:
        raise ValueError("Inconsistent north samples")
    if not isinstance(count, int) or isinstance(count, bool) or count < 5:
        raise ValueError("Too few synchronized heading samples")
    north[1] = 0
    north /= np.linalg.norm(north)
    result = {key: value[key] for key in ("reference", "method", "accuracyDegrees", "coherence", "sampleCount") if key in value}
    result["northInWorld"] = north.tolist()
    offset = value.get("utcOffsetMinutes")
    if isinstance(offset, (int, float)) and math.isfinite(offset) and -720 <= offset <= 840:
        result["utcOffsetMinutes"] = offset
    location = value.get("location")
    if isinstance(location, dict):
        lat, lon = location.get("latitude"), location.get("longitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180:
            result["location"] = {"latitude": lat, "longitude": lon}
    # The room adapter only translates AR coordinates; correction changes the
    # north reference, never the room, furniture, or camera transforms.
    if result["reference"] == "magnetic-north":
        correct_magnetic_north(result, captured_at)
    if result["reference"] == "true-north":
        nx, _, nz = result["northInWorld"]
        result["northAngleDegrees"] = math.degrees(math.atan2(nx, -nz)) % 360
    return result


def adapt_scan(bundle: Path, scene_id: str) -> dict:
    metadata = read_json(bundle / "manifest.json")
    source = read_json(bundle / "scene.json")
    if metadata.get("schemaVersion") != "roomcanvas.scan.v1" or source.get("schemaVersion") != "roomcanvas.scene.v1":
        raise ValueError("不支持的扫描 schemaVersion")
    if metadata.get("status") != "complete" or metadata.get("id") != source.get("scanId"):
        raise ValueError("扫描包未完成或 manifest/scene 的 scanId 不一致")
    if source.get("units") != "meters" or source.get("matrixLayout") != "column-major" or "Y-up" not in source.get("coordinateSystem", ""):
        raise ValueError("扫描必须明确使用 meters、column-major、Y-up")
    floors = [s for s in source["surfaces"] if s["kind"] == "floor"]
    if not floors:
        raise ValueError("扫描缺少地板，无法确定地面基准")
    primary_floor = max(floors, key=lambda s: s["dimensions"][0]*s["dimensions"][1])
    offset = -matrix(primary_floor["surfaceToWorld"])[:3, 3]
    surfaces = []
    colliders = []
    floor_points = []
    floor_record = None
    apertures = [s for s in source["surfaces"] if s["kind"] in ("door", "window", "opening")]
    for surface in source["surfaces"]:
        transform = matrix(surface["surfaceToWorld"])
        if surface["kind"] == "wall":
            for index, piece in enumerate(wall_panels(surface, apertures)):
                panel = {"id": f"{surface['id']}-{index}", "kind": "wall", "size": piece["size"], **pose(piece["matrix"], offset)}
                surfaces.append(panel)
                colliders.append({key: panel[key] for key in ("position", "rotation", "size")})
        elif surface["kind"] == "floor":
            corners = surface.get("polygonCorners") or [[-surface["dimensions"][0]/2, -surface["dimensions"][1]/2, 0], [surface["dimensions"][0]/2, -surface["dimensions"][1]/2, 0], [surface["dimensions"][0]/2, surface["dimensions"][1]/2, 0], [-surface["dimensions"][0]/2, surface["dimensions"][1]/2, 0]]
            floor_points.extend(((transform @ [*corner, 1])[:3] + offset).tolist() for corner in corners)
            floor_record = {"id": surface["id"], "kind": "floor", "size": [*surface["dimensions"][:2], 0.05], "polygonCorners": corners, **pose(transform, offset)}
            surfaces.append(floor_record)
    if floor_record:
        wall_tops = []
        for wall in (surface for surface in source["surfaces"] if surface["kind"] == "wall"):
            wall_transform = matrix(wall["surfaceToWorld"])
            top = (wall_transform @ [0, wall["dimensions"][1] / 2, 0, 1])[1] + offset[1]
            if math.isfinite(top): wall_tops.append(float(top))
        if wall_tops:
            ceiling = dict(floor_record)
            ceiling.update(id="room-ceiling", kind="ceiling", position=[floor_record["position"][0], max(wall_tops), floor_record["position"][2]])
            surfaces.append(ceiling)
    room_points = list(floor_points)
    for wall in (surface for surface in source["surfaces"] if surface["kind"] == "wall"):
        transform = matrix(wall["surfaceToWorld"])
        width, height = wall["dimensions"][:2]
        room_points.extend(((transform @ [x, y, 0, 1])[:3] + offset).tolist()
                           for x in (-width/2, width/2) for y in (-height/2, height/2))
    bounds_min = np.min(room_points, axis=0)
    bounds_max = np.max(room_points, axis=0)
    furniture = []
    labels = {"table": "桌子", "chair": "椅子", "sofa": "沙发", "bed": "床", "storage": "柜子"}
    for index, obj in enumerate(source["objects"]):
        size = [float(v) for v in obj["dimensions"]]
        if len(size) != 3 or not all(math.isfinite(v) and v > 0 for v in size):
            raise ValueError("家具尺寸必须是三个正数")
        crops = sorted(obj.get("crops", []), key=lambda crop: crop.get("score", 0), reverse=True)
        for crop in crops:
            if not safe_path(bundle, crop["imagePath"]).is_file():
                raise ValueError(f"缺少家具裁剪图: {crop['imagePath']}")
        transform = pose(matrix(obj["objectToWorld"]), offset)
        furniture.append({
            "id": obj["id"], "name": f"{labels.get(obj['category'], obj['category'])} {index+1}", "category": obj["category"],
            "kind": "original", "size": size, **transform,
            "originalBounds": {**transform, "size": size}, "generationStatus": "pending", "crops": crops,
            "cropUrl": f"/api/scenes/{scene_id}/files/{crops[0]['imagePath']}" if crops else None,
            "reviewRequired": any(crop.get("reviewRequired", False) for crop in crops),
        })
    cameras = []
    for camera in read_json(bundle / "cameras.json"):
        saved = dict(camera)
        adjusted = matrix(camera["cameraToWorld"])
        adjusted[:3, 3] += offset
        saved["cameraToWorld"] = adjusted.flatten(order="F").tolist()
        saved["imageUrl"] = f"/api/scenes/{scene_id}/files/{camera['imagePath']}"
        cameras.append(saved)
    warnings = list(metadata.get("warnings", []))
    try:
        orientation = adapt_orientation(source.get("orientation") or metadata.get("orientation"), metadata.get("createdAt"))
        if orientation and orientation["reference"] != "true-north":
            warnings.append("指南针仅记录磁北；太阳真北需要在 Web 手动校准。")
        elif orientation and orientation.get("correction"):
            warnings.append("已按扫描位置和日期用 WMM2025 将磁北修正为真北；仍受原指南针精度与室内磁干扰影响。")
    except (ValueError, TypeError):
        orientation = None
        warnings.append("扫描朝向数据无效或精度不足，已保留房间并使用手动北向校准。")
    return {
        "id": scene_id, "title": metadata.get("title", "扫描房间"), "version": "1.0",
        "units": "meters", "coordinateSystem": "right-handed-y-up",
        "source": {"schemaVersion": source["schemaVersion"], "scanId": source["scanId"], "coordinateSystem": source["coordinateSystem"], "matrixLayout": source["matrixLayout"], "worldOffset": offset.tolist(), "orientation": orientation},
        "room": {"surfaces": surfaces, "colliders": colliders, "bounds": (bounds_max-bounds_min).tolist(), "min": bounds_min.tolist(), "max": bounds_max.tolist()},
        "furniture": furniture, "cameras": cameras, "warnings": warnings,
    }
