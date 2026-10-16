"""Synthetic protocol fixtures. These are not captures from an iPhone."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_export", ROOT / "scripts/verify-export.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ExportValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        self.frame = {
            "id": "frame_0001", "imagePath": "frames/frame_0001.jpg", "imageWidth": 1000, "imageHeight": 800,
            "cameraToWorld": self.identity, "intrinsics": [500, 0, 0, 0, 500, 0, 500, 400, 1],
            "nativePixelToSavedPixel": [1, 0, 0, 0, 1, 0, 0, 0, 1], "depth": None,
        }
        self.object = {
            "id": "chair-1", "dimensions": [1, 1, 1], "objectToWorld": self.identity,
            "rawMetadataPath": "objects/chair-1/roomplan-object.json", "supplementalImages": [],
            "crops": [{"frameId": "frame_0001", "imagePath": "objects/chair-1/crop_1.jpg",
                       "overlayPath": "objects/chair-1/context_1.jpg", "rectanglePixels": [100, 100, 200, 200],
                       "visibleFraction": 1.0, "method": "projected-3d-obb"}],
        }
        self.scene = {"schemaVersion": "roomcanvas.scene.v1", "scanId": "scan-1", "units": "meters",
                      "matrixLayout": "column-major", "objects": [self.object], "surfaces": []}
        self.manifest = {"schemaVersion": "roomcanvas.scan.v1", "id": "scan-1", "status": "complete",
                         "objectCount": 1, "frameCount": 1, "croppedObjectCount": 1}
        self.write("scene.json", self.scene)
        self.write("cameras.json", [self.frame])
        self.write("frames/frame_0001.json", self.frame)
        self.write("objects/chair-1/metadata.json", self.object)
        for name in ["roomplan.json", "roomplan.raw.json", "objects/chair-1/roomplan-object.json"]:
            self.write(name, {})
        # Minimal markers intentionally test file linkage, not image decoding.
        for name in ["frames/frame_0001.jpg", "objects/chair-1/crop_1.jpg", "objects/chair-1/context_1.jpg"]:
            (self.root / name).write_bytes(b"\xff\xd8\xff\xd9")
        self.inventory()

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def inventory(self):
        self.manifest["files"] = sorted({p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()} | {"manifest.json"})
        self.write("manifest.json", self.manifest)

    def test_valid_folder_and_zip(self):
        self.assertTrue(validator.verify(self.root)["complete"])
        archive = self.root.parent / (self.root.name + ".zip")
        try:
            with zipfile.ZipFile(archive, "w") as output:
                for file in self.root.rglob("*"):
                    if file.is_file():
                        output.write(file, file.relative_to(self.root).as_posix())
            self.assertEqual(validator.verify(archive)["objectsWithCrops"], 1)
        finally:
            archive.unlink(missing_ok=True)

    def test_missing_crop_is_rejected(self):
        (self.root / "objects/chair-1/crop_1.jpg").unlink()
        self.inventory()
        with self.assertRaises(FileNotFoundError):
            validator.verify(self.root)

    def test_missing_pose_is_rejected(self):
        self.frame["cameraToWorld"] = []
        self.write("cameras.json", [self.frame])
        with self.assertRaises(AssertionError):
            validator.verify(self.root)

    def test_out_of_bounds_crop_is_rejected(self):
        self.object["crops"][0]["rectanglePixels"] = [950, 0, 200, 200]
        self.write("scene.json", self.scene)
        self.write("objects/chair-1/metadata.json", self.object)
        with self.assertRaises(AssertionError):
            validator.verify(self.root)

    def test_interrupted_scan_is_not_claimed_complete(self):
        self.manifest["status"] = "interrupted"
        self.write("manifest.json", self.manifest)
        self.assertFalse(validator.verify(self.root)["complete"])

    def test_missing_apple_snapshot_requires_explicit_diagnostic(self):
        (self.root / "roomplan.raw.json").unlink()
        self.inventory()
        with self.assertRaises(AssertionError):
            validator.verify(self.root)
        self.manifest["warnings"] = ["roomplan.raw.json JSON 编码失败，已保留有效 scene.json。"]
        self.inventory()
        self.assertTrue(validator.verify(self.root)["complete"])


if __name__ == "__main__":
    unittest.main()
