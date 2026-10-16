# 三层家具渲染性能优化

## 实现

### Edit Mode 低模

使用 glTF Transform + meshoptimizer 将沙发高模从约 500,000 三角面简化到约 90,000 三角面，并将 2K PNG 纹理压到 1K WebP。低模仍保留 base color、normal 和 metallic-roughness 材质，文件从 24.28MB 降到 4.31MB。

低模资产：`src/frontend/public/demo/sofa-edit-low.glb`。

Edit Mode 优先使用 `editModelUrl`；对于后续尚未生成低模的资产，使用轻量线框盒体代理，保证编辑操作不会加载高模。

### 拖拽预览代理

拖动资产到场景时不再绘制完整 GLB，改为尺寸盒体和地面预览。释放后才加入家具列表，避免拖动过程中加载/绘制高面数模型。

### Play Mode 高模

Play Mode 使用 `modelUrl` 高模，并恢复更高 DPR、实时阴影和 2048 阴影贴图；Edit Mode 使用低 DPR、关闭实时阴影和 512 阴影贴图。模式切换仍使用同一个常驻 Canvas。

## 资产数据

`FurnitureItem` 与 `UploadedAsset` 新增 `editModelUrl`，高模和编辑低模通过同一个家具对象关联。Play Mode 切换回高模时保持位置、旋转、尺寸和材质一致。

## 验证

- `npm run build`：通过，TypeScript/Vite 零错误。
- 低模 GLB：约 90,000 三角面、3 张 WebP 纹理、约 4.31MB。
- 高模 GLB：约 500,000 三角面、3 张纹理、约 24.28MB。
- 低模和高模包围盒一致，均对应 `2.1 × 0.85 × 0.9m`。
