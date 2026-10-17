"""Choose a single furniture image using calibrated depth and source-world OBBs."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np
import cv2
from PIL import Image, ImageChops, ImageFilter

from .scans import matrix, read_json, safe_path

CROP_POLICY = "best-effort-v2"


class CropNeedsReview(ValueError):
    pass


def _box_rectangle(obj: dict, camera: dict) -> np.ndarray | None:
    half = np.asarray(obj["dimensions"]) / 2
    corners = np.array([[x, y, z, 1] for x in (-half[0], half[0]) for y in (-half[1], half[1]) for z in (-half[2], half[2])])
    local = corners @ (np.linalg.inv(matrix(camera["cameraToWorld"])) @ matrix(obj["objectToWorld"])).T
    if np.any(local[:, 2] >= -0.05):
        # Clip the box's edges at the camera near plane instead of rejecting
        # large/near furniture whose eight corners are not all in front.
        clipped = [point for point in local if point[2] < -0.05]
        for first in range(8):
            for bit in (1, 2, 4):
                second = first ^ bit
                if second <= first:
                    continue
                a, b = local[first], local[second]
                if (a[2] < -0.05) != (b[2] < -0.05):
                    clipped.append(a + ((-0.05 - a[2]) / (b[2] - a[2])) * (b - a))
        if not clipped:
            return None
        local = np.asarray(clipped)
    pixels = local[:, :3] * [1, -1, -1] @ np.asarray(camera["intrinsics"]).reshape(3, 3, order="F").T
    pixels /= pixels[:, 2:3]
    pixels = pixels @ np.asarray(camera["nativePixelToSavedPixel"]).reshape(3, 3, order="F").T
    return np.r_[pixels[:, :2].min(axis=0), pixels[:, :2].max(axis=0)]


def _neighbor_overlap(obj: dict, objects: list[dict], camera: dict) -> float:
    target = _box_rectangle(obj, camera)
    if target is None:
        return 1.0
    area = np.prod(np.maximum(target[2:] - target[:2], 0))
    overlap = 0.0
    for peer in objects:
        if peer["id"] == obj["id"]:
            continue
        rectangle = _box_rectangle(peer, camera)
        if rectangle is not None:
            intersection = np.prod(np.maximum(np.minimum(target[2:], rectangle[2:]) - np.maximum(target[:2], rectangle[:2]), 0))
            overlap = max(overlap, float(intersection / max(area, 1)))
    return overlap


def _depth_mask(bundle: Path, obj: dict, objects: list[dict], surfaces: list[dict], camera: dict) -> tuple[Image.Image, np.ndarray]:
    depth = camera.get("depth") or {}
    if not depth:
        raise FileNotFoundError("没有深度图")
    if depth.get("format") != "float32-little-endian, tightly packed rows, meters" or not str(depth.get("alignment", "")).startswith("native camera image orientation"):
        raise CropNeedsReview("缺少可校准的深度图")
    width, height = int(depth["width"]), int(depth["height"])
    if not 0 < width * height <= 4_000_000:
        raise CropNeedsReview("深度尺寸无效")
    values = np.fromfile(safe_path(bundle, depth["depthPath"]), dtype="<f4").reshape(height, width)
    valid = np.isfinite(values) & (values > 0.05) & (values < 15)
    if depth.get("confidencePath"):
        confidence = np.fromfile(safe_path(bundle, depth["confidencePath"]), dtype="u1").reshape(height, width)
        valid &= confidence >= 1
    u, v = np.meshgrid((np.arange(width) + 0.5) * camera["nativeImageWidth"] / width,
                       (np.arange(height) + 0.5) * camera["nativeImageHeight"] / height)
    intrinsic = np.asarray(camera["intrinsics"]).reshape(3, 3, order="F")
    rays = np.stack([u, v, np.ones_like(u)], axis=-1) @ np.linalg.inv(intrinsic).T
    xyz = rays * np.nan_to_num(values, nan=0, posinf=0, neginf=0)[..., None] * [1, -1, -1]
    world = np.concatenate([xyz, np.ones((height, width, 1))], axis=-1) @ matrix(camera["cameraToWorld"]).T
    target = world @ np.linalg.inv(matrix(obj["objectToWorld"])).T
    half = np.asarray(obj["dimensions"]) / 2
    margin = min(0.045, float(half.min()) * 0.12)
    valid &= np.all(np.abs(target[..., :3]) <= half + margin, axis=-1)
    # A second object may share a screen rectangle, but depth separates its
    # physical volume. Ambiguous overlapping volumes are conservatively removed.
    for peer in objects:
        if peer["id"] == obj["id"]:
            continue
        local = world @ np.linalg.inv(matrix(peer["objectToWorld"])).T
        valid &= ~np.all(np.abs(local[..., :3]) < np.maximum(np.asarray(peer["dimensions"]) / 2 - 0.015, 0.005), axis=-1)
    for surface in surfaces:
        if surface["kind"] not in ("wall", "floor"):
            continue
        local = world @ np.linalg.inv(matrix(surface["surfaceToWorld"])).T
        near_plane = np.abs(local[..., 2]) < (0.065 if surface["kind"] == "floor" else 0.04)
        within = np.all(np.abs(local[..., :2]) <= np.asarray(surface["dimensions"][:2]) / 2 + 0.02, axis=-1)
        valid &= ~(near_plane & within)
    saved_to_depth = np.diag([width / camera["nativeImageWidth"], height / camera["nativeImageHeight"], 1]) @ np.linalg.inv(np.asarray(camera["nativePixelToSavedPixel"]).reshape(3, 3, order="F"))
    return Image.fromarray((valid * 255).astype(np.uint8)), saved_to_depth


def _best_effort_image(bundle: Path, obj: dict, cameras: dict, candidates: dict, rank) -> tuple[Image.Image, dict]:
    # Quality gates choose the preferred image, but cannot prevent generation.
    # Keep the unmasked crop when a depth mask would erase too much furniture.
    for crop in sorted(candidates.values(), key=rank, reverse=True):
        try:
            with Image.open(safe_path(bundle, crop["imagePath"])) as original:
                if crop.get("fromFrame"):
                    x, y, width, height = crop["rectanglePixels"]
                    original = original.crop((int(x), int(y), int(x + width), int(y + height)))
                if min(original.size) < 2:
                    continue
                image = original.convert("RGBA")
                if image.getchannel("A").getbbox() is None:
                    continue
                image.thumbnail((1024, 1024))
            return image, {"frameId": crop.get("frameId"), "method": "original-crop-fallback" if not crop.get("fromFrame") else "projected-frame-fallback",
                           "sourceImagePath": crop["imagePath"], "fallback": True, "qualityWarning": "采用可用原图尽力重建，可能存在遮挡、截断或相邻家具"}
        except (OSError, ValueError, KeyError, TypeError):
            continue
    # When no usable target crop exists, use the nearest available keyframe.
    center = matrix(obj["objectToWorld"])[:3, 3]
    def distance(camera):
        try:
            return float(np.linalg.norm(matrix(camera["cameraToWorld"])[:3, 3] - center))
        except (ValueError, KeyError):
            return float("inf")
    for camera in sorted(cameras.values(), key=distance):
        try:
            with Image.open(safe_path(bundle, camera["imagePath"])) as original:
                image = original.convert("RGBA")
                image.thumbnail((1024, 1024))
            return image, {"frameId": camera["id"], "method": "keyframe-fallback", "sourceImagePath": camera["imagePath"], "fallback": True,
                           "qualityWarning": "没有可用单件裁剪，使用邻近关键帧尽力重建；外形可能不准确"}
        except (OSError, ValueError, KeyError):
            continue
    raise CropNeedsReview("采集包没有可读取的家具图或关键帧，无法调用图生 3D")


def prepare_furniture_crop(bundle: Path, furniture_id: str, output: Path) -> dict:
    source = read_json(bundle / "scene.json")
    obj = next(obj for obj in source["objects"] if obj["id"] == furniture_id)
    cameras = {camera["id"]: camera for camera in read_json(bundle / "cameras.json")}
    candidates = {crop["frameId"]: dict(crop) for crop in obj.get("crops", [])}
    # Scanner crops are useful hints, not the only possible observations. Recheck
    # the calibrated full frames so the workflow also handles absent/bad crops.
    for camera in cameras.values():
        try:
            if camera.get("trackingState") != "normal" or camera["id"] in candidates:
                continue
            rectangle = _box_rectangle(obj, camera)
            if rectangle is None:
                continue
            start = np.maximum(rectangle[:2], 0)
            end = np.minimum(rectangle[2:], [camera["imageWidth"], camera["imageHeight"]])
            size = end - start
            visible = np.prod(np.maximum(size, 0)) / max(1, np.prod(rectangle[2:] - rectangle[:2]))
            if visible <= 0 or min(size) < 4:
                continue
            start, end = np.floor(start), np.ceil(end)
            candidates[camera["id"]] = {"frameId": camera["id"], "imagePath": camera["imagePath"], "rectanglePixels": [*start.tolist(), *(end - start).tolist()], "visibleFraction": float(visible), "fromFrame": True}
        except (ValueError, KeyError, TypeError, np.linalg.LinAlgError):
            continue
    def rank(crop):
        try:
            camera = cameras[crop["frameId"]]
            overlap = _neighbor_overlap(obj, source["objects"], camera)
            area = np.prod(crop["rectanglePixels"][2:]) / max(1, camera["imageWidth"] * camera["imageHeight"])
            return float(crop.get("visibleFraction", 0)) * math.sqrt(area) * max(0.05, 1 - overlap * 1.5)
        except (ValueError, KeyError, TypeError):
            return 0
    choices = []
    for crop in sorted(candidates.values(), key=rank, reverse=True)[:12]:
        try:
            camera = cameras[crop["frameId"]]
            if camera.get("trackingState") != "normal":
                raise CropNeedsReview("相机定位不稳定")
            rectangle = np.asarray(crop["rectanglePixels"], dtype=float)
            if rectangle.shape != (4,) or not np.isfinite(rectangle).all() or min(rectangle[2:]) < 32:
                raise CropNeedsReview("裁剪范围或分辨率无效")
            x, y, width, height = rectangle
            if x < 0 or y < 0 or x + width > camera["imageWidth"] + 1 or y + height > camera["imageHeight"] + 1:
                raise CropNeedsReview("裁剪越过源图边界")
            visible = float(crop.get("visibleFraction", 0))
            if visible < 0.9:
                raise CropNeedsReview("家具截断过多，需要更完整视角")
            overlap = _neighbor_overlap(obj, source["objects"], camera)
            if overlap > 0.35:
                raise CropNeedsReview("相邻家具遮挡过大，无法可靠推断整件形状")
            image_path = safe_path(bundle, crop["imagePath"])
            with Image.open(image_path) as original:
                if crop.get("fromFrame"):
                    original = original.crop(tuple(int(value) for value in (x, y, x + width, y + height)))
                if abs(original.width - width) > 1 or abs(original.height - height) > 1:
                    raise CropNeedsReview("裁剪图与标定尺寸不一致")
                image = original.convert("RGBA")
            image.thumbnail((1024, 1024))
            method = "rgbd-target-obb"
            try:
                mask, saved_to_depth = _depth_mask(bundle, obj, source["objects"], source["surfaces"], camera)
                crop_to_saved = np.array([[width / image.width, 0, x], [0, height / image.height, y], [0, 0, 1]])
                transform = saved_to_depth @ crop_to_saved
                mask = mask.transform(image.size, Image.Transform.AFFINE, tuple(transform[:2].ravel()), resample=Image.Resampling.NEAREST)
                mask = ImageChops.multiply(mask, image.getchannel("A")).filter(ImageFilter.MedianFilter(3))
                binary = (np.asarray(mask) > 127).astype(np.uint8)
                count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
                if count < 2:
                    raise CropNeedsReview("目标家具没有可靠深度像素")
                largest = 1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())
                if stats[largest, cv2.CC_STAT_AREA] / max(1, binary.sum()) < 0.75:
                    raise CropNeedsReview("目标分割存在多个大块，可能混入相邻家具或严重缺损")
                mask = Image.fromarray(((labels == largest) * 255).astype(np.uint8))
                box = mask.getbbox()
                if box is None:
                    raise CropNeedsReview("目标家具没有可靠深度像素")
                coverage = float((np.asarray(mask) > 127).mean())
                span_x, span_y = (box[2] - box[0]) / image.width, (box[3] - box[1]) / image.height
                if coverage < 0.1 or span_x < 0.45 or span_y < 0.65:
                    raise CropNeedsReview("遮挡或深度缺损过多，不能可靠分离整件家具")
                image.putalpha(mask)
                margin = max(4, int(max(image.size) * 0.03))
                image = image.crop((max(0, box[0] - margin), max(0, box[1] - margin), min(image.width, box[2] + margin), min(image.height, box[3] + margin)))
                quality = visible * math.sqrt(coverage) * span_x * span_y
            except FileNotFoundError:
                # Older bundles may lack depth. Only isolated, almost-complete
                # views can use their original crop without pretending a mask.
                overlap = _neighbor_overlap(obj, source["objects"], camera)
                if visible < 0.92 or overlap > 0.05:
                    raise CropNeedsReview("缺少深度且与相邻家具重叠，请补拍独立正面图")
                coverage = 1.0
                method = "isolated-calibrated-crop"
                quality = visible * (1 - overlap) * 0.5
            choices.append((quality, image, {"frameId": camera["id"], "method": method, "maskCoverage": round(coverage, 4), "sourceImagePath": crop["imagePath"]}))
        except (OSError, ValueError, KeyError, TypeError, np.linalg.LinAlgError):
            continue
    if not choices:
        image, selection = _best_effort_image(bundle, obj, cameras, candidates, rank)
    else:
        _, image, selection = max(choices, key=lambda choice: choice[0])
    output.mkdir(parents=True, exist_ok=True)
    filename = hashlib.sha256(furniture_id.encode()).hexdigest()[:24] + ".png"
    path = output / filename
    image.save(path)
    return {**selection, "policy": CROP_POLICY, "imagePath": path.relative_to(bundle).as_posix()}
