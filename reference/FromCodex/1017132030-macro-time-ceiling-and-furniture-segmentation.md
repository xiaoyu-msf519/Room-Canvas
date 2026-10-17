# 宏观时间推进、天花板与家具邻物分割改进

## 宏观日照

日照顶栏新增两个互斥开关：

- `日夜`：6 秒推进一个完整太阳日，时间环每 24 小时循环，日期环同步前进。
- `四季`：10 秒推进一个季节，40 秒循环一年，日期环连续推进；时间环保持当前时刻，太阳轨迹和高度随季节连续变化。

Edit 模式可切换，Play 模式隐藏这些编辑控件但保留选中的推进状态，因此可以先在 Edit 开启再进入漫游。再次点击当前开关停止推进。推进通过 Zustand 的单次时间累加和已有 5 分钟太阳查表完成，不重建 Worker、轨迹或灯光对象；Play 的灯光和阴影仍按需更新。

## 天花板

扫描协议没有显式 ceiling surface，本次后端根据地板多边形和所有墙体顶部合成 `room-ceiling`：保持地板的真实多边形、姿态和坐标，只把 Y 放到最高墙顶。Web Edit 显示低透明天花板以便观察，Play 显示高不透明度天花板；天花板接收阴影但不投射阴影，保持室内日照可读性并避免“加了天花板后全黑”。日照环境光、半球光和简化月光仍按太阳高度变化。

旧场景会在再次点击“载入样例”时重新适配一次，保留所有家具 jobId、模型 URL 和完成状态。当前方向扫描场景仍为 `9f02840fae085e188a5ea4dec7fc0d91`，已含 1 个 ceiling、7/7 完成家具模型。

## 两把椅子问题的根因

这次异常不是 Rodin 把一个干净输入复制成两个，而是扫描裁剪输入已经包含邻椅。以 `041A0799-76D4-4E03-B8F3-10044FFD541B` 为例：最高分 `crop_1` 的原图左、右都出现相邻椅子，矩形从 `x=0` 贴到图片边缘；旧评分只奖励投影框可见比例、面积、中心性和清晰度，没有惩罚边缘截断或同一帧其它家具框的重叠。因此“排成一列的椅子”会把多个实例交给图生 3D，提示词无法从没有遮罩的 JPEG 中可靠恢复单件家具。

## 泛化改进

### iOS 扫描端

- 投影框新增图像边缘距离：贴边候选保留为最后 fallback，但大幅降权；有安全边距的正面候选优先。
- 同一帧为所有家具投影 3D OBB，计算目标框与其它家具框的最大面积重叠比；邻物重叠越大，候选分数越低。没有干净视角时仍会保留候选并标记风险，不伪装成完美分割。
- 裁剪外扩从 6% 降至一般 3%，贴边候选降至 1.5%，减少把相邻家具额外带入输入。
- iOS 17+ 接入 Apple Vision `VNGenerateForegroundInstanceMaskRequest`。按目标投影框中心选择前景实例，生成透明背景 PNG；Vision 失败或中心不是有效实例时自动回退几何裁剪 JPEG。`CropRecord.method` 明确记录是否实际使用实例遮罩，并保存 edgeDistance / neighborOverlap 诊断值。
- Rodin 提示词进一步明确只生成目标中心对象，禁止合并、复制或重建部分可见的相邻同类家具。

Vision 的实例分割是更泛化的方案，但并非所有图像都能把相互接触或严重遮挡的家具拆开；因此最终仍建议扫描时给每件家具至少一张正面、留边、无遮挡画面。若所有视角都把两把椅子紧密压在一起，程序只能降级提示，不能从单张 RGB 图凭空恢复被遮挡的真实边界。

### 当前数据的处理边界

当前方向扫描已经生成的异常模型不会自动被新 iOS 裁剪逻辑重算；它的输入是在旧版本生成的。下次用新 App 扫描/导入后，候选选择和 Vision PNG 才会生效。旧模型可以保留用于对比，不会悄悄覆盖用户已摆放的家具。

## 验证

- `npm run build` 通过，宏观开关和天花板新增无 TypeScript 错误。
- `npm run verify:solar` 通过，新增检查：6 秒日夜推进恰好跨一天、10 秒四季推进恰好跨四分之一年，前端真实方向与后端北向一致。
- `npm run verify:scan` 通过：31 面墙板、1 个 ceiling、地板世界边界精确匹配扫描多边形、1.5m 出生点、碰撞和编辑保留。
- `npm run verify:walls` 通过：透明墙 BSP 排序与渐变不回归。
- `verify-direction-scan.py`、`verify-scene-models.py --require-complete` 通过：170 组方向配对、WMM 修正、7/7 高低模尺寸/纹理/接口检查。
- `python app/scripts/validate-project.py` 通过 Swift/Xcode 静态检查；Windows 无 Apple SDK，Vision 真机实例分割仍需 Mac + iOS 设备验收。
- 浏览器控制无可用实例，未完成动态画面目视检查；前后端页面和健康接口保持 HTTP 200。

公开方案依据：Apple [VNGenerateForegroundInstanceMaskRequest](https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest)、[VNInstanceMaskObservation](https://developer.apple.com/documentation/vision/vninstancemaskobservation)、Apple WWDC23 Subject Lifting，以及已有 `BoxProjection` 的 3D OBB 投影链路。
