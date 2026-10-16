# 家具移动与旋转联合控件

## 实现

- 改用项目已有 Drei PivotControls，同时显示红色 X 箭头、蓝色 Z 箭头和绿色 Y 轴水平旋转弧。禁用 Y 平移、平面滑块、缩放和其他轴旋转。
- 移除顶栏移动/旋转按钮、W/E 工具切换监听和不再使用的 transformMode 状态，选中家具即可直接使用三个手柄。
- 控件与家具采用同一矩阵姿态，旋转弧随家具实时转动，并在松手后保留最终朝向；箭头随家具的局部水平轴转动。
- 家具继续使用原来的稳定根节点，控件不重新挂载模型或反复计算视觉中心。移动/旋转提交仅保存 position 和 rotation。
- 拖动时使用 PivotControls 的指针捕获与 OrbitControls 互斥逻辑，持续约束底面水平、中心高度不变、尺寸不变。
- Edit 低模、拖放盒体预览、Play 高模策略保持可用。

## 验证

- `npm run build` 通过，TypeScript/Vite 零错误，保留现有主包体积提示。
- `npm run verify:rotation` 通过。新增开发依赖 `@react-three/test-renderer`，直接挂载实际 FurnitureGizmo/PivotControls，并调用库的真实 pointerDown/pointerMove/pointerUp 处理器。
- 检查三个手柄同时存在；16 次连续旋转中逐步核对绿色弧端点与家具角度同步；旋转后两根箭头各连续移动 4 次，验证新基准、中心、水平姿态、尺寸和松手稳定性。
- 前端 `http://127.0.0.1:5173/`、后端 `http://127.0.0.1:8000/api/health` 均返回 HTTP 200，现有后台服务继续运行。
- 内置浏览器实例列表为空，未完成真实页面截图/鼠标验收。以上测试为 R3F 组件事件回归，不代替浏览器视觉验收。
