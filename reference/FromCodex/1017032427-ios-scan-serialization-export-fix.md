# iOS 扫描结束与导出失败排查修复

## 结论与证据边界

已读取用户指定的 GeminiApp.md 并审查 app/ 下实际工程。没有取得失败手机目录或编码错误 codingPath，因此不能断言当次故障一定是 cameraToWorld 的 NaN。系统的“data couldn't be written ... correct format”不能单独区分无效浮点数、Apple Codable 内部失败或其他编码路径。

确认的代码缺陷：

1. FrameRecorder 在 JSON 写入前不验证相机矩阵、内参、时间戳、清晰度与可选光照；JSONEncoder 默认拒绝 NaN/Infinity，单帧和相机总索引会因此无法落盘。
2. 旧帧记录先 append 再写总索引，总索引失败时内存状态与磁盘不一致；失败帧还可能重用 ID 覆盖文件。
3. ScanProcessor 顺序为 manifest → cameras → Apple raw JSON → RoomBuilder。相机或 Apple opaque raw 编码失败都会在房间构建之前终止，即使扫描时 RoomPlan 已识别到房间与家具。
4. 导出器根据字符长度截取相对路径，依赖目录 URL 尾斜杠表示；旧相机索引缺失/损坏时没有恢复入口。当前错误报告没有包含完整源路径，不能仅凭“cameras.json 不存在”判定是索引未保存还是导出定位出错。

## 已修改

- 保持 JSON 数字契约：无效相机矩阵、焦距、图像变换和时间戳单独拒绝，辅助清晰度归零、可选无效光照省略；不把 NaN/Infinity 转成字符串，也不伪造相机坐标。
- 新建扫描时即创建空 cameras.json；采用单调递增帧 ID；单帧和总索引写入成功后再更新内存帧列表。
- JSON 写入错误带失败文件名、codingPath 和编码器 debugDescription。
- 先尝试保存 Apple 原始数据；相机逐帧验证隔离。Apple raw/完整 room JSON 编码失败记录警告，仍用原始内存对象调用 RoomBuilder、保留有效结构和家具。无效结构/家具单独跳过并记录，不阻断其他有效对象。
- 相机总索引缺失或不可解码时，从 frames/*.json 和实际存在的照片恢复；损坏索引先备份，逐帧 JSON 不可恢复时记录原因，不从 JPEG 推导相机参数。
- 详情打开和导出前执行恢复，更新文件清单与警告；恢复改变完成扫描的帧数量时标记为未完成，不伪装完整成功。
- ZIP 相对路径改用标准化路径组件计算，增加源文件丢失的定位信息；失败扫描可打包已保存部分。
- 导出验证器允许 Apple 可选快照编码失败，但必须在 manifest.warnings 中明确标注缺失文件；同步更新数据协议与 Mac 恢复说明。

## 验证

- Windows 静态校验通过：15 个 Swift 文件语法、Xcode source/build phase、scheme、plist、资源目录与本地离线范围检查。
- Python 导出协议验证器：6/6 测试通过，包含缺失 Apple 快照的诊断要求。
- 在现有 ArchiveTests.swift 添加四组回归测试：非有限值隔离、编码路径诊断、索引缺失/损坏恢复与尾斜杠 ZIP、异常帧不影响有效帧及空索引。
- 当前无 Swift/Xcode/Apple SDK，新增 XCTest 尚未运行，未执行 SDK 类型检查或 iPhone 实机复测；静态通过不代表真机问题已确认消失。
- 已重新生成 app/dist/RoomCanvas-iOS-Source.zip，源包 CRC 检查通过；不包含 .tools 或构建目录。

## 在 Mac / iPhone 上接续

1. 先从手机备份现有 Scans 目录。使用更新源码，在 Mac 运行 bash scripts/verify-mac.sh；可用模拟器上运行 --test 执行新增 XCTest。
2. 保持原 Team 与 Bundle ID，直接 Run 覆盖安装，不先删除 App，保留原 Documents。
3. 打开旧失败扫描并导出。若 frames/*.json 还在，可恢复相机索引；若 roomplan.raw.json 存在且有效，可重新整理房间。
4. 若原始 RoomPlan 文件和相机侧录从未成功保存，无法从 manifest 或 JPEG 恢复完整房间/位姿；新版本只能保护后续扫描，旧现场可部分导出。
5. 真机进行一次短扫描并结束，检查 scene.json、cameras.json、家具列表与导出 ZIP；再以正常房间规模复测。若失败，记录包含文件和字段的新错误信息。

## 仓库范围

app/ 原为未追踪的用户提供工程。本次保留其现有路径，并将完整可构建源码、工程、资源与必要脚本一起纳入本阶段提交；不移动目录、不改用户前端工作、不提交 APP.zip、参考输入、.tools、dist 或密钥。
