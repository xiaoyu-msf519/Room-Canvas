import XCTest
import simd
@testable import RoomCanvas

final class HeadingAlignmentTests: XCTestCase {
    func testNorthIsIndependentOfDeviceYawAndTilt() throws {
        // Reference X=north, Y=west, Z=up; AR X=east, Y=up, -Z=north.
        let referenceToWorld = simd_float3x3(columns: (SIMD3(0, 0, -1), SIMD3(-1, 0, 0), SIMD3(0, 1, 0)))
        for axis in [SIMD3<Float>(1, 0, 0), SIMD3<Float>(0, 1, 0), simd_normalize(SIMD3<Float>(1, 2, 3))] {
            for angle in [Float(0), 0.7, 1.57, 2.4] {
                let deviceToWorld = simd_float3x3(simd_quatf(angle: angle, axis: axis))
                let referenceToDevice = deviceToWorld.transpose * referenceToWorld
                var pose = matrix_identity_float4x4
                pose.columns.0 = SIMD4(deviceToWorld.columns.0, 0)
                pose.columns.1 = SIMD4(deviceToWorld.columns.1, 0)
                pose.columns.2 = SIMD4(deviceToWorld.columns.2, 0)
                let north = try XCTUnwrap(HeadingAlignment.north(portraitCameraToWorld: pose, northReferenceToDevice: referenceToDevice))
                XCTAssertEqual(north.x, 0, accuracy: 0.0001)
                XCTAssertEqual(north.z, -1, accuracy: 0.0001)
            }
        }
    }

    func testGravityMismatchIsRejected() {
        XCTAssertNil(HeadingAlignment.north(portraitCameraToWorld: matrix_identity_float4x4, northReferenceToDevice: matrix_identity_float3x3))
    }

    func testCircularMeanKeepsNorthAcross359AndZero() throws {
        let samples = [Float(359), 0, 1, 359, 0, 1].map { angle -> CompassSample in
            let radians = angle * .pi / 180
            return CompassSample(arTimestamp: 1, motionTimestamp: 1, headingTimestamp: Date(),
                reference: "true-north", headingDegrees: Double(angle), headingAccuracyDegrees: 5,
                northInWorld: [sin(radians), 0, -cos(radians)], portraitCameraToWorld: [], northReferenceToDevice: [])
        }
        let result = try XCTUnwrap(HeadingAlignment.summarize(samples, location: nil))
        XCTAssertEqual(result.reference, "true-north")
        XCTAssertEqual(result.northInWorld[0], 0, accuracy: 0.001)
        XCTAssertEqual(result.northInWorld[2], -1, accuracy: 0.001)
        XCTAssertGreaterThan(result.eastInWorld[0], 0.99)
        XCTAssertNil(HeadingAlignment.summarize(Array(samples.prefix(4)), location: nil))
    }
}
