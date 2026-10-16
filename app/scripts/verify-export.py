"""Validate an actual RoomCanvas scan folder or exported ZIP without extracting it."""
import json
import math
import struct
import sys
import zipfile
from pathlib import Path, PurePosixPath


class ScanPackage:
    def __init__(self, path):
        self.path = Path(path)
        self.archive = zipfile.ZipFile(path) if self.path.is_file() else None
        self.names = set(self.archive.namelist()) if self.archive else {
            file.relative_to(self.path).as_posix() for file in self.path.rglob("*") if file.is_file()
        }

    def read(self, relative):
        name = PurePosixPath(relative)
        if name.is_absolute() or ".." in name.parts or "\\" in relative:
            raise ValueError(f"Unsafe package path: {relative}")
        return self.archive.read(relative) if self.archive else (self.path / relative).read_bytes()

    def json(self, relative):
        return json.loads(self.read(relative))

    def close(self):
        if self.archive:
            self.archive.close()


def verify(path):
    package = ScanPackage(path)
    try:
        manifest = package.json("manifest.json")
        if manifest["schemaVersion"] != "roomcanvas.scan.v1":
            raise ValueError("Unknown manifest schema")
        if manifest["status"] != "complete":
            return {"status": manifest["status"], "complete": False, "files": len(package.names),
                    "note": "Partial scan retained; final scene is not guaranteed."}
        scene = package.json("scene.json")
        frames = package.json("cameras.json")
        # Apple's opaque Codable snapshots can fail independently of RoomBuilder.
        # A usable normalized scene may still complete with an explicit warning.
        for snapshot in ("roomplan.json", "roomplan.raw.json"):
            if snapshot in package.names:
                package.json(snapshot)
            else:
                assert any(snapshot in warning for warning in manifest.get("warnings", [])), f"Missing {snapshot} without diagnostic"
        assert scene["schemaVersion"] == "roomcanvas.scene.v1"
        assert scene["scanId"] == manifest["id"]
        assert scene["units"] == "meters" and scene["matrixLayout"] == "column-major"
        assert manifest["objectCount"] == len(scene["objects"])
        assert manifest["frameCount"] == len(frames)
        assert set(manifest["files"]) == package.names, "Manifest inventory does not match package files"

        def finite_vector(values, length):
            assert len(values) == length and all(isinstance(x, (int, float)) and math.isfinite(x) for x in values)

        index = {frame["id"]: frame for frame in frames}
        assert len(index) == len(frames), "Duplicate frame IDs"
        for frame in frames:
            finite_vector(frame["cameraToWorld"], 16)
            finite_vector(frame["intrinsics"], 9)
            finite_vector(frame["nativePixelToSavedPixel"], 9)
            assert frame["imageWidth"] > 0 and frame["imageHeight"] > 0
            assert package.read(frame["imagePath"]).startswith(b"\xff\xd8"), "Missing/invalid JPEG"
            camera_sidecar = package.json(f"frames/{frame['id']}.json")
            assert camera_sidecar == frame, "Camera sidecar differs from cameras.json"
            if frame.get("depth"):
                depth = frame["depth"]
                raw = package.read(depth["depthPath"])
                assert len(raw) == depth["width"] * depth["height"] * 4
                if depth.get("confidencePath"):
                    assert len(package.read(depth["confidencePath"])) == depth["width"] * depth["height"]
                # Float32 depth maps may contain invalid samples; NaN does not corrupt the binary format.
                if raw:
                    struct.unpack_from("<f", raw)
        object_ids = set()
        cropped = 0
        for item in scene["objects"]:
            assert item["id"] not in object_ids, "Duplicate furniture ID"
            object_ids.add(item["id"])
            finite_vector(item["objectToWorld"], 16)
            finite_vector(item["dimensions"], 3)
            assert all(size > 0 for size in item["dimensions"])
            package.json(item["rawMetadataPath"])
            assert package.json(f"objects/{item['id']}/metadata.json") == item
            if item["crops"]:
                cropped += 1
            for crop in item["crops"]:
                frame = index[crop["frameId"]]
                finite_vector(crop["rectanglePixels"], 4)
                x, y, width, height = crop["rectanglePixels"]
                assert x >= 0 and y >= 0 and width > 0 and height > 0
                assert x + width <= frame["imageWidth"] and y + height <= frame["imageHeight"]
                assert 0 <= crop["visibleFraction"] <= 1.00001
                assert crop["method"] == "projected-3d-obb"
                for key in ["imagePath", "overlayPath"]:
                    assert package.read(crop[key]).startswith(b"\xff\xd8")
            for photo in item["supplementalImages"]:
                assert photo["source"] == "user-selected-photo-no-camera-pose"
                assert package.read(photo["imagePath"]).startswith(b"\xff\xd8")
        for surface in scene["surfaces"]:
            finite_vector(surface["surfaceToWorld"], 16)
            finite_vector(surface["dimensions"], 3)
            for point in surface["polygonCorners"]:
                finite_vector(point, 3)
            package.json(surface["rawMetadataPath"])
        assert manifest["croppedObjectCount"] == cropped
        if package.archive:
            assert package.archive.testzip() is None, "ZIP CRC failure"
        return {"status": "complete", "complete": True, "objects": len(object_ids),
                "objectsWithCrops": cropped, "frames": len(frames), "files": len(package.names),
                "note": "File/association validation only; does not prove visual crop correctness."}
    finally:
        package.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/verify-export.py /path/to/scan.zip-or-folder")
    try:
        print(json.dumps(verify(sys.argv[1]), indent=2, ensure_ascii=False))
    except Exception as error:
        print(f"INVALID PACKAGE: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
