# 家具拖拽、变换控件与纹理 GLB 修复

## 交互修复

- 拖拽预览不再在 `dragover` 高频事件与 `dragleave` 之间反复清空；预览点按 1cm 阈值更新，避免模型闪烁。
- 删除资产卡上的“拖动到上方场景放置”文字，保留完成状态。
- TransformControls 改为直接绑定稳定的家具 group ref，并在 `mouseUp` 时提交变换，避免每个 change 事件立即重置受控对象。
- OrbitControls 设置为默认控制器，TransformControls 拖动时自动禁用 OrbitControls，解决轴拖动被环绕相机抢占的问题。
- 平移只显示 X/Z 地面轴并锁定 Y；旋转锁定 Y 轴；缩放支持三轴。缩放提交后会归一化 group scale，避免重复缩放。

## 纹理方案

Rodin 请求现在显式发送：

```text
tier=Gen-2.5-Medium
mesh_mode=Raw
quality=medium
geometry_file_format=glb
texture_mode=high
```

API 文档说明 `texture_mode` 控制纹理细节，Gen-2.5-Medium 默认是 `medium`；当前默认提升为 `high`，同时强制 GLB 输出。后续如需更高纹理分辨率，可通过 `RODIN_TEXTURE_MODE` 环境变量调整，并按 API 文档评估 `HighPack` / `uhd_texture` 的体积和额度成本。

## 关键修复

第二次真实 Rodin 任务的原始 GLB 已验证包含 `images=3 / textures=3`。此前使用 `trimesh` 重新导出时会丢弃这些嵌入纹理。现在真实尺度处理只修改 GLB JSON 中新增的 wrapper node 变换，保留原始 JSON、BIN 和纹理 chunk。修正后的 demo GLB 仍包含 `images=3 / textures=3`，包围盒为 `2.1 × 0.85 × 0.9 m`。

## 验证

- `npm run build`：通过，TypeScript/Vite 零错误。
- `python -m py_compile src/backend/app/main.py`：通过。
- 纹理 GLB JSON：`images=3`、`textures=3`。
- 后端已重启，后续任务使用保纹理缩放逻辑。
