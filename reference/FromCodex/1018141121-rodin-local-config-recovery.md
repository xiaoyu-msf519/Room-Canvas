# Rodin 配置恢复

## 原因

后端此前由裸 `uvicorn` 进程启动，进程环境中没有 `RODIN_API_KEY`。任务在提交到 Rodin 前就抛出“后端未配置 RODIN_API_KEY”，因此没有产生 Rodin 任务或扣费。

## 修复

- `src/backend/app/main.py` 现在启动时读取被忽略的 `src/backend/.env`，但不会覆盖显式进程环境变量。
- 本地配置仅包含 Rodin 运行参数，不进入源码、前端、日志、交付报告或 Git。
- `RODIN_TEXTURE_MODE=high` 保持模型和纹理一体生成，TLS 校验保持开启。

## 验证

- `GET http://127.0.0.1:8000/api/health` 返回 `{"status":"ok","rodin":"configured"}`。
- 修复后实际任务 `3300dedfec6441cca084b6cdfb320280` 已成功完成：Rodin 生成、下载、毫米尺寸缩放和编辑低模均完成。
- 当前服务：Web `http://127.0.0.1:5173/`，备用开发端口 `http://127.0.0.1:5174/`，后端 `http://127.0.0.1:8000/`。

