# 商品图到真实尺度 GLB 链路

## 已接通

本阶段把 Asset Drawer 从本地预览占位改成三段式任务链：

1. **上传图片**：文件选择、拖拽和剪贴板图片都会生成本地商品资产；沙发示例已复制到 `src/frontend/public/demo/sofa.png` 并自动出现在资产区。
2. **输入尺寸并调用 Rodin**：每张资产卡要求输入宽度、深度、高度，单位为 mm。前端将图片和尺寸通过 `/api/generations` 发送到 FastAPI，密钥只在后端环境变量 `RODIN_API_KEY` 中读取。
3. **真实尺度缩放**：后端轮询 Rodin 的 subscription key，下载顶层 task uuid 对应的 GLB/ZIP，计算模型包围盒，并按 `宽度 / 高度 / 深度` 目标值缩放到米制 GLB，最终以 `/api/assets/{job_id}.glb` 提供给前端。

任务期间资产卡片显示深色加载遮罩和 `RODIN` / `SCALE` 状态；完成后显示 `已完成 · 真实尺度`，失败显示错误信息和重试按钮。淘宝商品链接输入已改为禁用的预留入口，拖拽或粘贴链接也会提示暂未开放。

## 后端文件

- `src/backend/app/main.py`：FastAPI 上传、任务状态、Rodin 提交/轮询/下载、GLB 缩放和静态模型路由。
- `src/backend/requirements.txt`：FastAPI、httpx、python-multipart、trimesh、uvicorn。
- `src/backend/.env.example`：仅包含 `RODIN_API_KEY` 占位值，不含实际密钥。
- Vite 开发服务器已配置 `/api` 代理到 `http://127.0.0.1:8000`。

启动命令：

```powershell
$env:RODIN_API_KEY = '你的 Rodin key'
& env/backend/Scripts/python.exe -m uvicorn app.main:app --app-dir src/backend --host 127.0.0.1 --port 8000
cd src/frontend
npm run dev -- --host 127.0.0.1
```

Rodin key 不放进前端、源码、报告或 Git。实际运行时从 `reference/ToCodex/API.md` 的 Rodin 段落读取到进程环境变量，仅用于本次后端任务验证，未写入仓库。

## 本次验证

- `npm run build`：通过，TypeScript/Vite 零错误。
- FastAPI 导入和路由：通过，共 8 条路由。
- `GET http://127.0.0.1:8000/api/health`：代理启动时返回 `status=ok`，Rodin key 通过环境变量提供。
- `GET http://127.0.0.1:5173/api/health`：Vite 代理正常转发。
- 使用 `reference/ToCodex/sofa.png`、`2100 × 900 × 850 mm` 实际提交：Rodin 任务受理、轮询完成、GLB 下载和缩放全部成功，最终任务状态为 `succeeded`。
- 生成模型 `/api/assets/2ea425ca21074c22a1f2ed278ad8a82d.glb` 返回 HTTP 200，内容类型为 `model/gltf-binary`。
- 使用合成 GLB 验证缩放：目标输出包围盒为 `2.1 × 0.9 × 0.85 m`。

生成结果已复制到 `src/frontend/public/demo/sofa-scaled.glb`，页面启动时作为已完成的示例资产展示；其他上传图片仍按尺寸输入、Rodin 生成、真实尺度缩放三阶段运行。
