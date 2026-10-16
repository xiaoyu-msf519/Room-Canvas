# Gizmo 与家具视觉中心错位修复

## 根因

Rodin 输出的 GLB 自带 `RoomCanvasRealScale` wrapper node，包含真实尺度的 translation/scale。此前直接对带内部变换的 clone 调用包围盒计算，再把结果按外层 scale 处理，模型视觉中心和 TransformControls 根 group 原点不在同一坐标空间。

因此表现为：第一次拖动后红蓝轴与模型分离，之后旋转或移动会绕 gizmo 交汇点做偏心运动。

## 修复

- 把 GLB clone 放入 identity `Group` 后再计算完整世界包围盒。
- 外层只负责目标尺寸缩放，内层用 `-bounds.center` 偏移模型。
- 使家具视觉包围盒中心严格落在 TransformControls 根 group 原点。
- 保留之前的释放后 detach/attach 基准重置，确保连续拖动从当前矩阵开始。

## 验证

- `npm run build` 通过，TypeScript/Vite 零错误。
- 生成模型纹理保留逻辑不变，demo GLB 仍包含 `images=3 / textures=3`。
- 当前环境无可用浏览器实例，未完成真实鼠标拖动截图验收。
