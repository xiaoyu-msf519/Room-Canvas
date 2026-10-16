# RoomCanvas Scanner

原生 iOS / iPadOS 离线扫描 App。最低系统版本 17.0，扫描需要受支持的 LiDAR 真机。无后端、无账号、无网络上传、无第三方运行时依赖。

**交付状态：完整 Xcode 源码工程；当前 Windows 主机完成了静态检查，尚未完成 Apple SDK 编译、签名或真机扫描。这里没有预先签名的 IPA。** 不应把此状态描述为“已验证可直接安装”。

## 在 Mac 上安装到手机

1. 把整个 `APP` 目录（或交付 ZIP 解压后的目录）放到 Mac，打开 `RoomCanvas.xcodeproj`。工程已生成，不需要安装 Node、CocoaPods 或额外 Swift Package。
2. 使用 Xcode 16 或更新的兼容版本。在 RoomCanvas target 的 **Signing & Capabilities** 中选择你们的 Team；将 Bundle Identifier 改为团队可用的唯一值，保持 Automatically manage signing。
3. 连接带 LiDAR、运行 iOS / iPadOS 17+ 的设备，按系统要求完成信任和 Developer Mode 设置。在 Xcode 顶部选择该设备，点击 Run。
4. 首次进入扫描页允许相机权限。完成一份短扫描，再按 `docs/DEVICE_ACCEPTANCE.md` 验证图片、坐标与导出。

详细说明：[INSTALL-ON-MAC.md](INSTALL-ON-MAC.md)。签名使用你们自己的 Apple 开发身份；项目中没有写入任何账号或证书。

## 已实现的功能

- RoomPlan 官方扫描 UI；设备支持检查、相机授权、结束扫描和异常状态。
- 本地扫描列表、重命名、删除前确认、失败与中断文件保留。
- 最终 `CapturedRoom` JSON、可编码原始 `CapturedRoomData`、逐秒房间快照。
- 带相机位姿、内参、图像变换与时间戳的 RGB 关键帧。
- 每约 0.8 秒记录一帧，可手动追加；最多 300 帧，最长扫描 5 分钟。
- 底层会话提供 `sceneDepth` 时保存 Float32 深度和可用的置信度图；不篡改 RoomPlan 的底层配置强制启用。
- 按最终家具 OBB 投影到关键帧，处理近裁面与画面裁切，按视野覆盖、大小、居中程度和图像边缘指标排序，最多保留三个具有位置差异的视角。
- 每件家具独立的原始参数、标准化参数、裁剪图和原图框选预览。
- 房间 USDZ / 参数化 USDZ 导出与模型 Quick Look 预览。
- 查看家具详情、相机帧和 JSON；为家具添加明确标注为“无相机位姿”的补充照片。
- 整份扫描 ZIP 导出，以及单张家具裁剪图分享。
- 原始扫描文件存在时，可从未完成的扫描重新整理。

## 裁剪的含义和边界

保存的是相机图像中的家具包围框裁剪，**不是截取带 UI 的手机屏幕**，也不是实例分割或完整家具三维重建。框内可能包含背景、其他家具或遮挡物。每份自动裁剪的 `reviewRequired` 为 `true`，界面标记待核对。

无法找到足够大、定位正常且投影框可见比例至少 65% 的照片时，不伪造成功图片；保留家具参数，并标记 `no-suitable-frame`。用户可添加补充照片，或重新扫描以获得更完整视角。可见比例表示包围框落在图像内的比例，**不表示实际无遮挡的比例**。

关键帧是受控采样，不是保存全部原始视频。最大边长 1920 像素，JPEG 质量 0.9；采样、缩放和上限写入 manifest。屏幕与相机图像统一采用固定竖屏流程；实际方向与投影叠加仍必须真机验收。

## 本地扫描文件

App 的“文件”共享目录：`RoomCanvas/Scans/<scan UUID>/`。

```text
manifest.json                 清单、采集策略、计数、状态与警告
roomplan.raw.json             Apple 可编码的原始中间数据（opaque）
roomplan.json                 最终 CapturedRoom 完整编码
scene.json                    RoomCanvas 标准化结构与家具
cameras.json                  所有已保存关键帧的相机记录
room-updates.jsonl            扫描过程快照，约每秒一次
room.usdz                     网格导出，成功时存在
room-parametric.usdz          参数化导出，成功时存在
frames/frame_0001.jpg          已旋转为竖屏的 JPEG
frames/frame_0001.json         与 cameras.json 中相同的单帧记录
depth/frame_0001.f32           可选紧密排列 Float32 深度
depth/frame_0001.confidence.u8 可选深度置信度
surfaces/<UUID>.json           每个结构面的完整原始编码
objects/<UUID>/metadata.json   家具参数和图片关联
objects/<UUID>/roomplan-object.json
objects/<UUID>/crop_1.jpg      家具裁剪
objects/<UUID>/context_1.jpg   原始关键帧加绿色包围框
objects/<UUID>/supplement_<UUID>.jpg
```

完整协议：[docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md)。数据与照片仅写入本机；用户主动点击分享 / 导出后由系统分享界面决定去向。删除 App 可能删除本地扫描，重要记录应先导出。

## 项目导航

```text
RoomCanvas/Models/       持久化和交换模型
RoomCanvas/Capture/      RoomPlan 生命周期、关键帧写入、扫描后处理
RoomCanvas/Geometry/     OBB 投影与裁剪范围计算
RoomCanvas/Storage/      JSON、扫描库、流式 ZIP32 写入
RoomCanvas/Views/        原生 SwiftUI 界面与 UIKit / Quick Look 桥接
RoomCanvasTests/         XCTest：几何投影、ZIP、序列化
scripts/                 Mac 构建、静态检查、导出检查、工程再生成
verification/            交付验证记录和协议验证器测试
```

## 验证命令

Mac 上先构建 iPhone SDK（不签名）：

```bash
bash scripts/verify-mac.sh
```

运行 XCTest 需要一个可用的 iOS 模拟器；测试不会在模拟器中进行真实 RoomPlan 扫描：

```bash
xcrun simctl list devices available
export ROOMCANVAS_SIMULATOR_ID="替换为模拟器 UDID"
bash scripts/verify-mac.sh --test
```

验证手机实际导出的扫描包，Python 3 标准库即可：

```bash
python3 scripts/verify-export.py /path/to/RoomCanvas-scan.zip
```

Windows 已运行的静态检查与协议验证器测试，以及未运行项目，见 [verification/RESULTS.md](verification/RESULTS.md)。它们不等于 Xcode 编译或真机验收。

仅在需要重复开发静态检查时，安装验证工具并执行（不是 App 运行依赖）：

```bash
python3 -m pip install -r scripts/requirements-validation.txt --target .tools
python3 scripts/validate-project.py
python3 -m unittest discover -s verification -p 'test_*.py' -v
```
