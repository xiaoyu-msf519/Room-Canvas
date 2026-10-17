# RoomCanvas 本地扫描协议 v1

## 自动发送到 Web

扫描完成并成功写入 complete 清单后，App 自动加入持久化发送队列。首次在 Web“连接 App”显示连接二维码，在 App“连接 Web”扫码或粘贴连接 JSON，保存并测试连接。上传令牌保存在 iOS Keychain，地址和发送队列保存在应用自有 UserDefaults，令牌不进入扫描文件。

采用 `roomcanvas.upload.v1` 协议：创建会话、每块最多 2 MiB 的 SHA-256 校验上传、确认偏移、提交完整 ZIP 校验、轮询发布结果。整体 ZIP 上限 2 GiB。状态 complete 表示接收端已验证并加入 Web 房间列表、启动自动处理，不表示 Rodin 模型此时已经全部完成。

同一扫描重发复用会话及内容身份，不重复建模。断网会自动重试；进入后台时暂停并保留确认偏移，重新进入 App 后自动恢复。配置更换后可使用新接收端。系统没有保证 App 长时间在后台连续执行网络任务，本实现不宣称无限后台上传。

Cloudflare 公网地址必须 HTTPS；普通 Web 编辑 API 不对公网隧道开放，隧道只连接上传网关。临时 Quick Tunnel 地址重启后可能变化，应更新 App 的连接信息。没有配置连接信息时，扫描仍正常保存在本地并排队等待，不要求重新扫描。

## 清单与状态

`manifest.json`：`schemaVersion=roomcanvas.scan.v1`，`id` 是扫描 UUID。`status` 为 capturing / processing / complete / interrupted / failed。只有 complete 表示最终场景处理完成；USDZ 等可选导出失败会记录在 warnings。

`files` 是相对扫描目录的文件清单。`objectCount` / `frameCount` / `croppedObjectCount` 分别统计最终家具、已保存关键帧、至少有一张自动裁剪的家具。补充照片不冒充自动裁剪，不增加 croppedObjectCount。

时间字段 `createdAt` 使用 ISO 8601；相机帧 `timestamp` 是 ARKit 会话的时间基准，不是 Unix 时间戳。

## 场景与矩阵

`scene.json`：`schemaVersion=roomcanvas.scene.v1`，`scanId` 对应 manifest.id；长度单位米，保持原始 ARKit 会话世界空间。右手坐标，Y 轴向上；未重新定位房间原点。

所有矩阵都按 **column-major** 展平。4×4 矩阵的平移在索引 12 / 13 / 14，3×3 内参的 fx / fy / cx / cy 在 0 / 4 / 6 / 7。

- `objectToWorld` 将家具局部坐标映射到世界坐标。
- `surfaceToWorld` 将结构面的局部坐标映射到世界坐标。
- `cameraToWorld` 将 ARKit 相机坐标映射到世界坐标。
- `dimensions` 为家具局部 X / Y / Z 方向尺寸；不是世界空间 AABB。
- `polygonCorners` 是结构面的局部平面坐标；曲线、类别关联等完整细节保留在原始 surface JSON。

`roomplan.json`、`roomplan.raw.json` 和每个对象 / 表面的原始 JSON 使用 Apple 的 Codable 表示，不应与规范化的 RoomCanvas 协议混淆。opaque 原始数据用于相容 Apple 环境下的重新处理，不保证可在 Web 直接解释。

Apple 的完整 `roomplan.json` 或 `roomplan.raw.json` 编码失败时，会在 warnings 中记录具体文件与字段，并继续尝试构建标准化场景。complete 保证 scene.json 和有效相机索引已写入，但不保证这两份 Apple 快照存在；原始快照缺失时不能通过原始数据重新整理。协议验证器要求缺失的快照有对应文件名的明确警告。

## 相机与图像

每帧保存原始分辨率、保存图像分辨率、K、cameraToWorld、trackingState、sharpness、可用光照估计、可选深度、是否手动请求。

JSON 中的矩阵和时间戳必须是有限数值；无效帧单独跳过，不将 NaN/Infinity 改成字符串或伪造零坐标。非有限 sharpness 记为 0，非有限可选 lightIntensity 省略。新扫描开始即写入空 cameras.json；索引缺失或损坏时可从有效逐帧 JSON 恢复，不能从 JPEG 推导丢失的位姿。损坏索引先备份，失败扫描也可导出已有文件，但不会因此变为 complete。

App 固定竖屏，原始相机图像旋转 90° 顺时针并缩小到最大边长 1920；JPEG 中已经实际完成旋转，查看方不应再重复套用 EXIF 旋转。

`nativePixelToSavedPixel` 是 3×3 仿射矩阵，**内参 K 仍对应原始相机图像**。从原始像素坐标 `(u,v,1)` 左乘该矩阵，得到已保存 JPEG 像素坐标。保存尺寸为 W_saved / H_saved，原始为 W_native / H_native 时：

```text
sx = W_saved / H_native
sy = H_saved / W_native
u_saved = sx * (H_native - v_native)
v_saved = sy * u_native
```

投影约定：家具角点先经 `inverse(cameraToWorld) * objectToWorld` 变到 ARKit 相机空间；ARKit 朝 -Z 看，因此转换为图像相机坐标 `(x, -y, -z)` 后再使用 K。对近裁面 z=0.05m 裁剪，不能把相机后方点直接除以 z。

`sharpness` 是采样亮度拉普拉斯绝对值平均数，仅作为排序启发式，不是标准图像质量评分。

### 墙地面涂装补拍

扫描页可选择常规、墙面或地板目标，RoomPlan 会话和世界坐标始终连续。常规保持原有采样；墙面/地板自动补拍要求定位正常、相机基本停稳且方向合适，保存成功后需要平移至少 0.15m 或转向至少 10° 才自动保存下一张。手动拍摄可绕过停稳与方向门槛，后端仍按真实相机与深度验证可见性。补拍仍受原有 300 帧和 5 分钟上限约束。

补拍帧增加可选 `materialTarget="wall" | "floor"`，表示拍摄意图，不表示已完成平面分割。常规帧省略该字段。Web 后端选帧时分别为墙面和地板补拍保留最多 16 帧，其余名额用于常规视角，总预算不超过 48 帧，防止低纹理涂装因清晰度分数低而全部被丢弃。

所有新帧还可包含 `photometry`：`exposureDurationSeconds` 来自 ARCamera.exposureDuration，单位秒；`exposureOffset` 来自 ARCamera.exposureOffset，是 ARKit 后处理曝光偏移，不是相机 ISO 或实测反照率；`ambientColorTemperatureKelvin` 是 ARLightEstimate 的环境色温估计，单位 Kelvin。非有限或无效可选值省略，旧扫描不含这些字段也能读取。当前后端仅在补拍帧分组内用曝光时长辅助选帧，没有按这些数值强制消除照片光照或白平衡，也没有锁定 RoomPlan 管理的相机曝光。

## 家具图关联

`objects/<object UUID>/metadata.json` 与 scene.objects 中对应对象的内容一致，包括类别、置信度、尺寸、变换、父 ID、原始参数路径、crops 和 supplementalImages。

每个 `CropRecord`：

- `frameId`：引用 cameras.json 的关键帧，可追溯到原始照片与相机参数。
- `imagePath`：裁剪 JPEG。
- `overlayPath`：源 JPEG 加绿色框。
- `rectanglePixels=[x,y,width,height]`：已保存 JPEG 中的像素范围，左上角原点，带约 6% 边距且裁到图像内。
- `visibleFraction`：包围框在图像内的面积比例，不含边距，不表示遮挡比例。
- `score`：候选排序启发式。
- `method=projected-3d-obb`，`reviewRequired=true`。

选择最多三个视角，后续候选相机位置与已选位置需相距至少 0.2m。该规则不能保证视角一定优于其他候选，仍需人工看图。

没有合适关键帧：`cropStatus=no-suitable-frame`、crops 为空，参数照常保存。有自动图：`cropStatus=needs-review`。

`supplementalImages` 是用户通过系统照片选择器手动添加的照片，`source=user-selected-photo-no-camera-pose`，没有伪造相机标定；与自动裁剪分开存储。

## 可选深度

depthMap 使用紧密排列的小端 Float32、单位米；逐行移除 CVPixelBuffer 的 padding。可能含无效值。confidenceMap 是紧密排列的 UInt8，0 / 1 / 2 对应低 / 中 / 高置信度。

深度保持原生相机方向，分辨率通常小于 RGB；使用时先把 K 缩放到深度分辨率，再按需要映射到保存 JPEG。当前裁剪算法没有用深度做遮挡判定。

未提供 depth 时字段缺省或为 nil，不能据此推断 LiDAR 不存在；App 不修改 RoomPlan 管理的 AR 会话配置以强制开启该数据。

## 完整性验证

`python3 scripts/verify-export.py <ZIP 或目录>` 检查清单、UUID 关联、相机矩阵、文件存在性、裁剪范围、深度字节数及 ZIP CRC。检查通过只说明文件与引用一致，不能替代真实图像的方向、框选和识别精度检查。
