# App 扫描自动发送到 Web 与 Cloudflare 上传入口

时间：2026-10-18，Asia/Shanghai。

## 使用步骤

1. 在 Mac/Xcode 重新编译安装本次 App，工程位于 `app/RoomCanvas.xcodeproj`。旧安装包没有本次新增的自动发送队列和连接设置。
2. 打开 http://127.0.0.1:5173/ ，点击左侧“连接 App”，显示当前接收地址、连接二维码和复制按钮。
3. App 左上“连接 Web”中扫描该二维码，或粘贴复制的连接 JSON，再点“保存并测试连接”。令牌保存在 iOS Keychain，不进入扫描包。
4. 保持“扫描完成后自动发送”开启。以后扫描整理成功后会自动排队、打包、上传，Web 房间列表约 10 秒内自动刷新。选择新房间即可查看进度，已有编辑视图不会被强行切换。

只需为接收端配置一次；使用 Cloudflare 临时 Quick Tunnel 时，重启隧道可能变更地址，需重新配置 App。未配置或暂时断网时扫描仍保存在本机，队列不会要求重新扫描。App 切后台暂停并保留确认偏移，回到前台自动续传；没有宣称可突破 iOS 的长期后台执行限制。

## 已实现

- 删除左下“淘宝商品链接”预留输入框、无用图标和相关样式，保留商品图片拖放、粘贴、选择及图生 3D 功能。
- 借鉴 `reference/ToCodex/Remoted` 的上传协议、Keychain 设置、分块客户端和独立上传网关，没有替换其较旧的扫描/编辑逻辑，现有朝向、涂装、最低墙顶和真实尺度链路保留。
- App complete 清单保存后自动加入持久化队列，断网自动重试，连续扫描不会因上一份正在发送而丢任务。进度显示在列表、扫描完成页和详情中。
- 每块最大 2 MiB，逐块 SHA-256、已确认偏移、丢失 ACK 续传、整包 SHA-256、ZIP CRC 与文件清单校验。单包与解包文件总量最大 2 GiB。
- 验证成功的原扫描完整保存到房间目录，包含原始 USDZ、深度、图片与相机参数，生成一个持久化接收事件；现有 Web 后台自动导入它、恢复缓存并启动家具任务。无需代理或用户逐件处理。
- 同一扫描重复上传、不同 ZIP 外层目录复用同一场景及生成任务；内容不同的同一 scanId 不覆盖已有结果。
- Web 房间列表与原目录 `.roomcanvas-cache` 写回方式保留，新房间与手动导入走同一通用建模链路。

## 公网接入

Cloudflare Tunnel 已启动，只转发本机 `127.0.0.1:8001` 上传服务；`8000` 的私有编辑 API 和 `5173` Web 未经隧道公开。上传网关必须携带独立上传令牌，不包含房间读取、编辑或付费生成路由。

网关使用单 worker。上传令牌自动保存在忽略的 `tmp/mobile-upload/config.json`，当前临时地址保存在 `tmp/mobile-upload/endpoint.json`；App 和源码均不包含 Rodin 密钥。Web 的连接信息接口限制接收机回环客户端访问，响应不缓存。

保持编辑后端运行后，可用下列命令重新启动上传服务及临时隧道。当前已经运行，不要重复启动：

```powershell
.\env\backend\Scripts\python.exe src/backend/scripts/start-mobile.py --tunnel --cloudflared ".\reference\ToCodex\Remoted\deploy\runtime\tools\cloudflared.exe"
```

也可将 `--cloudflared` 指向正式安装的官方工具。参考资料提供的可执行文件已验证 Cloudflare Authenticode 签名有效。固定域名/命名隧道可通过 `ROOMCANVAS_UPLOAD_PUBLIC_URL` 提供接收地址，命名隧道本身仍需团队账号与域名配置。

## 验证与边界

- `npm run build`、`npm run verify:import` 通过：包含预留输入框删除、手机连接入口及原上传状态 UI。
- `verify-mobile-upload.py` 通过：鉴权、上传服务与编辑 API 隔离、分块校验/偏移、丢失 ACK 与服务重建后续传、原始文件保留、自动发布、朝向、自动家具编排、重复 ZIP 复用。生成边界用测试替身，没有真实付费调用。
- `smoke-mobile-public.py` 经真实 Cloudflare HTTPS 成功上传 2,098,401 字节合成采集包，自动出现在真实房间列表并完成空房间处理，重复提交复用场景；公网不可读取编辑 API。没有真实手机参与，也没有 Rodin 付费任务；合成记录已清理，当前用户场景已保留。
- `verify-auto-scan.py` 与 `verify-room-cache.py` 通过，自动降级选图、缓存与重复计费保护没有回退。
- `python app/scripts/validate-project.py` 通过：23 个 Swift 文件语法、77 个 Xcode 工程对象、源文件登记、资源、隐私清单。新增 XCTest 检查接收 URL 的 HTTPS/局域网限制，但此机没有 Xcode，未执行 iOS SDK 类型检查、Xcode 编译、XCTest 或真机扫描/二维码/后台切换测试。
- 当前浏览器连接器没有可用浏览器，未做真实浏览器截图或二维码像素验收。二维码使用现有库 `qrcode.react@4.2.0`。

服务与隧道保持运行；公网入口和协议已验证可用，但 App 到手机的最终交付还需要 Mac 编译安装与设备验收。原输入资料、接收扫描、上传/模型缓存、运行日志和凭据不提交 Git。
