import XCTest
import simd
@testable import RoomCanvas

final class ProjectionTests: XCTestCase {
    private func frame(rotated: Bool = false) -> CameraFrameRecord {
        CameraFrameRecord(id: "test", timestamp: 1, imagePath: "frames/test.jpg",
                          imageWidth: rotated ? 800 : 1000, imageHeight: rotated ? 1000 : 800,
                          nativeImageWidth: 1000, nativeImageHeight: 800,
                          cameraToWorld: MatrixValues.array(matrix_identity_float4x4),
                          intrinsics: [500, 0, 0, 0, 500, 0, 500, 400, 1],
                          nativePixelToSavedPixel: rotated ? [0, 1, 0, -1, 0, 0, 800, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1],
                          trackingState: "normal", sharpness: 8, lightIntensity: nil, manuallyRequested: false, depth: nil)
    }

    private func object(z: Float = -5, x: Float = 0) -> FurnitureRecord {
        var transform = matrix_identity_float4x4
        transform.columns.3 = SIMD4(x, 0, z, 1)
        return FurnitureRecord(id: "test", category: "table", confidence: "high", dimensions: [2, 2, 2],
                               objectToWorld: MatrixValues.array(transform), parentIdentifier: nil, rawMetadataPath: "raw.json")
    }

    func testCenteredObjectProjectsWithExpectedMargin() throws {
        let result = try XCTUnwrap(BoxProjection.project(object: object(), frame: frame()))
        XCTAssertEqual(result.rectangle, PixelRectangle(x: 360, y: 260, width: 280, height: 280))
        XCTAssertEqual(result.visibleFraction, 1, accuracy: 0.0001)
    }

    func testPortraitRotationMatchesSavedImageCoordinates() throws {
        let result = try XCTUnwrap(BoxProjection.project(object: object(), frame: frame(rotated: true)))
        XCTAssertEqual(result.rectangle, PixelRectangle(x: 260, y: 360, width: 280, height: 280))
    }

    func testObjectBehindCameraIsRejected() {
        XCTAssertNil(BoxProjection.project(object: object(z: 5), frame: frame()))
    }

    func testEdgeAndNeighborSignalsPreferCleanFurnitureViews() throws {
        let projected = try XCTUnwrap(BoxProjection.project(object: object(), frame: frame()))
        let edge = PixelRectangle(x: 0, y: projected.rectangle.y, width: projected.rectangle.width, height: projected.rectangle.height)
        let overlap = BoxProjection.intersectionRatio(projected.rectangle, edge)
        XCTAssertGreaterThan(overlap, 0.9)
        XCTAssertGreaterThan(projected.edgeDistance, 0)
    }

    func testSmallAndOffscreenObjectsAreRejected() {
        XCTAssertNil(BoxProjection.project(object: object(z: -100), frame: frame()))
        XCTAssertNil(BoxProjection.project(object: object(x: 50), frame: frame()))
    }

    func testCameraAndObjectTranslationPreserveProjection() throws {
        var camera = frame()
        camera.cameraToWorld[12] = 3
        camera.cameraToWorld[13] = 2
        camera.cameraToWorld[14] = 7
        var furniture = object()
        furniture.objectToWorld[12] = 3
        furniture.objectToWorld[13] = 2
        furniture.objectToWorld[14] = 2
        let expected = try XCTUnwrap(BoxProjection.project(object: object(), frame: frame()))
        let actual = try XCTUnwrap(BoxProjection.project(object: furniture, frame: camera))
        XCTAssertEqual(expected.rectangle, actual.rectangle)
    }

    func testNearPlaneClippingNeverReturnsInfiniteBounds() {
        if let result = BoxProjection.project(object: object(z: -0.5), frame: frame()) {
            XCTAssertTrue(result.rectangle.values.allSatisfy(\.isFinite))
            XCTAssertGreaterThanOrEqual(result.rectangle.x, 0)
            XCTAssertLessThanOrEqual(result.rectangle.x + result.rectangle.width, 1000)
        }
    }

    func testMalformedMatricesAndDimensionsAreRejected() {
        var value = object()
        value.objectToWorld = []
        XCTAssertNil(BoxProjection.project(object: value, frame: frame()))
        value = object(); value.dimensions = [1, -1, 2]
        XCTAssertNil(BoxProjection.project(object: value, frame: frame()))
        var camera = frame(); camera.cameraToWorld = Array(repeating: 0, count: 16)
        XCTAssertNil(BoxProjection.project(object: object(), frame: camera))
    }
}
