# Play Mode 连续视角修复

## 修复内容

- `PlayCameraController` 改用 `Euler(YXZ) -> Quaternion` 写回相机方向，避免连续转动跨越 `pi` 边界时出现视角表示跳变。
- 对 Pointer Lock 的 `movementX` / `movementY` 做有限值检查与单事件上限保护，防止浏览器偶发的异常大增量造成镜头瞬移。
- 保留原有连续鼠标环视、WASD 相对视线移动、俯仰角限制和场景边界限制。

## 验证

- `npm run build` 通过，TypeScript 与 Vite 编译零错误。
- 当前环境没有可用的内置浏览器实例，因此未完成截图级连续转向验证；本地开发服务器地址仍为 `http://127.0.0.1:5173/`。
