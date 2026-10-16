# TransformControls 连续拖动基准修复

## 现象

连续多次沿同一红色或蓝色轴拖动时，第二次拖动可能以旧的内部起始矩阵计算，模型跳到对称位置，而 gizmo 保留在新的位置。

## 修复

- 释放鼠标时先把当前 group 的矩阵同步到 world matrix。
- 将当前 position、quaternion、scale 写入家具状态。
- 下一帧对 TransformControls 执行 `detach → attach(currentGroup) → update()`，清除旧的 `worldPositionStart` / `positionStart` 基准。
- 相机环绕仍使用 `space="world"`，红蓝轴在屏幕上的方向会随相机投影变化，但世界坐标中的 X/Z 方向保持固定。

## 验证

- `npm run build` 通过，TypeScript/Vite 零错误。
- 当前环境无可用浏览器实例，未完成真实鼠标连续拖动截图验收。
