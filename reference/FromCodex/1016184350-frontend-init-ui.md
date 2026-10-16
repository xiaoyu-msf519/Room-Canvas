# RoomCanvas 前端初始化与 UI 骨架交付

## 交付范围

已在 `src/frontend/` 建立 Vite + React + TypeScript + React Three Fiber 工程，并完成可启动的 Unity 编辑器风格单画布双模式界面。当前阶段按约定使用空白场景与空家具列表，未接入真实扫描数据或后端生成接口。

## 工程结构

```text
src/frontend/
├─ index.html
├─ package.json / package-lock.json
├─ vite.config.ts
├─ tsconfig*.json
└─ src/
   ├─ types/scene.ts                 # SceneManifest、家具、资产与任务状态
   ├─ state/useRoomCanvasStore.ts    # Zustand 全局状态
   ├─ scene/
   │  ├─ SceneCanvas.tsx              # 常驻 R3F Canvas
   │  ├─ EmptyRoom.tsx                # 10m 米制网格与坐标轴
   │  ├─ Lighting.tsx                 # 晨光 / 暖阳 / 夜灯
   │  └─ CameraControllers.tsx        # Orbit + 第一人称状态机
   ├─ components/
   │  ├─ TopToolbar.tsx
   │  ├─ HierarchyPanel.tsx
   │  ├─ InspectorPanel.tsx
   │  ├─ AssetDrawer.tsx
   │  └─ HudLayout.tsx
   ├─ App.tsx
   ├─ main.tsx
   └─ styles.css
```

## 已实现交互

- 单个 R3F `<Canvas>` 从页面加载到模式切换始终存在；编辑模式启用 OrbitControls，Play 模式启用 Pointer Lock 第一人称相机。
- Play 模式将相机高度固定为 `Y = 1.65m`，支持 WASD、方向键与 Shift 加速，水平移动限制在 `[-9.7m, 9.7m]`，Esc 解锁后自动回到 Edit Mode。
- 编辑模式默认显示 Hierarchy、Inspector、Asset Drawer；Play 模式自动收起三个面板，只保留中央 Playing 状态与十字准星提示。
- W/E/R 与工具栏按钮分别切换平移、旋转、缩放模式；原框对比开关、三种光照预设和保存场景轻提示均可用。
- 空白场景包含 10m × 10m、1m 主刻度、0.2m 子刻度的参考网格、坐标轴和地面阴影接收面。
- Asset Drawer 支持本地文件选择、拖拽图片文件、拖拽 `text/uri-list` 或 HTML 图片链接、Edit Mode 下全局 Ctrl+V 图片/URL，以及淘宝 CDN 缩略图后缀还原。每次导入都会立即生成商品预览卡片，状态为 `待生成 3D`，并保留 `放入房间` 操作位。
- Inspector 在未选中对象时展示清晰空状态，同时保留 Transform、模型校准、裁剪预览、AI 重建和删除的结构占位。

## 验证

- `npm install`：成功，依赖审计无漏洞。
- `npm run build`：通过，TypeScript 与 Vite 编译零错误。
- `Invoke-WebRequest http://127.0.0.1:5173/`：返回 HTTP 200，HTML 包含 root 挂载点与 RoomCanvas 标题。
- 开发服务器：`http://127.0.0.1:5173/`。
- 内置浏览器环境当前无可用实例，因此未能完成截图级浏览器验收；已完成 HTTP 入口与生产构建验证。

## 后续接入点

1. 在 `types/scene.ts` 将后端 SceneManifest 映射到真实扫描 schema，并把房间与家具网格加载到 `SceneCanvas`。
2. 在 `AssetDrawer` 的 `放入房间` 操作接入 FastAPI generation job，替换 `待生成 3D` 状态并加载 GLB。
3. 在 `InspectorPanel` 连接选中家具与 TransformControls，保存家具变换到场景接口。
