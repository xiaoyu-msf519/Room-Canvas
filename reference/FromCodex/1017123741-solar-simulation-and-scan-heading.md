# 全年日照模拟与原生扫描朝向

## 已交付

- 顶栏删除晨光、暖阳、夜灯，改为全年日期环与 24 小时时间环。鼠标、触控拖动支持整圈循环，提供方向键与精确日期/时间输入；闰年自动支持 366 天。
- 位置按钮支持 34 个省级地区的大致位置（采用省会/首府坐标），也可填写经纬度、固定 UTC 偏移与北向角。空白经纬度回到上海 31.2304°N、121.4737°E，默认北京时间。
- 场景显示当天太阳轨迹及太阳位置，轨迹可关闭；平行太阳光、光色、天空和环境亮度随角高度连续变化，夜晚关闭太阳直射并保留简化月光。Play 隐藏轨迹与编辑控件。
- 墙体和家具接入阴影。Edit 的透视墙另有不可见的实体投影网格，透视显示不会造成太阳穿墙；家具沿用 Edit 低模、Play 高模。
- 根据用户补充，iOS 开始扫描时同步采集指南针与 AR 位姿，并在导出时记录房屋地理朝向；Web 自动采用可靠真北与扫描位置。

## 公开方案调研与取舍

| 资料/方案 | 本次采用方式 |
| --- | --- |
| [SunCalc 源码与文档](https://github.com/mourner/suncalc) | 固定 `suncalc@2.1.1`，使用已有 Meeus 天文模型；v2 返回角度制、正北起顺时针方位，显式适配到 +X 东、Y 上、-Z 北。避免与旧版本弧度/南向约定混用。 |
| [NOAA 算法说明](https://gml.noaa.gov/grad/solcalc/calcdetails.html)、[计算方程](https://gml.noaa.gov/grad/solcalc/solareqns.PDF) | 核对纬度、经度、UTC、太阳高度与日出日落概念。 |
| [NREL SPA 论文与示例](https://docs.nlr.gov/docs/fy08osti/34302.pdf) | 用公开的 Colorado 2003-10-17 示例核对太阳方位和高度。场景预览不需要 SPA 的天文台级复杂度。 |
| [Three.js LightShadow](https://threejs.org/docs/pages/LightShadow.html)、[公开阴影缓存方案](https://discourse.threejs.org/t/performant-soft-shadows-three-js/27777) | 固定 1024² 阴影图，按太阳方向、家具和场景变化设置 needsUpdate，静止时复用。 |
| [MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) | 全年计算在 Worker；Float32Array 通过 transferable buffer 转移；新位置请求取消旧 Worker。 |
| [MDN Pointer Capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)、[WAI-ARIA Slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) | 环形控件捕获指针，移出控件仍可拖动，支持取消/释放、键盘和可访问值文本。 |
| [Apple CLHeading](https://developer.apple.com/documentation/corelocation/clheading)、[Device Motion](https://developer.apple.com/documentation/coremotion/getting-processed-device-motion-data) | Core Location 真北校正与 Core Motion north-reference 姿态配合，不能把磁北直接当作太阳所需的真北。 |

## 平滑与性能

每个位置/年份在后台计算每天每 5 分钟的太阳单位方向，平年约 10.5 万次采样、约 1.27MB 缓冲。内存保留最近 3 个位置/年份。圆环拖动只触发每动画帧一次状态更新；灯光通过 useFrame 直接修改既有 Three.js 对象，不逐帧建立光源或 React 组件。

日期与时间在笛卡尔向量上双线性插值并归一化，避免 359°/0° 方位跳变；日环、年环都有首尾闭合采样。灯光方向采用短时球面缓动，可随时反向；减少动态效果偏好下直接跟随输入。轨迹只在日期、北向或查表改变时更新缓冲，时间变化只移动太阳标记。

本机实测一轮上海全年 Worker 含启动与转移约 107ms，期间主线程计时器仍执行；10 万次查表约 21.6ms，约 0.216μs/次。抽样插值相对 SunCalc 直接计算最大误差 0.0287°。这是 CPU 检查，不是 GPU 帧率承诺。

## App 朝向契约

开始扫描时启动 Core Location 与 20Hz Core Motion；使用真北参考姿态，未授权/未就绪时记录磁北但不作为 Web 自动真北。每 0.5s 保存一组通过检查的配对数据：AR/运动时间差不超过 0.2s、指南针精度不差于 25°、磁场中/高校准状态、AR 正常跟踪、重力方向一致。

通过竖屏 AR view matrix 的逆矩阵将 Core Motion 参考系映射到同一 AR 世界；汇总至少 5 组一致向量，使用精度加权圆均值和离群值剔除。数据包括：

- `heading.json`：原始配对样本、AR/运动时间戳、竖屏相机矩阵、参考到设备姿态矩阵、质量与最终汇总。
- `manifest.json` 和 `scene.json` 的可选 `orientation`：true/magnetic reference、north/east/south/west 世界向量、精度、样本数、coherence、位置及时区。
- 关键帧的可选 `compass`：该帧对应的同步记录。
- 后端 `SceneManifest.source.orientation`：验证后保留的世界北向及 `northAngleDegrees`。适配仅平移房间，不旋转北向。磁北无自动真北角。
- Web 每份场景首次接收可靠真北时应用，后续任务轮询不覆盖用户手动校准。

已增加定位/运动权限说明，只在扫描期间运行；拒绝权限或传感器不足不会阻断扫描。旧扫描完全兼容，无法从已有无朝向数据补出真实方位，需手动校准或重新扫描。

## 验证与交付限制

- `npm run build` 通过，Worker 独立产物约 2.7KB，保留既有主包体积提示。
- `npm run verify:solar` 通过：实际打包 Worker 和 buffer 转移、缓存/取消、365/366 天、UTC 转换、NREL 参考、东西向、首尾连续、北向旋转、极昼极夜、持续光源、昼夜平滑、轨迹/阴影缓存、扫描自动北向与手动修正保留。
- `npm run verify:walls` 与 `npm run verify:scan` 通过，既有墙面排序、渐变、房间几何、1.5m 漫游出生点与碰撞仍有效。
- `env/backend/Scripts/python.exe src/backend/scripts/verify-heading.py` 通过：朝向验证、磁北区别、旧包兼容、异常数据降级，房间/家具位置未被朝向元数据改变。
- `python app/scripts/validate-project.py` 通过：18 个 Swift 文件语法、Xcode 引用、Info.plist 与隐私清单。新增 HeadingAlignment XCTest 已注册，Windows 无 Xcode/Apple SDK，尚未编译 iOS 或执行 XCTest、真机指南针校验。
- 浏览器无可用连接，未完成鼠标/触控实机、响应式截图及 GPU 画面帧率验收。
- 后端已刷新；页面、Worker 模块、`/api/health`、当前场景接口均 HTTP 200，Rodin 配置仍可用。服务保持 `http://127.0.0.1:5173/` 与 `http://127.0.0.1:8000/`。
- 新 App 源码包：`app/dist/RoomCanvas-iOS-Source.zip`，需在 Mac 上编译安装后重新扫描；不是已签名安装包。

范围边界：省份坐标为大致参考；全球自定义位置使用显式固定 UTC 偏移，未自动查询夏令时；太阳高度参与视觉光强估计，未模拟天气、遮云、真实辐照度或精确月球方位。朝向仍受室内磁干扰影响，保留人工校准。

Git 仅提交本阶段源码、配置和本报告；依赖、Worker缓存、模型、运行环境、安装包与任何密钥均不提交。用户新增的输入资料未改动。
