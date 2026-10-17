"""Estimate conservative, uniform surface finishes from calibrated RGB-D frames."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path
import warnings

import numpy as np
from PIL import Image, ImageDraw

MATERIAL_VERSION = "rgbd-uniform-v1"


def _resource(bundle: Path, relative: str) -> Path:
    path = (bundle / relative.replace("\\", "/")).resolve()
    if not path.is_relative_to(bundle.resolve()):
        raise ValueError("Surface image/depth path escapes the scan bundle")
    return path


def _matrix(values):
    result = np.asarray(values, dtype=float).reshape(4, 4, order="F")
    if not np.isfinite(result).all() or not np.allclose(result[3], [0, 0, 0, 1], atol=1e-4):
        raise ValueError("Invalid surface/camera transform")
    return result


def _points(surface):
    width, height = surface["dimensions"][:2]
    if not np.isfinite([width, height]).all() or min(width, height) <= 0:
        raise ValueError("Invalid surface dimensions")
    corners = surface.get("polygonCorners")
    if not corners or surface["kind"] == "wall":
        corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]
    corners = np.asarray(corners)[:, :2]
    minimum, maximum = corners.min(axis=0), corners.max(axis=0)
    extent = maximum - minimum
    nx, ny = np.clip(np.ceil(extent / 0.14).astype(int), 6, 90)
    u, v = np.meshgrid((np.arange(nx) + 0.5) / nx, (np.arange(ny) + 0.5) / ny)
    local = np.column_stack([minimum[0] + u.ravel() * extent[0], minimum[1] + v.ravel() * extent[1], np.zeros(nx * ny), np.ones(nx * ny)])
    mask = Image.new("1", (int(nx), int(ny)))
    polygon = (corners - minimum) / np.maximum(extent, 1e-6) * [nx, ny]
    ImageDraw.Draw(mask).polygon([tuple(point) for point in polygon], fill=1)
    valid = np.asarray(mask).ravel().copy()
    # Stay off wall/floor junctions, doors, trim and uncertain RoomPlan boundaries.
    if nx > 6 and ny > 6:
        valid &= (u.ravel() > 0.05) & (u.ravel() < 0.95) & (v.ravel() > 0.05) & (v.ravel() < 0.95)
    transform = _matrix(surface["surfaceToWorld"])
    world = local @ transform.T
    return world, valid, (int(nx), int(ny))


def _blocked_by_box(origin, targets, transform, size):
    inverse = np.linalg.inv(transform)
    start = inverse[:3, :3] @ origin + inverse[:3, 3]
    ends = targets @ inverse[:3, :3].T + inverse[:3, 3]
    direction = ends - start
    half = np.asarray(size) / 2 + 0.025
    with np.errstate(divide="ignore", invalid="ignore"):
        first = (-half - start) / direction
        second = (half - start) / direction
    parallel = np.abs(direction) < 1e-9
    inside = np.abs(start) <= half
    low = np.where(parallel, np.where(inside, -np.inf, np.inf), np.minimum(first, second)).max(axis=1)
    high = np.where(parallel, np.where(inside, np.inf, -np.inf), np.maximum(first, second)).min(axis=1)
    return (high >= np.maximum(low, 0)) & (low < 0.98) & (high > 0)


def _dominant(rgb):
    """A dominant chroma cluster tolerates exposure changes better than raw RGB means."""
    rgb = np.asarray(rgb, dtype=float)
    brightness = rgb.mean(axis=1)
    good = (rgb.max(axis=1) < 249) & (brightness > 30)
    rgb = rgb[good]
    if len(rgb) < 20:
        return None
    # Normalized R/G/B chromaticity separates wood, paint, chairs and floor tones
    # without splitting the same paint into light and shadow clusters.
    chroma = rgb / rgb.sum(axis=1, keepdims=True)
    bins = np.clip((chroma[:, :2] * 40).astype(int), 0, 39)
    ids = bins[:, 0] * 40 + bins[:, 1]
    counts = np.bincount(ids, minlength=1600).reshape(40, 40)
    pooled = sum(np.pad(counts, 1)[dx:dx + 40, dy:dy + 40] for dx in range(3) for dy in range(3))
    center = np.array(np.unravel_index(pooled.argmax(), pooled.shape))
    cluster = np.max(np.abs(bins - center), axis=1) <= 1
    clean = rgb[cluster]
    if len(clean) < 20:
        return None
    # Trim dark shadows and specular highlights; this is observed paint colour,
    # not a claim of physically recovered albedo or measured roughness.
    intensity = clean.mean(axis=1)
    low, high = np.quantile(intensity, [0.3, 0.85])
    clean = clean[(intensity >= low) & (intensity <= high)]
    return np.median(clean, axis=0), float(cluster.mean())


def estimate_finishes(bundle: Path, diagnostics: dict | None = None) -> dict[str, dict]:
    source = json.loads((bundle / "scene.json").read_text(encoding="utf-8"))
    cameras = json.loads((bundle / "cameras.json").read_text(encoding="utf-8"))
    surfaces = [surface for surface in source["surfaces"] if surface["kind"] in ("wall", "floor")]
    objects = [(_matrix(obj["objectToWorld"]), obj["dimensions"]) for obj in source["objects"]]
    records = []
    apertures = [s for s in source["surfaces"] if s["kind"] in ("door", "window", "opening")]
    for surface in surfaces:
        points, valid, shape = _points(surface)
        for aperture in apertures:
            local = points @ np.linalg.inv(_matrix(aperture["surfaceToWorld"])).T
            half = np.asarray(aperture["dimensions"]) / 2
            valid &= ~((np.abs(local[:, 2]) < 0.16) & (np.abs(local[:, 0]) < half[0] + 0.06) & (np.abs(local[:, 1]) < half[1] + 0.06))
        records.append({"surface": surface, "points": points, "valid": valid, "shape": shape, "views": [], "raw": [], "filtered": [], "samples": [], "best": None})
    # Evenly distributed, sharp frames limit preprocessing time and duplicate views.
    normal = [camera for camera in cameras if camera.get("trackingState") == "normal"]
    stride = max(3, int(np.ceil(len(normal) / 48)))
    chosen = [max(normal[index:index + stride], key=lambda camera: camera.get("sharpness", 0)) for index in range(0, len(normal), stride)]
    for camera in chosen:
        if not all(camera.get(key) for key in ("nativePixelToSavedPixel", "intrinsics", "nativeImageWidth", "nativeImageHeight")):
            continue
        image_path = _resource(bundle, camera["imagePath"])
        if not image_path.is_file():
            continue
        with Image.open(image_path) as frame:
            image = np.asarray(frame.convert("RGB"))
        pose = _matrix(camera["cameraToWorld"])
        inverse = np.linalg.inv(pose)
        origin = pose[:3, 3]
        intrinsics = np.asarray(camera["intrinsics"]).reshape(3, 3, order="F")
        saved = np.asarray(camera["nativePixelToSavedPixel"]).reshape(3, 3, order="F")
        depth = camera.get("depth")
        depth_map = confidence = None
        if depth and _resource(bundle, depth["depthPath"]).is_file():
            if depth.get("format") != "float32-little-endian, tightly packed rows, meters" or not str(depth.get("alignment", "")).startswith("native camera image orientation"):
                continue
            depth_map = np.fromfile(_resource(bundle, depth["depthPath"]), dtype="<f4").reshape(depth["height"], depth["width"])
            confidence_path = _resource(bundle, depth.get("confidencePath", "missing"))
            if confidence_path.is_file():
                confidence = np.fromfile(confidence_path, dtype="u1").reshape(depth_map.shape)
        for record in records:
            points, surface = record["points"], record["surface"]
            local = points @ inverse.T
            distance = -local[:, 2]
            projected = np.column_stack([local[:, 0], -local[:, 1], distance]) @ intrinsics.T
            projected /= np.maximum(projected[:, 2:3], 1e-8)
            pixels = projected @ saved.T
            valid = record["valid"] & (distance > 0.2) & (distance < 9)
            valid &= (pixels[:, 0] >= 10) & (pixels[:, 0] < image.shape[1] - 10) & (pixels[:, 1] >= 10) & (pixels[:, 1] < image.shape[0] - 10)
            rays = points[:, :3] - origin
            normal_axis = _matrix(surface["surfaceToWorld"])[:3, 2]
            incidence = np.abs(rays @ normal_axis) / np.maximum(np.linalg.norm(rays, axis=1), 1e-8)
            valid &= incidence > 0.35
            if not valid.any():
                continue
            px = np.clip(pixels[:, 0].astype(int), 0, image.shape[1] - 1)
            py = np.clip(pixels[:, 1].astype(int), 0, image.shape[0] - 1)
            colors = image[py, px]
            raw_valid = valid.copy()
            for transform, size in objects:
                valid &= ~_blocked_by_box(origin, points[:, :3], transform, size)
            if depth_map is not None:
                du = np.clip((projected[:, 0] / camera["nativeImageWidth"] * depth["width"]).astype(int), 0, depth["width"] - 1)
                dv = np.clip((projected[:, 1] / camera["nativeImageHeight"] * depth["height"]).astype(int), 0, depth["height"] - 1)
                measured = depth_map[dv, du]
                valid &= np.isfinite(measured) & (measured > 0) & (np.abs(measured - distance) < np.maximum(0.16, distance * 0.055))
                if confidence is not None:
                    valid &= confidence[dv, du] >= 1
            else:
                # Without depth, reject rays hitting a different structural plane first.
                for peer in surfaces:
                    if peer["id"] == surface["id"]:
                        continue
                    peer_inverse = np.linalg.inv(_matrix(peer["surfaceToWorld"]))
                    start = peer_inverse[:3, :3] @ origin + peer_inverse[:3, 3]
                    end = points @ peer_inverse.T
                    denominator = end[:, 2] - start[2]
                    fraction = -start[2] / np.where(np.abs(denominator) < 1e-8, np.inf, denominator)
                    hit = start[:2] + fraction[:, None] * (end[:, :2] - start[:2])
                    width, height = peer["dimensions"][:2]
                    valid &= ~((fraction > 0.001) & (fraction < 0.98) & (np.abs(hit[:, 0]) < width / 2) & (np.abs(hit[:, 1]) < height / 2))
            estimate = _dominant(colors[valid])
            if estimate is not None and valid.sum() >= 25:
                rgb, support = estimate
                record["views"].append({"frameId": camera["id"], "rgb": rgb.tolist(), "samples": int(valid.sum()), "support": support})
                if support > 0.45:
                    samples = np.full(colors.shape, np.nan, dtype=np.float32)
                    samples[valid] = colors[valid]
                    record["samples"].append(samples)
            if diagnostics is not None:
                record["raw"].append(colors[raw_valid])
                record["filtered"].append(colors[valid])
                if record["best"] is None or valid.sum() > record["best"]["count"]:
                    raw_grid = np.full(colors.shape, 95, dtype=np.uint8)
                    filtered_grid = raw_grid.copy()
                    raw_grid[raw_valid] = colors[raw_valid]
                    filtered_grid[valid] = colors[valid]
                    thumbnail = Image.fromarray(image)
                    thumbnail.thumbnail((360, 480))
                    marks = ImageDraw.Draw(thumbnail)
                    for x, y in pixels[valid, :2] * [thumbnail.width / image.shape[1], thumbnail.height / image.shape[0]]:
                        marks.ellipse((x-2, y-2, x+2, y+2), fill="#00ff88")
                    record["best"] = {"count": int(valid.sum()), "frameId": camera["id"], "rawGrid": raw_grid, "filteredGrid": filtered_grid, "photo": thumbnail}
    materials = {}
    for record in records:
        views = record["views"]
        # Small/unseen wall segments must retain their existing fallback paint.
        reliable = [view for view in views if view["support"] > 0.45]
        composite = np.full((len(record["points"]), 3), np.nan)
        if record["samples"]:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                composite = np.nanmedian(record["samples"], axis=0)
        observed = np.isfinite(composite).all(axis=1)
        coverage = float(observed.sum() / max(1, record["valid"].sum()))
        estimate = _dominant(composite[observed]) if observed.sum() >= 40 else None
        if len(reliable) >= 3 and sum(view["samples"] for view in reliable) >= 120 and coverage >= 0.08 and estimate is not None:
            # Each physical point contributes once, so a few tiny, overexposed
            # views cannot outweigh larger patches of the same surface.
            rgb, support = estimate
            color = "#" + "".join(f"{int(round(channel)):02x}" for channel in rgb)
            materials[record["surface"]["id"]] = {
                "baseColor": color, "roughness": 0.92, "method": MATERIAL_VERSION,
                "sourceSurfaceId": record["surface"]["id"], "frameCount": len(reliable),
                "sampleCount": sum(view["samples"] for view in reliable),
                "coverage": round(coverage, 3),
            }
        if diagnostics is not None:
            raw = np.concatenate(record["raw"]) if record["raw"] else np.empty((0, 3))
            filtered = np.concatenate(record["filtered"]) if record["filtered"] else np.empty((0, 3))
            diagnostics[record["surface"]["id"]] = {
                "kind": record["surface"]["kind"], "views": views,
                "rawMean": raw.mean(axis=0).tolist() if len(raw) else None,
                "filteredMedian": np.median(filtered, axis=0).tolist() if len(filtered) else None,
                "rawCount": len(raw), "filteredCount": len(filtered), "material": materials.get(record["surface"]["id"]),
                "rawColors": raw[::max(1, len(raw) // 2500)].astype(np.uint8),
                "filteredColors": filtered[::max(1, len(filtered) // 2500)].astype(np.uint8),
                "composite": np.nan_to_num(composite, nan=95).astype(np.uint8),
                "shape": record["shape"], "best": record["best"], "coverage": coverage,
            }
    return materials


def apply_finishes(scene: dict, bundle: Path, cache_path: Path) -> None:
    """Change appearance only; retain geometry, camera poses and every model job."""
    try:
        cameras_bytes = (bundle / "cameras.json").read_bytes()
        digest = hashlib.sha256(MATERIAL_VERSION.encode() + (bundle / "scene.json").read_bytes() + cameras_bytes)
        # Bundles are immutable after import, but invalidate if RGB/depth files
        # are added or replaced (e.g. an older demo without its depth cache).
        for camera in json.loads(cameras_bytes):
            depth = camera.get("depth") or {}
            for relative in (camera.get("imagePath"), depth.get("depthPath"), depth.get("confidencePath")):
                if not relative:
                    continue
                path = _resource(bundle, relative)
                stat = path.stat() if path.is_file() else None
                digest.update(f"{relative}:{stat.st_size if stat else 0}:{stat.st_mtime_ns if stat else 0}".encode())
        fingerprint = digest.hexdigest()
        cached = None
        if cache_path.is_file():
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                pass
        if not cached or cached.get("fingerprint") != fingerprint:
            cached = {"fingerprint": fingerprint, "method": MATERIAL_VERSION, "materials": estimate_finishes(bundle)}
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache_path.with_suffix(".writing")
            temporary.write_text(json.dumps(cached, indent=2), encoding="utf-8")
            temporary.replace(cache_path)
        materials = cached["materials"]
        recovered = set()
        for surface in scene["room"]["surfaces"]:
            if surface["kind"] not in ("wall", "floor"):
                continue
            source_id = next((key for key in materials if surface["id"] == key or surface["id"].startswith(key + "-")), None)
            if source_id:
                surface["finish"] = materials[source_id]
                recovered.add(source_id)
        scene["finishRecovery"] = {"method": MATERIAL_VERSION, "status": "complete", "recoveredSurfaces": len(recovered)}
    except (OSError, ValueError, KeyError, TypeError, np.linalg.LinAlgError):
        # Missing calibration/RGB-D must never prevent room editing or trigger
        # paid model regeneration. Existing/default paint remains available.
        scene["finishRecovery"] = {"method": MATERIAL_VERSION, "status": "unavailable", "recoveredSurfaces": 0}
