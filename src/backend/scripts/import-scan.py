"""Import any App output folder through the same automatic API used by the Web."""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import time
import zipfile
import io
import shutil
import uuid

import httpx

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.scan_import import bundle_inventory, find_bundle
from app.scan_cache import CACHE_FOLDER, cache_resources
from app.scans import safe_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--wait", action="store_true", help="Wait for every furniture job to finish or require attention")
    parser.add_argument("--structure-only", action="store_true", help="Import without starting new image-to-3D tasks")
    args = parser.parse_args()
    bundle = find_bundle(args.folder.resolve())
    _, _, resources = bundle_inventory(bundle)
    resources += cache_resources(bundle)
    with httpx.Client(base_url=args.api, timeout=180) as client, ExitStack() as files:
        uploads = [("files", (relative, files.enter_context((bundle / relative).open("rb")), "application/octet-stream")) for relative in resources]
        response = client.post("/api/scans", params={"auto_reconstruct": not args.structure_only}, files=uploads)
        response.raise_for_status()
        scene = response.json()
        print(json.dumps({"scene": scene["id"], "scanId": scene["source"]["scanId"], "web": "http://127.0.0.1:5173/", "pipeline": scene.get("pipeline")}, ensure_ascii=True), flush=True)
        if not args.wait:
            return 0
        previous = None
        previous_completed = -1
        deadline = time.monotonic() + 90 * 60
        while time.monotonic() < deadline:
            scene = client.get(f"/api/scenes/{scene['id']}").raise_for_status().json()
            pipeline = scene.get("pipeline", {})
            summary = json.dumps(pipeline, ensure_ascii=True, sort_keys=True)
            if summary != previous:
                print(summary, flush=True)
                previous = summary
            if pipeline.get('completed', 0) != previous_completed or pipeline.get('status') in ('ready', 'needs_attention', 'idle'):
                response = client.get(f"/api/scenes/{scene['id']}/cache").raise_for_status()
                with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                    for info in archive.infolist():
                        if info.is_dir():
                            continue
                        if not info.filename.startswith(CACHE_FOLDER + '/'):
                            raise ValueError('Unexpected file in room cache')
                        target = safe_path(bundle, info.filename)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.writing')
                        with archive.open(info) as source, temporary.open('wb') as output:
                            shutil.copyfileobj(source, output)
                        temporary.replace(target)
                previous_completed = pipeline.get('completed', 0)
            if pipeline.get("status") in ("ready", "needs_attention", "idle"):
                return 0 if pipeline["status"] == "ready" else 2
            time.sleep(4)
        raise TimeoutError("Import continues on the backend; timed out waiting for completion")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, httpx.HTTPError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
