# Pointer Lock 视角稳定性修复

## 问题判断

连续转向时的跳变不来自 Three.js 在 `pi` 边界的四元数计算：本地数学检查显示相邻 yaw 的四元数连续。更可能的触发点是 Pointer Lock 在建立、丢失或浏览器产生异常大 `movementX` 时，把单个异常增量直接写入相机。

## 修复

- 鼠标事件只将相对位移写入缓冲区，由 R3F 每帧按上限消费，避免单个事件改变过大的视角。
- Pointer Lock 建立后的 80ms 忽略合成首帧，清空旧增量。
- 对 `movementX` / `movementY` 做有限值、单事件和总缓冲上限保护。
- yaw 每帧归一化到 `[-pi, pi]`，相机继续通过 `YXZ` Euler 转 Quaternion 更新。
- 按 Esc 的主动解锁才退出 Play Mode；浏览器意外丢失锁定时保留 Play Mode 和当前相机方向，点击画布可以重新锁定，避免回退 OrbitControls 造成跳变。

## 验证

- `npm run build` 通过，TypeScript 与 Vite 编译零错误。
- `http://127.0.0.1:5173/` 返回 HTTP 200。
- 当前没有可用的内置浏览器实例，无法完成真实鼠标连续转向截图验收。
