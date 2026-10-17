import Foundation
import simd

enum HeadingAlignment {
    static func north(portraitCameraToWorld: simd_float4x4, northReferenceToDevice: simd_float3x3) -> SIMD3<Float>? {
        let camera = simd_float3x3(columns: (
            SIMD3(portraitCameraToWorld.columns.0.x, portraitCameraToWorld.columns.0.y, portraitCameraToWorld.columns.0.z),
            SIMD3(portraitCameraToWorld.columns.1.x, portraitCameraToWorld.columns.1.y, portraitCameraToWorld.columns.1.z),
            SIMD3(portraitCameraToWorld.columns.2.x, portraitCameraToWorld.columns.2.y, portraitCameraToWorld.columns.2.z)
        ))
        // Core Motion maps its north/west/up reference into device coordinates.
        // The portrait AR view inverse maps those same device axes into AR world.
        let world = camera * northReferenceToDevice
        guard MatrixValues.array(world).allSatisfy({ $0.isFinite }),
              simd_dot(world.columns.2, SIMD3<Float>(0, 1, 0)) > 0.96 else { return nil }
        let horizontal = SIMD3(world.columns.0.x, 0, world.columns.0.z)
        guard simd_length(horizontal) > 0.9 else { return nil }
        return simd_normalize(horizontal)
    }

    static func summarize(_ samples: [CompassSample], location: ScanLocation?) -> ScanOrientation? {
        let trueSamples = samples.filter { $0.reference == "true-north" }
        let candidates = trueSamples.count >= 5 ? trueSamples : samples.filter { $0.reference == "magnetic-north" }
        guard candidates.count >= 5 else { return nil }
        func vector(_ sample: CompassSample) -> SIMD3<Double> {
            SIMD3(Double(sample.northInWorld[0]), 0, Double(sample.northInWorld[2]))
        }
        func weight(_ sample: CompassSample) -> Double { 1 / pow(max(3, sample.headingAccuracyDegrees), 2) }
        let initial = candidates.reduce(SIMD3<Double>.zero) { $0 + vector($1) * weight($1) }
        guard simd_length(initial) > 0.00001 else { return nil }
        let axis = simd_normalize(initial)
        let accepted = candidates.filter { simd_dot(vector($0), axis) >= cos(20 * .pi / 180) }
        guard accepted.count >= 5 else { return nil }
        let totalWeight = accepted.reduce(0.0) { $0 + weight($1) }
        let sum = accepted.reduce(SIMD3<Double>.zero) { $0 + vector($1) * weight($1) }
        let coherence = simd_length(sum) / totalWeight
        guard coherence >= 0.94 else { return nil }
        let north = simd_normalize(sum)
        let east = simd_cross(north, SIMD3<Double>(0, 1, 0))
        func values(_ vector: SIMD3<Double>) -> [Float] { [Float(vector.x), Float(vector.y), Float(vector.z)] }
        return ScanOrientation(
            reference: accepted[0].reference, northInWorld: values(north), eastInWorld: values(east),
            southInWorld: values(-north), westInWorld: values(-east),
            accuracyDegrees: accepted.map(\.headingAccuracyDegrees).max() ?? 25,
            sampleCount: accepted.count, coherence: coherence,
            utcOffsetMinutes: TimeZone.current.secondsFromGMT() / 60,
            timeZoneIdentifier: TimeZone.current.identifier, location: location
        )
    }
}
