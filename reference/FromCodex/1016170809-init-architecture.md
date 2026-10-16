# RoomCanvas 初始化确认与架构拆分

## 1. 本次初始化

- 已检查工作区：原有 `src/`、`env/`、`tmp/`、`reference/ToCodex/` 与 `reference/FromCodex/`；未发现现有工程源码或 Git 仓库。
- 第一项修改为创建 `.gitignore`，保护运行环境、临时数据、依赖目录、私钥、API 原始资料与常见密钥配置。
- 已读取 `reference/ToCodex/API.md`，本报告仅记录接口能力与接入约束，不包含密钥。
- 已建立源码占位目录与缓存目录；`env/`、`tmp/` 保持本地，不通过 Git 追踪。尚未创建虚拟环境或安装依赖。
- 已将长期工程纪律写入根目录 `AGENTS.md`，供后续开发沿用。
- 本阶段仅为仓库、目录与设计初始化，尚无可启动的前后端应用。Git 提交与推送结果以本次对话交付记录为准。

## 2. 可用接口与约束

| 能力 | 已知接口 | 接入决定 |
| --- | --- | --- |
| 图生 3D | Rodin，`https://api.hyper3d.com/api/v2` | 后端 Bearer 鉴权；异步提交、轮询、下载 |
| LLM | 校内网关 `/api/v1/start/chat/completions`，资料另有 `/api/v1/response` 示例，模型示例 `deepseek-pro` | 非主链路依赖；尚未验证可达性、鉴权或视觉输入支持 |
| 房间扫描 | Apple RoomPlan 官方资料链接 | 仅有参考链接，尚无真实扫描文件、导出 schema 或相机样本 |

Rodin 流程：`POST /rodin` 以 multipart 传入 1–5 张 `images`；显式指定 `tier=Gen-2.5-Medium`，避免默认回退到旧系列。建议 GLB、Raw 网格，面数参数在实现时核对 schema。`jobs.subscription_key` 用于 `POST /status`，顶层 `uuid` 作为 `task_uuid` 用于 `POST /download`。

首次查询至少等待 5 秒，后续退避到最长 30 秒；429 遵守 `Retry-After`，任一 job 为 Failed 即终止，仅当非空 jobs 全部 Done 后下载。受理时检查业务错误与非空 uuid；保存任务标识以便恢复查询，避免因网络超时自动重提而重复扣费。下载返回字段、模型坐标与材质效果待首次真实任务验证。本阶段未调用付费生成接口。

## 3. 基础目录

```text
RoomCanvas/
├─ .gitignore
├─ AGENTS.md
├─ src/
│  ├─ backend/app/       # FastAPI；后续拆 api、schemas、services
│  ├─ frontend/src/      # Vite + React + R3F；后续拆 scene、components、state
│  └─ shared/            # 不含凭据的 JSON schema、数据契约与小型示例
├─ env/                 # 后续 env/backend 为 Python venv
├─ tmp/
│  ├─ uploads/          # 商品图
│  ├─ scans/            # 原始扫描及关键帧
│  ├─ crops/            # 单件家具裁剪缓存
│  ├─ models/           # GLB 与模型相关缓存
│  └─ jobs/             # 可恢复的异步任务状态
└─ reference/
   ├─ ToCodex/          # API.md、专用 SSH 私钥等用户输入
   └─ FromCodex/        # MMDDHHmmss-标题.md
```

环境文件与工程配置后续分别放在 `src/backend/` 和 `src/frontend/`；密钥只放被忽略的后端 `.env`，前端不携带密钥。缓存使用内部生成的资源 ID 组织，前端以受控资源路由读取，避免直接挂载整个 tmp 目录。

## 4. 架构与主链路

### A. 扫描接入与场景底座

后端负责接收、校验扫描包，并通过独立适配器转换成统一 SceneManifest。前端依据房间墙、地面、开口几何构建 1:1 底座，先将家具显示为可选中的 Bounding Box。房间结构与家具对象分层，避免在含原家具的扫描网格上叠加重建家具而出现重影。

统一约定：米、右手系、Y 向上；家具 `position` 为世界坐标框中心，`size` 为局部轴完整尺寸，旋转使用 `[x,y,z,w]` 四元数。输入转换需同时作用于房间、家具、相机，明确源单位、轴向和矩阵布局。原始扫描契约尚未确定，不假设 RoomPlan 导出即可直接加载。

SceneManifest 最小内容：`version`、坐标说明、`room` 几何或资源引用、`furniture[]`、`cameras[]`。家具包含稳定 ID、类别、框位姿与尺寸、可选 `modelId`；相机包含图像引用、图像宽高、内参 K、显式 `cameraToWorld` 和源相机坐标约定。后续实现再固化 JSON schema。

### B. 原家具裁剪与重建

后端将家具框的 8 个顶点转换到相机坐标，通过内参投影到关键帧；处理相机后方、近裁剪面相交、越界和图片方向问题。根据可见面积、视角与遮挡情况挑选关键帧，裁剪时留少量边距。若缺少投影参数，提供手动裁剪入口；2D 检测或分割作为可选增强，现有资料尚未提供对应接口。

裁剪结果进入统一生成任务服务，由 Rodin 适配器提交、查询和下载。比赛阶段先使用单进程后台任务和 tmp/jobs 下的轻量持久化，不引入 Redis/Celery；重启后利用已保存的任务标识继续查询，前端轮询本地任务接口。

模型先移到局部中心并校正朝向，再按生成模型实际包围盒匹配目标框，最后套用原家具世界位姿。轴向缩放可精确匹配框但可能拉伸，提供保持比例的缩放选择和手动转向。将模型校准参数与用户编辑变换分别保存，避免重复加载时叠加变换。

### C. 漫游、编辑与商品图换装

前端以 R3F/Three.js 渲染场景，使用指针锁定实现鼠标观察、WASD 平面移动；Esc 退出锁定。编辑家具时释放指针，使用射线选中与变换控件移动、旋转或删除对象。两种操作状态互斥，减少漫游与拖拽冲突。首版采用地面约束和简单房间边界限制。

商品图上传复用同一套生成服务；新家具先由用户确认尺寸，再放到地面或视线前方。上传或生成失败显示明确任务状态，保留原框与已有场景，不阻塞漫游。场景编辑保存至 tmp 下本地文件，下载模型也在本地缓存，避免刷新后依赖临时下载链接。

### D. 建议的后端接口（设计，尚未实现）

| 路由 | 用途 |
| --- | --- |
| `GET /api/health` | 基础存活检查 |
| `POST /api/scans` | 接收扫描并返回场景 ID |
| `GET /api/scenes/{scene_id}` | 获取统一场景清单 |
| `PUT /api/scenes/{scene_id}` | 保存家具变换、删除状态与新增家具 |
| `POST /api/scenes/{scene_id}/furniture/{furniture_id}/reconstruct` | 裁剪并发起原家具重建 |
| `POST /api/generations` | 商品图生成，返回本地 job_id |
| `GET /api/jobs/{job_id}` | 返回 queued/running/succeeded/failed 状态、阶段与资产 ID |
| `GET /api/assets/{asset_id}` | 按白名单资源 ID 返回图像或 GLB |

## 5. 48 小时优先顺序与最小验收

1. **0–8h：场景闭环。** 建立可启动工程与统一小样例；展示房间、家具框、第一人称漫游。验收房间尺寸与家具位置一致。
2. **8–24h：单件重建闭环。** 一件家具完成关键帧裁剪 → Rodin → GLB 下载 → 原位回填，确认尺度与朝向。只做必要的小规模真实调用。
3. **24–38h：换装闭环。** 商品图上传、任务反馈、导入与选中/移动/删除；验证刷新后状态可恢复。
4. **38–48h：演示收口。** 优化关键场景、异常提示与演示流程；准备已缓存模型作为断网或生成延迟时的演示资产。

仅执行各阶段必要的启动、构建与端到端冒烟检查，不铺设冗余单元测试。原始扫描、相机内参与位姿、至少一张可用关键帧是实际投影裁剪的后续输入；在收到真实数据前，可先用米制合成场景推进前端。

## 6. Git 与安全执行约定

目标远端为 `git@github.com:xiaoyu-msf519/Room-Canvas.git`。专用 SSH 私钥已限制为当前 Windows 用户可访问；主机记录放入被忽略的 tmp，避免污染仓库。遵循用户指定的私钥与 `StrictHostKeyChecking=no` 参数。每阶段检查暂存文件与敏感忽略规则，提交后推送；如远端已有历史，先保留并整合历史，禁止强推覆盖。

本次只验证目录、忽略规则、Git 暂存清单与远端同步，不安装依赖、不声称已验证运行时应用。
