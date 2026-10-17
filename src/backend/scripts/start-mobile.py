"""Start the upload-only service and optional Cloudflare Quick Tunnel."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src/backend"))
from app.mobile_config import upload_token
from app.scans import write_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tunnel", action="store_true")
    parser.add_argument("--cloudflared", default="cloudflared")
    args = parser.parse_args()
    executable = shutil.which(args.cloudflared)
    if args.tunnel and not executable:
        raise SystemExit("cloudflared not found; supply --cloudflared PATH")
    upload_token(ROOT)
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    children = []
    try:
        gateway = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.upload_gateway:app", "--app-dir", str(ROOT / "src/backend"),
                                    "--host", "127.0.0.1" if args.tunnel else "0.0.0.0", "--port", "8001"], cwd=ROOT, creationflags=flags)
        children.append(gateway)
        print("RoomCanvas upload gateway: port 8001; editor API remains separate", flush=True)
        if args.tunnel:
            tunnel = subprocess.Popen([executable, "tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:8001", "--no-autoupdate"],
                                      cwd=ROOT, creationflags=flags, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            children.append(tunnel)
            def output():
                for line in tunnel.stdout:
                    match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                    if match:
                        write_json(ROOT / "tmp/mobile-upload/endpoint.json", {"endpoint": match.group(0)})
                    print(line.rstrip(), flush=True)
            threading.Thread(target=output, daemon=True).start()
        while all(process.poll() is None for process in children):
            time.sleep(1)
        raise RuntimeError("Upload gateway or tunnel exited")
    except KeyboardInterrupt:
        pass
    finally:
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
        for process in children:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
        if args.tunnel:
            write_json(ROOT / "tmp/mobile-upload/endpoint.json", {"endpoint": ""})


if __name__ == "__main__":
    main()
