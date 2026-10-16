import Foundation
import simd

enum ScanStatus: String, Codable {
    case capturing, processing, complete, interrupted, failed

    var title: String {
        switch self {
        case .capturing: return "扫描中"
        case .processing: return "整理中"
        case .complete: return "已完成"
        case .interrupted: return "扫描已中断"
        case .failed: return "处理未完成"
        }
    }
}

struct ScanManifest: Codable, Identifiable {
    var schemaVersion = "roomcanvas.scan.v1"
    var id: UUID
    var title: String
    var createdAt: Date
    var status: ScanStatus
    var device: String
    var systemVersion: String
    var appVersion = "1.0.0"
    var objectCount = 0
    var frameCount = 0
    var croppedObjectCount = 0
    var previewImagePath: String?
    var warnings: [String] = []
    var files: [String] = []
    var capturePolicy = CapturePolicy()
}

struct CapturePolicy: Codable {
    var automaticIntervalSeconds = 0.8
    var maximumFrames = 300
    var maximumImageEdge = 1920
    var imageFormat = "jpeg"
    var savesAvailableSceneDepth = true
    var imageOrientation = "portrait; native image rotated 90 degrees clockwise"
    var cropMethod = "final oriented bounding box projected into recorded RGB frames; not segmentation"
}

struct SceneRecord: Codable {
    var schemaVersion = "roomcanvas.scene.v1"
    var scanId: UUID
    var units = "meters"
    var coordinateSystem = "ARKit right-handed, Y-up, original session world space"
    var matrixLayout = "column-major"
    var roomIdentifier: String
    var surfaces: [SurfaceRecord]
    var objects: [FurnitureRecord]
}

struct SurfaceRecord: Codable, Identifiable {
    var id: String
    var kind: String
    var dimensions: [Float]
    var surfaceToWorld: [Float]
    var parentIdentifier: String?
    var polygonCorners: [[Float]]
    var rawMetadataPath: String
}

struct FurnitureRecord: Codable, Identifiable {
    var id: String
    var category: String
    var confidence: String
    var dimensions: [Float]
    var objectToWorld: [Float]
    var parentIdentifier: String?
    var rawMetadataPath: String
    var crops: [CropRecord] = []
    var cropStatus = "no-suitable-frame"
    var supplementalImages: [SupplementalImage] = []

    var displayName: String { CategoryNames.title(category) }
    var sizeDescription: String {
        guard dimensions.count == 3 else { return "尺寸未知" }
        return String(format: "%.2f × %.2f × %.2f m", dimensions[0], dimensions[1], dimensions[2])
    }
}

struct SupplementalImage: Codable, Identifiable {
    var id: String { imagePath }
    var imagePath: String
    var createdAt: Date
    var source = "user-selected-photo-no-camera-pose"
}

struct CropRecord: Codable, Identifiable {
    var id: String { imagePath }
    var frameId: String
    var imagePath: String
    var overlayPath: String
    var rectanglePixels: [Double]
    var visibleFraction: Double
    var score: Double
    var reviewRequired = true
    var method = "projected-3d-obb"
}

struct CameraFrameRecord: Codable, Identifiable {
    var id: String
    var timestamp: TimeInterval
    var imagePath: String
    var imageWidth: Int
    var imageHeight: Int
    var nativeImageWidth: Int
    var nativeImageHeight: Int
    var cameraToWorld: [Float]
    var intrinsics: [Float]
    var nativePixelToSavedPixel: [Float]
    var trackingState: String
    var sharpness: Double
    var lightIntensity: Double?
    var manuallyRequested: Bool
    var depth: DepthRecord?

    func validatedForStorage() throws -> CameraFrameRecord {
        guard timestamp.isFinite else { throw ScanError.message("\(id): timestamp 不是有限数值。") }
        guard let transform = MatrixValues.matrix4(cameraToWorld),
              simd_determinant(transform).isFinite, abs(simd_determinant(transform)) > 0.00001 else {
            throw ScanError.message("\(id): cameraToWorld 含 NaN/Infinity、长度错误或不可逆。")
        }
        guard intrinsics.count == 9, intrinsics.allSatisfy({ $0.isFinite }),
              intrinsics[0] > 0, intrinsics[4] > 0 else {
            throw ScanError.message("\(id): intrinsics 含无效数值或焦距。")
        }
        guard nativePixelToSavedPixel.count == 9,
              nativePixelToSavedPixel.allSatisfy({ $0.isFinite }),
              imageWidth > 0, imageHeight > 0, nativeImageWidth > 0, nativeImageHeight > 0 else {
            throw ScanError.message("\(id): 图像尺寸或 nativePixelToSavedPixel 无效。")
        }
        var value = self
        if !value.sharpness.isFinite || value.sharpness < 0 { value.sharpness = 0 }
        if let intensity = value.lightIntensity, !intensity.isFinite { value.lightIntensity = nil }
        return value
    }
}

struct DepthRecord: Codable {
    var width: Int
    var height: Int
    var depthPath: String
    var confidencePath: String?
    var format = "float32-little-endian, tightly packed rows, meters"
    var confidenceFormat = "uint8, tightly packed rows; 0=low, 1=medium, 2=high"
    var alignment = "native camera image orientation; scale intrinsics to depth resolution"
}

enum CategoryNames {
    static func title(_ value: String) -> String {
        let names = ["bathtub": "浴缸", "bed": "床", "chair": "椅子", "dishwasher": "洗碗机",
                     "fireplace": "壁炉", "oven": "烤箱", "refrigerator": "冰箱", "sink": "水槽",
                     "sofa": "沙发", "stairs": "楼梯", "storage": "储物柜", "stove": "炉灶",
                     "table": "桌子", "television": "电视", "toilet": "马桶", "washerDryer": "洗衣 / 烘干机"]
        return names[value] ?? value
    }
}

enum MatrixValues {
    static func array(_ matrix: simd_float4x4) -> [Float] {
        (0..<4).flatMap { column in (0..<4).map { matrix[column][$0] } }
    }

    static func array(_ matrix: simd_float3x3) -> [Float] {
        (0..<3).flatMap { column in (0..<3).map { matrix[column][$0] } }
    }

    static func matrix4(_ values: [Float]) -> simd_float4x4? {
        guard values.count == 16, values.allSatisfy({ $0.isFinite }) else { return nil }
        return simd_float4x4(columns: (
            SIMD4(values[0], values[1], values[2], values[3]),
            SIMD4(values[4], values[5], values[6], values[7]),
            SIMD4(values[8], values[9], values[10], values[11]),
            SIMD4(values[12], values[13], values[14], values[15])
        ))
    }
}

enum ScanError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): return message }
    }
}
