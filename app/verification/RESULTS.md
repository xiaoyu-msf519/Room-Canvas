# 验证结果

验证环境：Windows / PowerShell，2026-10-17 更新。

## 已执行

- Swift tree-sitter 语法解析：15 个 Swift 文件，无语法错误节点。
- Xcode OpenStep 工程解析：应用 / 测试源文件、构建阶段、资源和 scheme 引用完整。
- Info.plist、PrivacyInfo.xcprivacy、资源目录解析通过。
- 原生离线范围检查：应用源代码未包含 HTTP 客户端或嵌入式网页。
- 导出协议验证器合成测试：6 / 6 通过，覆盖目录 / ZIP、缺失裁剪、缺失位姿、越界裁剪、中断记录不冒充完成，以及 Apple 原始快照缺失时必须有明确诊断。
- 已添加 Swift 回归用例：无效位姿拒绝、辅助数值清理、编码错误字段诊断、相机索引恢复、尾斜杠目录 ZIP 和异常帧隔离；仅完成语法解析，尚未执行 XCTest。

以上是静态检查，不进行 Swift SDK 类型检查。

## 尚待执行

- Mac 上 iPhone SDK 构建。
- XCTest 在 iOS 模拟器执行：投影、图像坐标旋转、相机位移、异常输入、CRC32、ZIP 头和序列化。
- 真实 LiDAR 扫描、JPEG 方向、照片框对齐、可选深度、模型预览与系统分享验收。

没有生成、签名或验证可安装 IPA。最终真机完成状态以 DEVICE_ACCEPTANCE.md 的实际记录为准。
