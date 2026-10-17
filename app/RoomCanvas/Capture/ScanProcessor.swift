import Foundation
import CoreImage
import RoomPlan
import simd
import UIKit
import Vision

enum ScanProcessor {
    static func process(raw: CapturedRoomData, manifest initial: ScanManifest,
                        frames inputFrames: [CameraFrameRecord], warnings: [String], directory: URL) async throws -> ScanManifest {
        var manifest = initial
        manifest.status = .processing
        manifest.frameCount = inputFrames.count
        manifest.warnings += warnings
        try ScanFiles.write(manifest, to: directory.appendingPathComponent("manifest.json"))
        // Preserve Apple's result before any camera processing. Its optional
        // JSON representation must not prevent RoomBuilder from using the data.
        do { try ScanFiles.write(raw, to: directory.appendingPathComponent("roomplan.raw.json")) }
        catch { manifest.warnings.append("原始 RoomPlan JSON 保存失败，仍尝试构建房间：\(error.localizedDescription)") }
        let saved = try ScanFiles.saveCameraFrames(inputFrames, directory: directory)
        let frames = saved.frames
        manifest.frameCount = frames.count
        manifest.warnings += saved.warnings
        try ScanFiles.refreshFiles(&manifest, directory: directory)
        let builder = RoomBuilder(options: [])
        let room: CapturedRoom
        do { room = try await builder.capturedRoom(from: raw) }
        catch { throw ScanError.message("RoomBuilder 构建最终房间失败：\(error.localizedDescription)") }
        do { try ScanFiles.write(room, to: directory.appendingPathComponent("roomplan.json")) }
        catch { manifest.warnings.append("完整 RoomPlan JSON 保存失败，仍保留有效结构与家具：\(error.localizedDescription)") }
        var surfaces: [SurfaceRecord] = []
        for (kind, items) in [("wall", room.walls), ("door", room.doors), ("window", room.windows),
                              ("opening", room.openings), ("floor", room.floors)] {
            for surface in items {
                let path = "surfaces/\(surface.identifier.uuidString).json"
                try ScanFiles.createDirectory(directory.appendingPathComponent("surfaces"))
                guard MatrixValues.matrix4(MatrixValues.array(surface.transform)) != nil,
                      [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z].allSatisfy({ $0.isFinite }),
                      surface.polygonCorners.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else {
                    manifest.warnings.append("已跳过无效 \(kind) 结构 \(surface.identifier)：坐标/尺寸含非有限值。")
                    continue
                }
                do { try ScanFiles.write(surface, to: directory.appendingPathComponent(path)) }
                catch { manifest.warnings.append("结构保存失败：\(error.localizedDescription)"); continue }
                surfaces.append(SurfaceRecord(
                    id: surface.identifier.uuidString, kind: kind,
                    dimensions: [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z],
                    surfaceToWorld: MatrixValues.array(surface.transform),
                    parentIdentifier: surface.parentIdentifier?.uuidString,
                    polygonCorners: surface.polygonCorners.map { [$0.x, $0.y, $0.z] }, rawMetadataPath: path
                ))
            }
        }
        let previousScene = try? ScanFiles.read(SceneRecord.self, at: directory.appendingPathComponent("scene.json"))
        var objects: [FurnitureRecord] = []
        for object in room.objects {
            try Task.checkCancellation()
            let folder = "objects/\(object.identifier.uuidString)"
            try ScanFiles.createDirectory(directory.appendingPathComponent(folder))
            let rawPath = "\(folder)/roomplan-object.json"
            guard MatrixValues.matrix4(MatrixValues.array(object.transform)) != nil,
                  [object.dimensions.x, object.dimensions.y, object.dimensions.z].allSatisfy({ $0.isFinite && $0 > 0 }) else {
                manifest.warnings.append("已跳过无效家具 \(object.identifier)：坐标/尺寸含非有限值或尺寸不大于零。")
                continue
            }
            do { try ScanFiles.write(object, to: directory.appendingPathComponent(rawPath)) }
            catch { manifest.warnings.append("家具保存失败：\(error.localizedDescription)"); continue }
            var record = FurnitureRecord(
                id: object.identifier.uuidString, category: categoryName(object.category),
                confidence: String(describing: object.confidence),
                dimensions: [object.dimensions.x, object.dimensions.y, object.dimensions.z],
                objectToWorld: MatrixValues.array(object.transform),
                parentIdentifier: object.parentIdentifier?.uuidString, rawMetadataPath: rawPath
            )
            record.supplementalImages = previousScene?.objects.first(where: { $0.id == record.id })?.supplementalImages ?? []
            let candidates = frames.filter { $0.trackingState == "normal" }.compactMap { frame -> (CameraFrameRecord, ProjectedBox)? in
                guard let projected = BoxProjection.project(object: record, frame: frame) else { return nil }
                let overlap = room.objects.compactMap { peer -> Double? in
                    guard peer.identifier != object.identifier else { return nil }
                    let peerRecord = FurnitureRecord(id: peer.identifier.uuidString, category: categoryName(peer.category), confidence: String(describing: peer.confidence), dimensions: [peer.dimensions.x, peer.dimensions.y, peer.dimensions.z], objectToWorld: MatrixValues.array(peer.transform), parentIdentifier: peer.parentIdentifier?.uuidString, rawMetadataPath: "")
                    return BoxProjection.project(object: peerRecord, frame: frame).map { BoxProjection.intersectionRatio(projected.rectangle, $0.rectangle) }
                }.max() ?? 0
                var adjusted = projected
                adjusted.neighborOverlap = overlap
                // Similar neighboring furniture inside the projected box is a
                // strong signal that this view will make an image-to-3D model
                // merge objects. Penalize it while retaining a fallback view.
                adjusted.score *= max(0.08, 1 - min(0.82, overlap * 1.7))
                return (frame, adjusted)
            }.sorted { $0.1.score > $1.1.score }

            var chosenPositions: [SIMD3<Float>] = []
            for (frame, projection) in candidates {
                if record.crops.count >= 3 { break }
                let values = frame.cameraToWorld
                let position = SIMD3(values[12], values[13], values[14])
                if chosenPositions.contains(where: { simd_distance($0, position) < 0.2 }) { continue }
                do {
                    let crop = try saveCrop(frame: frame, projection: projection,
                                            folder: folder, index: record.crops.count + 1, directory: directory)
                    record.crops.append(crop)
                    chosenPositions.append(position)
                } catch { manifest.warnings.append("\(record.displayName) / \(frame.id) 裁剪失败：\(error.localizedDescription)") }
            }
            record.cropStatus = record.crops.isEmpty ? "no-suitable-frame" : "needs-review"
            try ScanFiles.write(record, to: directory.appendingPathComponent("\(folder)/metadata.json"))
            objects.append(record)
        }
        let scene = SceneRecord(scanId: manifest.id, roomIdentifier: room.identifier.uuidString,
                                surfaces: surfaces, objects: objects, orientation: manifest.orientation)
        try ScanFiles.write(scene, to: directory.appendingPathComponent("scene.json"))
        do {
            try room.export(to: directory.appendingPathComponent("room.usdz"), exportOptions: .mesh)
        } catch { manifest.warnings.append("USDZ 网格导出失败，JSON 与家具素材已保留：\(error.localizedDescription)") }
        do {
            try room.export(to: directory.appendingPathComponent("room-parametric.usdz"), exportOptions: .parametric)
        } catch { manifest.warnings.append("参数化 USDZ 导出失败：\(error.localizedDescription)") }
        if frames.isEmpty { manifest.warnings.append("没有成功保存相机关键帧；无法自动生成家具裁剪图。") }
        if !frames.contains(where: { $0.depth != nil }) {
            manifest.warnings.append("底层会话未提供可保存的 sceneDepth，未修改 RoomPlan 的 AR 配置以强制开启。")
        }
        manifest.objectCount = objects.count
        manifest.croppedObjectCount = objects.filter { !$0.crops.isEmpty }.count
        manifest.previewImagePath = objects.compactMap { $0.crops.first?.imagePath }.first ?? frames.first?.imagePath
        let missing = manifest.objectCount - manifest.croppedObjectCount
        if missing > 0 { manifest.warnings.append("\(missing) 件物品没有合适的可见关键帧，已保留参数并标记待补拍。") }
        manifest.warnings.append("家具图像来自三维包围盒投影，可能含背景或遮挡；需人工核对，不是物体分割。")
        manifest.status = .complete
        try ScanFiles.refreshFiles(&manifest, directory: directory)
        return manifest
    }

    private static func saveCrop(frame: CameraFrameRecord, projection: ProjectedBox,
                                 folder: String, index: Int, directory: URL) throws -> CropRecord {
        let rectangle = projection.rectangle
        let sourceURL = directory.appendingPathComponent(frame.imagePath)
        guard let image = UIImage(contentsOfFile: sourceURL.path), let source = image.cgImage else {
            throw ScanError.message("无法读取关键帧。")
        }
        let rect = CGRect(x: CGFloat(rectangle.x), y: CGFloat(rectangle.y), width: CGFloat(rectangle.width), height: CGFloat(rectangle.height))
        guard let cropped = source.cropping(to: rect) else {
            throw ScanError.message("裁剪范围无效。")
        }
        let segmentation = try? foregroundCrop(source: source, crop: rect)
        let outputImage = segmentation ?? UIImage(cgImage: cropped)
        guard let data = segmentation != nil ? outputImage.pngData() : outputImage.jpegData(compressionQuality: 0.94) else {
            throw ScanError.message("无法编码家具裁剪图。")
        }
        let imagePath = "\(folder)/crop_\(index).\(segmentation != nil ? "png" : "jpg")"
        let overlayPath = "\(folder)/context_\(index).jpg"
        try data.write(to: directory.appendingPathComponent(imagePath), options: .atomic)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: CGFloat(source.width), height: CGFloat(source.height)), format: format)
        let overlay = renderer.image { drawing in
            image.draw(in: CGRect(x: 0, y: 0, width: CGFloat(source.width), height: CGFloat(source.height)))
            drawing.cgContext.setStrokeColor(UIColor.systemGreen.cgColor)
            drawing.cgContext.setLineWidth(max(3, CGFloat(source.width) / 240))
            drawing.cgContext.stroke(rect)
        }
        guard let overlayData = overlay.jpegData(compressionQuality: 0.85) else { throw ScanError.message("无法生成框选预览。") }
        try overlayData.write(to: directory.appendingPathComponent(overlayPath), options: .atomic)
        return CropRecord(frameId: frame.id, imagePath: imagePath, overlayPath: overlayPath,
                          rectanglePixels: rectangle.values, visibleFraction: projection.visibleFraction, score: projection.score,
                          edgeDistance: projection.edgeDistance, neighborOverlap: projection.neighborOverlap,
                          method: segmentation != nil ? "projected-3d-obb+vision-instance-mask" : "projected-3d-obb")
    }

    /// Vision's foreground instance mask separates adjacent chairs when the
    /// image contains enough visual contrast. If it cannot identify the target
    /// instance, the geometry crop remains the safe fallback.
    private static func foregroundCrop(source: CGImage, crop: CGRect) throws -> UIImage? {
        let handler = VNImageRequestHandler(cgImage: source, orientation: .up)
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        guard let observation = request.results?.first else { return nil }
        let lowMask = observation.instanceMask
        let maskWidth = CVPixelBufferGetWidth(lowMask)
        let maskHeight = CVPixelBufferGetHeight(lowMask)
        CVPixelBufferLockBaseAddress(lowMask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(lowMask, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(lowMask) else { return nil }
        let rowBytes = CVPixelBufferGetBytesPerRow(lowMask)
        let centerX = min(maskWidth - 1, max(0, Int((crop.midX / CGFloat(source.width) * CGFloat(maskWidth)).rounded())))
        let centerY = min(maskHeight - 1, max(0, Int((crop.midY / CGFloat(source.height) * CGFloat(maskHeight)).rounded())))
        let labels = base.assumingMemoryBound(to: UInt8.self)
        let instance = Int(labels[centerY * rowBytes + centerX])
        guard instance > 0, observation.allInstances.contains(instance) else { return nil }
        let maskBuffer = try observation.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler)
        let input = CIImage(cgImage: source)
        let mask = CIImage(cvPixelBuffer: maskBuffer)
        let clear = CIImage(color: .clear).cropped(to: input.extent)
        let output = input.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: clear,
            kCIInputMaskImageKey: mask,
        ])
        let context = CIContext(options: [.cacheIntermediates: false])
        let croppedOutput = output.cropped(to: crop)
        guard let result = context.createCGImage(croppedOutput, from: croppedOutput.extent) else { return nil }
        return UIImage(cgImage: result)
    }

    static func categoryName(_ category: CapturedRoom.Object.Category) -> String {
        switch category {
        case .bathtub: return "bathtub"
        case .bed: return "bed"
        case .chair: return "chair"
        case .dishwasher: return "dishwasher"
        case .fireplace: return "fireplace"
        case .oven: return "oven"
        case .refrigerator: return "refrigerator"
        case .sink: return "sink"
        case .sofa: return "sofa"
        case .stairs: return "stairs"
        case .storage: return "storage"
        case .stove: return "stove"
        case .table: return "table"
        case .television: return "television"
        case .toilet: return "toilet"
        case .washerDryer: return "washerDryer"
        @unknown default: return String(describing: category)
        }
    }
}
