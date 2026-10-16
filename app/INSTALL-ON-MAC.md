# Mac 构建与真机运行

## 前提

- Mac 上已有 Xcode，建议 16+，并安装所需 iOS 平台支持。
- Xcode 支持手机当前系统版本。如果手机系统比 Xcode 新，应使用匹配的 Xcode。
- 真机有 LiDAR，系统至少 iOS / iPadOS 17。
- Apple 开发身份可用于设备开发签名。此项目不需要云端服务、付费 API 或特殊业务 entitlement。

## 首次打开

直接打开 `RoomCanvas.xcodeproj`，选择 RoomCanvas scheme。该工程没有外部运行时依赖；不会触发 CocoaPods 或第三方包解析。

在左侧工程设置里选择 RoomCanvas target，进入 Signing & Capabilities：

1. 选择自己的 Team。若未登录，在 Xcode Settings > Accounts 登录。
2. 将 Bundle Identifier 从 `app.roomcanvas.scanner` 改成自己可签名的唯一标识。
3. 保持自动签名。若也要在真机运行测试，为 RoomCanvasTests target 配置对应 Team 和测试 Bundle Identifier。

开发身份和证书不应发到聊天、写入源码或放入交付 ZIP。

## 真机运行

用数据线连接设备，选择“信任”。如系统要求，在设备设置里启用 Developer Mode，并按系统提示重启。Xcode 选择这台设备后点击 Run。

首页是本地扫描库。点击右上角取景器图标开始。首次使用需要允许相机访问；拒绝后可以通过 App 的“打开设置”入口恢复。

结束扫描后会整理文件与家具照片，可能需要一段时间。完成后进入扫描详情，检查“家具裁剪 / 原图框选”对应关系。导出图标生成 ZIP，随后可保存到“文件”或通过 AirDrop 发给 Mac。

## 构建检查与输出

`bash scripts/verify-mac.sh` 执行 plist 检查和 iPhone SDK unsigned build。日志保存在 `verification/device-build.log`。unsigned build 只能检查工程编译，不能绕过设备签名直接安装。

`bash scripts/verify-mac.sh --test` 在指定模拟器运行 XCTest，保存测试日志与 xcresult。设置 `ROOMCANVAS_SIMULATOR_ID` 后使用。

如需 TestFlight 或可分发 IPA，必须在你们的开发团队和目标分发方式下另行 archive、签名和导出；当前目录没有可直接侧载的已签名 IPA。

## 常见问题

| 表现 | 排查 |
| --- | --- |
| No signing certificate / provisioning profile | 设置 Team、唯一 Bundle ID，并确认设备已连接与开发身份有效 |
| Device support / OS version 错误 | 使用支持该设备系统版本的 Xcode |
| 不能开始 RoomPlan | 检查 LiDAR 硬件、系统版本和相机权限；模拟器无法实扫 |
| 模型有但家具图缺失 | 查看关键帧数量、跟踪质量和照片中的家具可见范围；增加完整视角后重扫 |
| 家具照片旋转或框偏移 | 按真机验收记录设备 / OS、原图、context 图和 cameras.json，优先检查图像变换与坐标 |
| USDZ 导出失败 | 扫描详情会显示原因；JSON 与已保存的照片仍可导出 |
| 扫描中切后台或强退 | 已写文件留在本机；有原始结果时可以重新整理，否则导出已采集部分并重新扫描 |

## 更新后恢复上次失败记录

在覆盖安装前，先通过“文件”App 或 Xcode Devices 导出原扫描目录作为备份。使用原来的 Team 和 Bundle Identifier 直接 Run 覆盖安装，不要先删除手机上的 App，以免删除 Documents 中的扫描记录。

打开旧扫描详情时会尝试从 `frames/*.json` 恢复缺失或损坏的 `cameras.json`；原损坏索引保留备份。点击导出可带走已保存的部分文件，不会将失败状态改成完成。如果 `roomplan.raw.json` 已保存且有效，可点击“重新整理扫描”再次构建房间。只有照片、没有逐帧参数或原始 RoomPlan 文件时，无法自动补造位姿或完整房间，需要保留现场并重新采集。

新版本 JSON 错误会显示失败文件名和字段路径。下次真机测试如仍失败，记录完整错误文字，并导出扫描包供定位。Windows 静态检查不等同于真机修复验收。
