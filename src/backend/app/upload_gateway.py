"""Isolated, authenticated, resumable upload endpoint. Run a single worker."""
from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .mobile_config import upload_token
from .mobile_ingest import MAX_SCAN_BYTES, publish_zip
from .scans import read_json, write_json

CHUNK_BYTES = 2 * 1024**2


class UploadSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scanId: uuid.UUID
    size: int = Field(gt=0, le=MAX_SCAN_BYTES)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class UploadStore:
    def __init__(self, root: Path):
        self.root = root
        self.sessions = root / "tmp/transfers"
        self.sessions.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def directory(self, upload_id: str) -> Path:
        try:
            if uuid.UUID(upload_id).hex != upload_id:
                raise ValueError()
        except ValueError as error:
            raise HTTPException(404, "上传会话不存在") from error
        return self.sessions / upload_id

    def load(self, upload_id: str) -> dict:
        path = self.directory(upload_id) / "state.json"
        if not path.is_file():
            raise HTTPException(404, "上传会话不存在")
        state = read_json(path)
        receipt = self.root / "tmp/mobile-inbox" / f"{upload_id}.json"
        if state.get("published") and receipt.is_file():
            event = read_json(receipt)
            if event["status"] in ("complete", "failed"):
                changed = state["status"] != event["status"]
                state.update(status=event["status"], sceneId=event.get("sceneId"), error=event.get("error"))
                if changed:
                    state["updatedAt"] = time.time()
                    self.save(state)
        return state

    def save(self, state: dict) -> dict:
        write_json(self.directory(state["id"]) / "state.json", state)
        return state

    def recover(self) -> None:
        for path in self.sessions.glob("*/state.json"):
            state = read_json(path)
            if state["status"] == "processing" and not state.get("published"):
                state["status"] = "uploading"
                self.save(state)

    def create(self, spec: UploadSpec) -> dict:
        with self.lock:
            upload_id = uuid.uuid5(uuid.NAMESPACE_URL, f"roomcanvas:{spec.scanId}:{spec.sha256}").hex
            path = self.directory(upload_id)
            if (path / "state.json").is_file():
                state = self.load(upload_id)
                if state["size"] != spec.size:
                    raise HTTPException(409, "相同摘要的文件长度不一致")
                if state["status"] == "failed" and not state.get("published"):
                    (path / "scan.zip.part").unlink(missing_ok=True)
                    state.update(status="uploading", offset=0, error=None)
                state["updatedAt"] = time.time()
                return self.save(state)
            reserved = 0
            for file in self.sessions.glob("*/state.json"):
                state = read_json(file)
                if state["status"] != "processing" and time.time() - state["updatedAt"] > 7 * 86400:
                    shutil.rmtree(file.parent)
                elif state["status"] in ("uploading", "processing"):
                    reserved += state["size"]
            if reserved + spec.size > 8 * 1024**3 or shutil.disk_usage(self.root).free < spec.size * 3 + 128 * 1024**2:
                raise HTTPException(507, "接收端空间不足")
            path.mkdir(exist_ok=True)
            return self.save({"id": upload_id, "scanId": str(spec.scanId), "size": spec.size, "sha256": spec.sha256,
                              "offset": 0, "chunkSize": CHUNK_BYTES, "status": "uploading", "updatedAt": time.time(), "sceneId": None, "error": None})

    def append(self, upload_id: str, offset: int, data: bytes, digest: str) -> dict:
        with self.lock:
            state = self.load(upload_id)
            if state["status"] != "uploading" or state["offset"] != offset:
                raise HTTPException(409, "上传位置已变化，请读取状态后续传")
            if not data or len(data) > CHUNK_BYTES or offset + len(data) > state["size"]:
                raise HTTPException(413, "分块大小不正确")
            if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), digest):
                raise HTTPException(422, "分块校验失败")
            archive = self.directory(upload_id) / "scan.zip.part"
            with archive.open("r+b" if archive.exists() else "w+b") as output:
                if output.seek(0, 2) < offset:
                    raise HTTPException(409, "接收文件不完整")
                output.truncate(offset)
                output.seek(offset)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            state.update(offset=offset + len(data), updatedAt=time.time())
            return self.save(state)

    def begin_commit(self, upload_id: str) -> tuple[dict, bool]:
        with self.lock:
            state = self.load(upload_id)
            if state["status"] in ("complete", "processing"):
                return state, False
            if state["status"] == "failed":
                raise HTTPException(422, state.get("error") or "上传处理失败")
            if state["offset"] != state["size"]:
                raise HTTPException(409, "扫描包尚未上传完整")
            state.update(status="processing", updatedAt=time.time())
            return self.save(state), True

    def commit(self, upload_id: str) -> None:
        try:
            state = self.load(upload_id)
            archive = self.directory(upload_id) / "scan.zip.part"
            digest = hashlib.sha256()
            with archive.open("rb") as source:
                while chunk := source.read(CHUNK_BYTES):
                    digest.update(chunk)
            if archive.stat().st_size != state["size"] or digest.hexdigest() != state["sha256"]:
                raise ValueError("完整扫描包校验失败")
            publish_zip(archive, self.root, upload_id, state["scanId"])
            with self.lock:
                state.update(published=True, updatedAt=time.time())
                self.save(state)
            archive.unlink(missing_ok=True)
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            with self.lock:
                state = self.load(upload_id)
                state.update(status="failed", error=f"扫描包处理失败: {str(error)[:250]}", updatedAt=time.time())
                self.save(state)


def create_app(root: Path, token: str | None = None) -> FastAPI:
    store = UploadStore(root)
    secret = token if token is not None else upload_token(root)
    @asynccontextmanager
    async def lifespan(_):
        store.recover()
        yield
    api = FastAPI(title="RoomCanvas Upload", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    api.state.store = store

    @api.middleware("http")
    async def authorize(request: Request, call_next):
        if len(secret) < 32:
            return JSONResponse({"detail": "上传网关未配置"}, 503)
        if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + secret):
            return JSONResponse({"detail": "上传令牌不正确"}, 401)
        if request.method == "POST":
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                length = -1
            if not 0 <= length <= 4096:
                return JSONResponse({"detail": "控制请求过大"}, 413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.get("/api/mobile/health")
    def health():
        return {"status": "ok", "protocol": "roomcanvas.upload.v1", "chunkSize": CHUNK_BYTES, "maxSize": MAX_SCAN_BYTES}

    @api.post("/api/mobile/uploads", status_code=201)
    async def create(request: Request):
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 4096:
                raise HTTPException(413, "控制请求过大")
            data.extend(chunk)
        try:
            spec = UploadSpec.model_validate_json(bytes(data))
        except ValidationError as error:
            raise HTTPException(422, "上传参数不正确") from error
        return await run_in_threadpool(store.create, spec)

    @api.get("/api/mobile/uploads/{upload_id}")
    def status(upload_id: str):
        with store.lock:
            return store.load(upload_id)

    @api.put("/api/mobile/uploads/{upload_id}")
    async def append(upload_id: str, request: Request):
        try:
            offset = int(request.headers.get("upload-offset", "-1"))
        except ValueError as error:
            raise HTTPException(422, "上传偏移无效") from error
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > CHUNK_BYTES:
                raise HTTPException(413, "单个分块不能超过 2 MiB")
            data.extend(chunk)
        return await run_in_threadpool(store.append, upload_id, offset, bytes(data), request.headers.get("x-chunk-sha256", ""))

    @api.post("/api/mobile/uploads/{upload_id}/complete", status_code=202)
    def complete(upload_id: str, tasks: BackgroundTasks):
        state, launch = store.begin_commit(upload_id)
        if launch:
            tasks.add_task(store.commit, upload_id)
        return state
    return api


app = create_app(Path(__file__).resolve().parents[3])
