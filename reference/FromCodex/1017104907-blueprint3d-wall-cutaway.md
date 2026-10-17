# 基于公开 Blueprint3D 方案的墙体遮挡修复

## 公开资料与实际核对

使用 Tavily 搜索并核对以下公开源码和讨论：

- Blueprint3D 原始实现 `Edge.updateVisibility`：https://github.com/furnishup/blueprint3d/blob/master/src/three/edge.ts
- Blueprint3D Modern 对应实现：`src/three/edge.ts` 中同样使用室内法线与墙中心到相机方向的点积：https://github.com/charmlinn/blueprint3d-modern/blob/main/src/three/edge.ts
- Three.js 官方论坛讨论厚墙的单侧显示与淡化：https://discourse.threejs.org/t/is-it-possible-to-make-a-3d-wall-visible-only-from-one-side-in-three-js/57521
- 官方论坛记录了平行墙同时消失的错误，关键在于相对墙必须有正确的内外朝向：https://discourse.threejs.org/t/interior-design-wall-visibility/67140

本次采用 Blueprint3D 的 camera-side 点积判定思路，在现有 R3F 工程中实现，没有引入旧项目的完整引擎或复制其文件。

## 原问题

上一版无限正向射线只要经过室内就淡化，会使近墙、远墙甚至室内相机看到的所有墙同时半透明。旧测试也把该行为当作期望，因此通过测试并不代表解决了实际遮挡需求。本次以用户反馈为准，明确更正为：只淡化从外侧遮挡室内的墙，远墙与室内视角的墙保持实心。此规则替代上一份 ray-wall-transparency 报告。

## 应用方式

- 用墙的局部 Z 轴经 quaternion 转换得到世界法线，并根据真实地板三角形在墙两侧的覆盖情况，校正法线为指向室内，避免依赖 ARKit 法线天然一致或凹形房间中心位于室内的假设。
- 在相机外侧半空间的墙淡化到 18% 不透明度；相机位于墙的室内一侧，墙保持不透明。接近墙面时按距离平滑过渡。
- Edit 相机投影位于室内时，墙全部实心。Play 始终全实心。
- 移除自定义逐片元射线着色器和双通道重叠墙，改为每块墙一个标准 MeshStandardMaterial。淡化墙关闭深度写入，实心墙恢复深度写入。
- 每帧只更新墙面点积和材质参数；相同扫描几何的状态轮询复用材质，不重建。

## 验证

- `npm run verify:walls`：直接挂载实际 ScannedRoom，验证相机换边后近墙和远墙互换淡化状态，以及 Play 全实心。覆盖原始相对墙法线相同、凹形地板、室内相机、深度写入和材质复用。
- 真实 ScanDemoResult 的 30 块墙板，从四个外部相机位置验证：`[8,7,8]` 为 18 淡化 / 12 实心；`[-8,7,8]` 为 12 / 18；`[-8,7,-8]` 为 12 / 18；`[8,7,-8]` 为 18 / 12。没有任何一个位置全墙透明。
- `npm run verify:scan`：30 块墙板、地板、碰撞与家具结果同步检查通过。
- `npm run build`：编译通过，保留现有主包体积提示。
- 前端和后端代理健康检查 HTTP 200，后台服务继续运行：`http://127.0.0.1:5173/`。
- 内置浏览器可用列表为空，未完成真实 GPU 页面截图；测试验证实际组件的材质状态，不声称完成视觉验收。
