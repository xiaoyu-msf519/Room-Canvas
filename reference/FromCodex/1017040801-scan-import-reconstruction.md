# iOS 扫描包接入与原位家具重建

## 已识别的真实契约

输入目录：`reference/ToCodex/ScanDemoResult`。入口是 `manifest.json` 与 `scene.json`，不是 USDZ。前者为 `roomcanvas.scan.v1`，后者为 `roomcanvas.scene.v1`，使用 meters、ARKit 右手 Y-up、column-major 矩阵。

本样例有 9 面墙、3 个门洞、1 个不规则地板、7 件家具（2 桌、5 椅）和 118 个相机关键帧。家具的 `dimensions=[X,Y,Z]` 为完整框尺寸，`objectToWorld` 为中心位姿；墙/地板通过 `surfaceToWorld` 将局部 XY 平面映射到世界坐标，零 Z 厚度不能直接作为 BoxGeometry 厚度。

`objects/{id}/crop_*.jpg` 已经由 App 按最终 OBB 投影裁剪，`crops[]` 中包含评分、frameId、rectanglePixels、visibleFraction 和 reviewRequired。`context_*.jpg` 是框选上下文图，不能当作单件家具图上传。所有裁剪标记需要复核，可能包含邻近家具。本次使用评分最高的 crop，加类别提示生成目标家具。

相机内参对应 native RGB，已保存 JPG 经过 90 度旋转；`nativePixelToSavedPixel` 必须与内参联合使用。本阶段直接采用 App 已裁好的图，不重复错误投影。后端保留这些字段及统一平移后的 cameraToWorld。

## 坐标与建模

样例源地面中心为 `[-3.158719,-1.7297616,-1.6541933]`。统一世界平移量为 `[3.158719,1.7297616,1.6541933]`，同时作用于墙、地板、家具、相机；记录于 `source.worldOffset`，可逆转换回原 ARKit 空间。

- 墙采用 0.10m 厚素色板；匹配共面的门/窗/开口并切分矩形板，样例 9 面墙共生成 30 块板，3 个门口保持通透。
- 地板通过原始 polygonCorners 与 surfaceToWorld 生成 ShapeGeometry，不用包围矩形代替不规则地面。
- 墙板同步为 OBB 碰撞体；Play 使用地板三角形和家具/墙 OBB 检查出生点、水平移动。
- 家具先以原 OBB 显示；Rodin 完成后按 `[width,height,depth]` 缩放并使用原框 position/quaternion 放置。
- 原框以橙色线框保留，原框对比开关可控制显示；左侧扫描面板显示裁剪图和单件状态。
- Rodin 不保证语义朝向与 RoomPlan 局部前向一致，接口保留原框旋转，必要时可用既有绿色弧手工微调。

## API

| 接口 | 用途 |
| --- | --- |
| `POST /api/scans` | multipart `files`：一个 ZIP，或多个文件（filename 保留相对路径），返回统一 SceneManifest |
| `POST /api/scans/demo` | 导入本机 ScanDemoResult；重复调用复用同一个场景 |
| `GET /api/scenes/latest` | 最近导入的场景，Web 启动自动加载 |
| `GET /api/scenes/{id}` | 当前场景及各家具任务/模型结果 |
| `GET /api/scenes/{id}/files/{path}` | 受控读取裁剪图、关键帧图 |
| `POST /api/scenes/{id}/reconstruct` | 批量生成所有原家具；同一场景已有任务/成功结果不重复收费提交 |
| `POST /api/scenes/{id}/furniture/{furniture_id}/reconstruct` | 单件重建/失败重试 |
| `GET /api/jobs/{job_id}` | 独立任务查询，隐藏供应商任务凭据 |
| `GET /api/assets/{name}.glb` | 高模或编辑低模 GLB |

App 可用 URLSession multipart 上传 ZIP，例如 `files=@scan.zip`。ZIP 支持带顶层目录；拒绝路径穿越、超过 300MB 的上传/解压和过多归档项。上传只解析建模所需数据，深度图继续作为源资料保留。

## 重建与渲染

Rodin 后端两路并发，显式使用 Gen-2.5-Medium、Raw、GLB、high 纹理，提交/状态轮询/下载分离。任务状态写入 `tmp/jobs`，供应商任务标识仅保存在本地，服务重启后恢复查询。提交阶段中断但无法确认受理的任务不会自动再次收费提交。

下载后仅修改 GLB wrapper node 实现居中与真实尺度缩放，保持嵌入纹理。再使用 glTF Transform / meshoptimizer 简化为编辑低模，纹理限制 1K WebP。后续商品图也共享该低模处理步骤。高模/低模都完成后才标记成功，失败保留原框并提供重试。

Web 每 4 秒刷新任务信息，自动用生成结果替换原框。刷新只补模型结果，不覆盖当前家具编辑变换。Edit 始终使用低模，拖放使用盒体，Play 使用带纹理高模；常驻 Canvas 不重建。

## 必要验证

- `python src/backend/scripts/verify-scan-pipeline.py`：真实 7 个 OBB、118 个相机位姿、地面归一化、门洞、嵌套 ZIP 上传、裁剪图/帧图资源、路径穿越拒绝、任务去重。
- `npm run verify:scan`：挂载实际 ScannedRoom，验证 30 块墙板、多边形地面、出生点与碰撞，以及模型替换不撤销用户变换。
- `npm run verify:rotation`：既有联合移动/旋转控件回归。
- `npm run build`：TypeScript/Vite 编译。
- 样例扫描数据和生成模型均留在 reference 输入及 tmp 缓存，不提交原始关键帧或下载缓存。
- 已真实完成全部 7 件家具：高模各 500,000 三角面、3 张内嵌纹理；低模各约 60,000 三角面、3 张 WebP 纹理。高模包围盒与扫描框一致，低模误差小于 1mm，前端仍按目标框精确拟合。
- 内置浏览器无可用实例，无法做真实页面截图验收；组件回归不等同于浏览器视觉验证。

运行依赖：Python 环境位于 env/backend；首次安装需 `pip install -r src/backend/requirements.txt`、`npm install --prefix src/backend` 和 `npm install --prefix src/frontend`。前端 `http://127.0.0.1:5173/`，后端 `/api/health` 可检查。
