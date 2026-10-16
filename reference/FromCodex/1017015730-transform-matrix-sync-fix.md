# 家具 Gizmo 释放后位置跳变修复

## 根因

TransformControls 拖动的是家具根 group，但该 group 同时通过 React 的 `position` / `rotation` props 受控。鼠标释放触发 Zustand 更新后，React 会用旧 props 重写 group；TransformControls 自己仍停在拖动后的矩阵，因此出现模型飞走、轴留在拖动位置。

## 修复

- 家具根 group 只在首次挂载时从 `FurnitureItem.position` 与 `rotation` 初始化。
- 后续拖动完全由 TransformControls 持有根 group 的实时矩阵，不再被 React props 覆盖。
- 鼠标释放时读取当前根 group 的 position、quaternion、scale，先归一化 group scale，再一次性写回 `furnitureList`。
- 模型视觉节点与 gizmo 使用同一根 group，确保释放后模型和轴保持一致。

## 验证

- `npm run build` 通过，TypeScript/Vite 零错误。
- 纹理 GLB 与后端服务保持可用；未引入新的外部依赖。
- 当前环境无可用浏览器实例，未完成真实鼠标截图验收。
