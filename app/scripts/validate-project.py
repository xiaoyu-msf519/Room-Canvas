"""Static validation only. This does not type-check Swift or build an iOS app."""
import json
import plistlib
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".tools"))
from openstep_parser import OpenStepDecoder
from tree_sitter import Language, Parser
import tree_sitter_swift


def validate():
    checks = []
    errors = []
    parser = Parser(Language(tree_sitter_swift.language()))
    sources = sorted((ROOT / "RoomCanvas").rglob("*.swift")) + sorted((ROOT / "RoomCanvasTests").rglob("*.swift"))

    def visit(node, file):
        if node.type == "ERROR" or node.is_missing:
            errors.append(f"{file.relative_to(ROOT)}:{node.start_point[0] + 1}: {node.type} {node.text.decode()[:180]}")
        for child in node.children:
            visit(child, file)

    for file in sources:
        visit(parser.parse(file.read_bytes()).root_node, file)
    checks.append(f"Parsed {len(sources)} Swift files with tree-sitter (syntax, not SDK type checking)")
    project_path = ROOT / "RoomCanvas.xcodeproj/project.pbxproj"
    project = OpenStepDecoder.ParseFromString(project_path.read_text(encoding="utf-8"))
    objects = project["objects"]
    references = re.findall(r"\b[A-F0-9]{24}\b", project_path.read_text(encoding="utf-8"))
    missing = set(references) - set(objects)
    if missing:
        errors.append(f"Unresolved Xcode references: {missing}")
    source_refs = {entry["path"] for entry in objects.values() if entry.get("isa") == "PBXFileReference" and entry.get("path", "").endswith(".swift")}
    expected = {file.relative_to(ROOT).as_posix() for file in sources}
    if source_refs != expected:
        errors.append(f"Xcode Swift file references mismatch: {source_refs ^ expected}")
    for entry in objects.values():
        if entry.get("isa") == "PBXFileReference" and entry.get("sourceTree") == "SOURCE_ROOT":
            if not (ROOT / entry["path"]).exists():
                errors.append(f"Missing Xcode input: {entry['path']}")
    build_paths = set()
    for entry in objects.values():
        if entry.get("isa") == "PBXSourcesBuildPhase":
            for build_id in entry["files"]:
                build_paths.add(objects[objects[build_id]["fileRef"]]["path"])
    if build_paths != expected:
        errors.append("Sources are not all registered in Xcode build phases")
    checks.append(f"Parsed Xcode project: {len(objects)} objects, all source files and references resolved")
    for relative in ["RoomCanvas/Info.plist", "RoomCanvas/PrivacyInfo.xcprivacy"]:
        with (ROOT / relative).open("rb") as file:
            plistlib.load(file)
    checks.append("Parsed Info.plist and Apple privacy manifest")
    scheme = ElementTree.parse(ROOT / "RoomCanvas.xcodeproj/xcshareddata/xcschemes/RoomCanvas.xcscheme")
    for reference in scheme.findall(".//BuildableReference"):
        if reference.attrib["BlueprintIdentifier"] not in objects:
            errors.append("Scheme references a missing target")
    checks.append("Parsed shared scheme and test target registration")
    for file in (ROOT / "RoomCanvas/Assets.xcassets").rglob("Contents.json"):
        contents = json.loads(file.read_text(encoding="utf-8"))
        for image in contents.get("images", []):
            if "filename" in image and not (file.parent / image["filename"]).is_file():
                errors.append(f"Missing asset: {image['filename']}")
    checks.append("Asset catalogs and app icon references resolved")
    app_text = "\n".join(file.read_text(encoding="utf-8") for file in sources if "RoomCanvasTests" not in str(file))
    for unwanted in ["URLSession", "http://", "https://", "WKWebView"]:
        if unwanted in app_text:
            errors.append(f"Unexpected network/web dependency in native offline app: {unwanted}")
    checks.append("No HTTP clients or embedded website in app source")
    report = {"kind": "static-validation", "checks": checks, "errors": errors,
              "limitations": ["No Swift SDK type checking", "No Xcode build", "No XCTest execution", "No LiDAR device run"]}
    output = ROOT / "verification/local-report.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(validate())
