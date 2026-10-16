# 商品资产拖拽入场景与变换控件

## 本次修复

- 修复 demo 资产重复：Zustand 按资产 ID 去重，避免 React StrictMode 下初始化 effect 重复添加 `demo-sofa`。
- 移除“放入房间”按钮。成功生成的资产卡现在可直接拖拽到上方 3D 画布。
- 画布根据拖拽事件的屏幕坐标发射射线，与 `Y=0` 地面求交；释放时把家具中心放到该点，并将底面落在地面上。
- 拖拽过程中实时显示半透明青色 GLB 预览；没有模型时显示尺寸占位阴影。
- 新增 `FurnitureModels.tsx`：加载 GLB、按目标米制尺寸拟合包围盒、渲染已放置家具。
- 放置后点击家具可选中并显示 Three.js TransformControls：
  - 平移显示 X/Z 红蓝地面轴，Y 平移锁定，防止家具悬空。
  - 旋转默认锁定 Y 轴，适合家具水平转向；缩放保留三轴控制。
  - 变换完成后回写 `furnitureList`，Play Mode 的漫游碰撞也可继续使用该列表。

## 验证

- `npm run build`：通过，TypeScript/Vite 零错误。
- 前端入口：HTTP 200。
- `sofa-scaled.glb` 静态资源：HTTP 200，`model/gltf-binary`，16,933,724 bytes。
- 真实生成沙发的包围盒：`2.1 × 0.85 × 0.9 m`，对应输入 `2100 × 900 × 850 mm`。
