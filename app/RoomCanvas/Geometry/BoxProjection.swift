import Foundation
import simd

struct PixelRectangle: Codable, Equatable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var area: Double { width * height }
    var values: [Double] { [x, y, width, height] }
}

struct ProjectedBox {
    var rectangle: PixelRectangle
    var visibleFraction: Double
    var centerDistance: Double
    var score: Double
}

enum BoxProjection {
    static let nearPlane: Float = 0.05

    static func project(object: FurnitureRecord, frame: CameraFrameRecord) -> ProjectedBox? {
        guard object.dimensions.count == 3,
              object.dimensions.allSatisfy({ $0.isFinite && $0 > 0 }),
              let objectToWorld = MatrixValues.matrix4(object.objectToWorld),
              let cameraToWorld = MatrixValues.matrix4(frame.cameraToWorld),
              abs(simd_determinant(cameraToWorld)) > 0.00001,
              frame.intrinsics.count == 9, frame.nativePixelToSavedPixel.count == 9,
              frame.intrinsics.allSatisfy({ $0.isFinite }),
              frame.nativePixelToSavedPixel.allSatisfy({ $0.isFinite }),
              frame.imageWidth > 0, frame.imageHeight > 0 else { return nil }

        let cameraFromObject = simd_inverse(cameraToWorld) * objectToWorld
        let half = SIMD3<Float>(object.dimensions[0], object.dimensions[1], object.dimensions[2]) / 2
        var vertices: [SIMD3<Float>] = []
        for index in 0..<8 {
            let p = SIMD4<Float>((index & 1 == 0 ? -1 : 1) * half.x,
                                 (index & 2 == 0 ? -1 : 1) * half.y,
                                 (index & 4 == 0 ? -1 : 1) * half.z, 1)
            let camera = cameraFromObject * p
            // ARKit camera looks down -Z; image coordinates use +Z forward and +Y down.
            vertices.append(SIMD3(camera.x, -camera.y, -camera.z))
        }
        var clipped = vertices.filter { $0.z >= nearPlane }
        for index in 0..<8 {
            for bit in [1, 2, 4] where index & bit == 0 {
                let a = vertices[index]
                let b = vertices[index | bit]
                if (a.z < nearPlane) != (b.z < nearPlane) {
                    let t = (nearPlane - a.z) / (b.z - a.z)
                    clipped.append(a + t * (b - a))
                }
            }
        }
        guard !clipped.isEmpty else { return nil }
        let k = frame.intrinsics
        let image = frame.nativePixelToSavedPixel
        let pixels = clipped.map { point -> SIMD2<Double> in
            let u = Double(k[0] * point.x / point.z + k[3] * point.y / point.z + k[6])
            let v = Double(k[1] * point.x / point.z + k[4] * point.y / point.z + k[7])
            return SIMD2(Double(image[0]) * u + Double(image[3]) * v + Double(image[6]),
                         Double(image[1]) * u + Double(image[4]) * v + Double(image[7]))
        }
        guard pixels.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
              let minX = pixels.map(\.x).min(), let maxX = pixels.map(\.x).max(),
              let minY = pixels.map(\.y).min(), let maxY = pixels.map(\.y).max() else { return nil }
        let rawArea = (maxX - minX) * (maxY - minY)
        guard rawArea > 1 else { return nil }
        let width = Double(frame.imageWidth), height = Double(frame.imageHeight)
        let x0 = max(0, minX), y0 = max(0, minY)
        let x1 = min(width, maxX), y1 = min(height, maxY)
        guard x1 > x0, y1 > y0 else { return nil }
        let visibleFraction = ((x1 - x0) * (y1 - y0)) / rawArea
        // Reject tiny or heavily truncated views instead of claiming a successful furniture crop.
        guard visibleFraction >= 0.65, x1 - x0 >= 64, y1 - y0 >= 64 else { return nil }
        let marginX = (x1 - x0) * 0.06, marginY = (y1 - y0) * 0.06
        let left = floor(max(0, x0 - marginX)), top = floor(max(0, y0 - marginY))
        let right = ceil(min(width, x1 + marginX)), bottom = ceil(min(height, y1 + marginY))
        let rectangle = PixelRectangle(x: left, y: top, width: right - left, height: bottom - top)
        let center = cameraFromObject.columns.3
        let distance = Double(simd_length(SIMD3(center.x, center.y, center.z)))
        let areaRatio = ((x1 - x0) * (y1 - y0)) / (width * height)
        let centrality = max(0.15, 1 - hypot((x0 + x1) / 2 / width - 0.5, (y0 + y1) / 2 / height - 0.5))
        let sharpnessWeight = min(1.5, max(0.2, frame.sharpness / 8))
        return ProjectedBox(rectangle: rectangle, visibleFraction: visibleFraction,
                            centerDistance: distance,
                            score: visibleFraction * sqrt(areaRatio) * centrality * sharpnessWeight)
    }
}
