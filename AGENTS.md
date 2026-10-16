# RoomCanvas 工程约定

## 目标与范围

48 小时 Hackathon，优先完成：扫描房间与家具框展示 → 家具裁剪与图生 3D → 模型原位回填 → 第一人称漫游与家具编辑、商品图换装。每次仅做核心链路必要验证，避免过度工程化与冗余单元测试。

## 文件布局

- `src/`：所有前后端源码、依赖清单与工程配置。建议 FastAPI + Vite/React/Three.js/R3F。
- `env/`：Python venv 等运行环境；`tmp/`：上传、扫描、切图、任务状态、下载模型与其他临时文件。两者始终忽略。
- `reference/ToCodex/`：用户提供的资料，仅在用户通知时读取；初始化已授权读取 `API.md`。
- `reference/FromCodex/`：汇报、方案与排查记录，文件名必须为 `MMDDHHmmss-标题.md`，使用 Asia/Shanghai 时间。用户指定的 `API.md` 是输入文档命名例外。
- 根目录仅保留 Git、忽略规则与代理工程约定等仓库级文件。

## 凭据与 Git

- 任何修改开始前先确认 `.gitignore` 保护 `env/`、`tmp/`、所有 `node_modules/`、`reference/ToCodex/API.md`、`reference/ToCodex/id_ed25519*` 和实际密钥配置。
- 凭据只由后端从环境变量或被忽略的本地配置读取，不放入前端 `VITE_*`、源码、日志或输出文档。示例配置只能含占位值。
- Git 暂存前检查文件列表，提交前确认无凭据；若敏感文件已被追踪，必须先解除追踪再提交，不能只补忽略规则。
- 每次阶段性代码改动完成后，提交并推送到 `git@github.com:xiaoyu-msf519/Room-Canvas.git`。仅暂存本阶段文件，保留用户其他改动；不强推、不覆盖远端历史。
- 使用专用私钥 `reference/ToCodex/id_ed25519`，限制私钥文件权限。PowerShell 设置：

  ```powershell
  $env:GIT_SSH_COMMAND = 'ssh -i reference/ToCodex/id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=tmp/ssh_known_hosts -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15'
  git push
  ```

## 实现边界

- 统一场景单位为米、右手系、Y 轴向上；输入数据必须经显式坐标适配，保留源坐标元信息。
- Rodin 凭据仅在后端使用；生成、轮询、下载分离，区分 `jobs.subscription_key` 与任务顶层 `uuid`。
- 没有真实扫描样本、相机内参或外参时，记录缺失信息，不臆测数据格式或坐标约定。
- 模型生成与场景编辑解耦；生成失败仍可用 Bounding Box 完成房间展示和编辑。
