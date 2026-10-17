# 带朝向扫描导入与 App 计时显示移除

## 数据与接口核对

本次读取用户授权目录 `reference/ToCodex/ScanDemoWithDirectionResult/`。输入为兼容的 `roomcanvas.scan.v1` / `roomcanvas.scene.v1`，单位米、ARKit 右手 Y-up、column-major 矩阵。

- 104 张关键帧、7 件家具（5 把椅子、2 张桌子），家具均有尺寸、位姿与裁剪图。
- 10 面墙、3 个门洞、1 块地板；Web 适配为 31 块保留门洞的墙板和真实多边形地板。
- `manifest.json`、`scene.json`、`heading.json` 的朝向汇总一致，170 组原始配对样本全为 `magnetic-north`，不是 iOS 真北读数。
- 逐组重算 `portraitCameraToWorld × northReferenceToDevice`，方向向量最大误差约 1.31×10⁻⁷；AR/运动时间戳最大差约 0.1643s，符合采集约定。加权平均与 App 汇总吻合。
- 东/西/南/北轴的符号和叉积关系正确。Web 房间适配仅平移原点，未旋转坐标，因此朝向不会随原点重置而偏转。

## 磁北适配

旧接口为避免混淆，仅自动采用真北，因此这份磁北数据原本不会自动对齐太阳。

本次新增固定依赖 `pygeomag==1.1.0`，用扫描位置和扫描日期的 WMM2025 磁偏角离线修正。该实现为 NOAA World Magnetic Model 的公开 Python 移植，使用随包系数，不上传扫描位置到外部地磁服务。

- 本次磁偏角约 **−6.57196°**；以东偏为正，`世界真北角 = 世界磁北角 − 磁偏角`，避免将修正方向写反。
- 修正后的 Web 北向角为 **240.87023°**，相对场景 -Z 轴顺时针，北向量约为 `[-0.8735194, 0, 0.4867893]`。
- 输出 `reference=true-north`，同时明确保留 `sourceReference=magnetic-north`、原磁北向量、WMM2025 名称、磁偏角、模型不确定度和日期。没有伪装成设备直接采集真北。
- 缺少日期/位置、年份超出 2025–2029，或位于地磁模型指南针警告区域时保留磁北和手动校准，不猜测真北。

原指南针精度约 **±11.46°**，位置精度约 9km；WMM 修正不能消除室内钢材、电器等导致的磁干扰。本次验证证明数据链与数学转换一致，没有独立的实地真北测量作为精度验收。

公开参考：[pygeomag](https://github.com/boxpet/pygeomag)、[WMM2025 说明与磁偏角符号](https://geomag.colorado.edu/online-calculators/world-magnetic-model-2025-google-spreadsheet-application)、[BGS WMM 说明](https://geomag.bgs.ac.uk/data_service/models_compass/wmm_calc.html)。

## 房间与家具

新场景 ID：`9f02840fae085e188a5ea4dec7fc0d91`，已设为 `/api/scenes/latest` 和“载入样例”的默认结果。旧样例和已有模型保留。

默认样例导入使用稳定 ID，重复载入复用同一场景与已提交的家具任务。新数据的原位缩放沿用扫描尺寸，Edit 低模、Play 高模，模型纹理嵌入 GLB。

7/7 件家具已完成带纹理生成、真实尺寸缩放、高低模处理和原位回填。14 个 GLB 全部通过：均含 3 个嵌入纹理引用及有效材质，高模各 500,000 面，低模为 60,000–78,730 面；高模包围尺寸与扫描一致，低模在 3% 尺寸容差内。全部模型 GET 接口返回有效 GLB，模型原点保持居中。

再次调用完成场景的重建接口，7 个 jobId 保持不变，无重复生成任务。验证脚本：`env/backend/Scripts/python.exe src/backend/scripts/verify-scene-models.py 9f02840fae085e188a5ea4dec7fc0d91 --require-complete`。

## App 变更

删除扫描页右上角的动态计时数字，用与左侧退出按钮等宽的透明占位保持标题居中。内部计时、自动采帧与 5 分钟扫描时限不变。

新版源码包已生成：`app/dist/RoomCanvas-iOS-Source.zip`。Windows 完成 Swift 语法与 Xcode 引用静态检查，未进行 Mac/Xcode 编译或 iPhone 真机验收；安装新 App 需在 Mac 上重新编译。

## 验证

- `verify-direction-scan.py`：真实 170 组传感器/矩阵/时戳、磁偏角正负方向、WMM 公开参考、异常日期降级、实际资源接口、家具/相机尺寸位姿保持，全部通过。
- `verify-heading.py`：原有真北/磁北区别及旧数据降级通过。
- `npm run verify:solar`：实际新场景北向进入 Web 日照状态、后端北向角与 Web 三维轴一致；原有全年 Worker、环形插值等检查通过。
- `npm run verify:scan`：新场景地板尺寸/位置、31 墙板、1.5m 出生点、碰撞和编辑保留通过。将旧脚本固定的“地板宽度大于 10m”改为对比本次扫描多边形的精确世界边界。
- `npm run verify:walls`：新房间 262 组透明墙面片段、932 次深度排序比较、凹角遮挡与渐变回归通过。
- `npm run build` 通过，保留既有主包体积提示；App 静态检查通过。
- 浏览器工具无连接实例，未完成真实 GPU 画面目视验收。前后端保持运行，页面为 `http://127.0.0.1:5173/`；已打开旧房间的页面需刷新或点击“载入样例”。
- 重建前已重启后端加载磁北修正。交付前再次重启的操作被自动安全审查拦截，未给出具体原因；没有继续尝试终止服务。现有后端与页面正常，健康检查通过，当前场景保留 7/7 完成状态，朝向接口核验通过。

输入扫描包含照片和位置，仅复制到被忽略的运行时目录，不提交；本次仅提交源码、必要检查脚本与本记录，不提交模型、依赖、源码 ZIP、环境或密钥。
