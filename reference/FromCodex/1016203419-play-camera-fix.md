# Play Mode 相机与移动修复

## 问题

- 鼠标移动后镜头不会立即转动，必须下一次按方向键才生效。
- WASD 的前进方向与相机朝向不一致。

## 修复

修改 `src/frontend/src/scene/CameraControllers.tsx`：

- 将相机 yaw/pitch 写回从移动逻辑中拆出，每个 Play Mode 渲染帧都应用旋转，因此站立时鼠标环视立即生效。
- 按 Three.js 相机朝向为局部 `-Z` 的约定重新计算方向基向量：W/↑ 前进、S/↓ 后退、A/← 左移、D/→ 右移，始终相对当前 yaw。
- Play Mode 下阻止 WASD、方向键和 Shift 的浏览器默认行为，避免页面滚动干扰漫游。
- 保留原有 `Y = 1.65m` 和 `[-9.7m, 9.7m]` 水平边界。

## 验证

- `npm run build` 通过：TypeScript 与 Vite 编译零错误。
- 当前没有可用的内置浏览器实例，未完成截图级交互验证；开发服务器仍可通过 `http://127.0.0.1:5173/` 访问。
