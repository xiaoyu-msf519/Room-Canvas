import ARKit
import CoreImage
import Foundation
import ImageIO
import RoomPlan
import UIKit

final class FrameRecorder {
    private let queue = DispatchQueue(label: "roomcanvas.frames", qos: .userInitiated)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let directory: URL
    private let policy: CapturePolicy
    private var frames: [CameraFrameRecord] = []
    private var nextFrameNumber = 1
    private var warnings: [String] = []
    private var lastUpdateTimestamp: TimeInterval = -Double.infinity

    init(directory: URL, policy: CapturePolicy) {
        self.directory = directory
        self.policy = policy
    }

    func record(_ frame: ARFrame, manual: Bool, compass: CompassSample? = nil, materialTarget: String? = nil,
                completion: @escaping (Result<Int, Error>) -> Void) {
        queue.async { [self] in
            do {
                guard frames.count < policy.maximumFrames else {
                    throw ScanError.message("已达到 \(policy.maximumFrames) 张关键帧上限，请结束扫描。")
                }
                guard frame.timestamp.isFinite,
                      MatrixValues.array(frame.camera.transform).allSatisfy({ $0.isFinite }),
                      MatrixValues.array(frame.camera.intrinsics).allSatisfy({ $0.isFinite }) else {
                    throw ScanError.message("已跳过相机时间戳/位姿/内参含 NaN 或 Infinity 的帧。")
                }
                let id = String(format: "frame_%04d", nextFrameNumber)
                nextFrameNumber += 1
                let buffer = frame.capturedImage
                let nativeWidth = CVPixelBufferGetWidth(buffer)
                let nativeHeight = CVPixelBufferGetHeight(buffer)
                let original = CIImage(cvPixelBuffer: buffer).oriented(.right)
                let upright = original.transformed(by: CGAffineTransform(
                    translationX: -original.extent.minX, y: -original.extent.minY
                ))
                let scale = min(1, CGFloat(policy.maximumImageEdge) / max(upright.extent.width, upright.extent.height))
                let width = max(1, Int((upright.extent.width * scale).rounded()))
                let height = max(1, Int((upright.extent.height * scale).rounded()))
                let sx = CGFloat(width) / upright.extent.width
                let sy = CGFloat(height) / upright.extent.height
                let image = upright.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
                guard let cgImage = context.createCGImage(image, from: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))),
                      let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.9) else {
                    throw ScanError.message("无法编码相机图像。")
                }
                try ScanFiles.createDirectory(directory.appendingPathComponent("frames"))
                let imagePath = "frames/\(id).jpg"
                try jpeg.write(to: directory.appendingPathComponent(imagePath), options: .atomic)

                var depth: DepthRecord?
                if policy.savesAvailableSceneDepth, let sceneDepth = frame.sceneDepth {
                    do { depth = try saveDepth(sceneDepth, id: id) }
                    catch { warnings.append("\(id) 深度保存失败：\(error.localizedDescription)") }
                }
                let scaleX = Float(width) / Float(nativeHeight)
                let scaleY = Float(height) / Float(nativeWidth)
                let record = try CameraFrameRecord(
                    id: id, timestamp: frame.timestamp, imagePath: imagePath,
                    imageWidth: width, imageHeight: height,
                    nativeImageWidth: nativeWidth, nativeImageHeight: nativeHeight,
                    cameraToWorld: MatrixValues.array(frame.camera.transform),
                    intrinsics: MatrixValues.array(frame.camera.intrinsics),
                    nativePixelToSavedPixel: [0, scaleY, 0, -scaleX, 0, 0, Float(nativeHeight) * scaleX, 0, 1],
                    trackingState: Self.trackingDescription(frame.camera.trackingState),
                    sharpness: Self.edgeEnergy(buffer),
                    lightIntensity: frame.lightEstimate.map { Double($0.ambientIntensity) },
                    manuallyRequested: manual, depth: depth, compass: compass, materialTarget: materialTarget,
                    photometry: FramePhotometry(
                        exposureDurationSeconds: frame.camera.exposureDuration,
                        exposureOffset: Double(frame.camera.exposureOffset),
                        ambientColorTemperatureKelvin: frame.lightEstimate.map { Double($0.ambientColorTemperature) }
                    )
                ).validatedForStorage()
                try ScanFiles.write(record, to: directory.appendingPathComponent("frames/\(id).json"))
                let updatedFrames = frames + [record]
                try ScanFiles.write(updatedFrames, to: directory.appendingPathComponent("cameras.json"))
                frames = updatedFrames
                let count = frames.count
                DispatchQueue.main.async { completion(.success(count)) }
            } catch {
                warnings.append(error.localizedDescription)
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    func logRoomUpdate(_ room: CapturedRoom, timestamp: TimeInterval) {
        queue.async { [self] in
            guard timestamp - lastUpdateTimestamp >= 1 else { return }
            lastUpdateTimestamp = timestamp
            do {
                let encoder = JSONEncoder()
                let roomData = try encoder.encode(room)
                let roomJSON = try JSONSerialization.jsonObject(with: roomData)
                var line = try JSONSerialization.data(withJSONObject: ["timestamp": timestamp, "room": roomJSON], options: [.sortedKeys])
                line.append(0x0a)
                let url = directory.appendingPathComponent("room-updates.jsonl")
                if !FileManager.default.fileExists(atPath: url.path) {
                    try Data().write(to: url)
                }
                let file = try FileHandle(forWritingTo: url)
                defer { try? file.close() }
                try file.seekToEnd()
                try file.write(contentsOf: line)
            } catch { warnings.append("扫描过程记录失败：\(error.localizedDescription)") }
        }
    }

    func flush(completion: @escaping ([CameraFrameRecord], [String]) -> Void) {
        queue.async { [self] in
            let snapshot = frames, problems = Array(Set(warnings)).sorted()
            DispatchQueue.main.async { completion(snapshot, problems) }
        }
    }

    private func saveDepth(_ depth: ARDepthData, id: String) throws -> DepthRecord {
        let map = depth.depthMap
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32 else {
            throw ScanError.message("深度像素格式不是 Float32。")
        }
        let folder = directory.appendingPathComponent("depth")
        try ScanFiles.createDirectory(folder)
        let path = "depth/\(id).f32"
        try Self.packedData(map, bytesPerPixel: 4).write(to: directory.appendingPathComponent(path), options: .atomic)
        var confidencePath: String?
        if let confidence = depth.confidenceMap {
            let confidenceFile = "depth/\(id).confidence.u8"
            try Self.packedData(confidence, bytesPerPixel: 1).write(
                to: directory.appendingPathComponent(confidenceFile), options: .atomic
            )
            confidencePath = confidenceFile
        }
        return DepthRecord(width: CVPixelBufferGetWidth(map), height: CVPixelBufferGetHeight(map),
                           depthPath: path, confidencePath: confidencePath)
    }

    private static func packedData(_ buffer: CVPixelBuffer, bytesPerPixel: Int) throws -> Data {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw ScanError.message("无法读取深度缓存。") }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        var data = Data(capacity: width * height * bytesPerPixel)
        for row in 0..<height {
            data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width * bytesPerPixel)
        }
        return data
    }

    static func trackingDescription(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .normal: return "normal"
        case .notAvailable: return "notAvailable"
        case .limited(let reason): return "limited:\(reason)"
        }
    }

    private static func edgeEnergy(_ buffer: CVPixelBuffer) -> Double {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard CVPixelBufferGetPlaneCount(buffer) > 0,
              let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return 8 }
        let width = CVPixelBufferGetWidthOfPlane(buffer, 0), height = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        let values = base.assumingMemoryBound(to: UInt8.self)
        var sum: Double = 0, count = 0
        guard width > 4, height > 4 else { return 0 }
        for y in Swift.stride(from: 2, to: height - 2, by: 12) {
            for x in Swift.stride(from: 2, to: width - 2, by: 12) {
                let center = Int(values[y * stride + x])
                let laplacian = 4 * center - Int(values[y * stride + x - 1]) - Int(values[y * stride + x + 1])
                    - Int(values[(y - 1) * stride + x]) - Int(values[(y + 1) * stride + x])
                sum += Double(abs(laplacian)); count += 1
            }
        }
        return count > 0 ? sum / Double(count) : 0
    }
}
