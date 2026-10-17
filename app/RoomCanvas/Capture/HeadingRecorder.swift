import ARKit
import CoreLocation
import CoreMotion
import Foundation
import simd

final class HeadingRecorder: NSObject, CLLocationManagerDelegate {
    var onStatus: ((String) -> Void)?
    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private weak var session: ARSession?
    private var running = false
    private var reference = "magnetic-north"
    private var samples: [CompassSample] = []
    private var lastTimestamp: TimeInterval = -.infinity
    private var location: ScanLocation?
    private var latestMotion: CMDeviceMotion?

    func start(session: ARSession) {
        self.session = session
        running = true
        locationManager.delegate = self
        locationManager.headingOrientation = .portrait
        locationManager.headingFilter = 2
        locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
        locationManager.distanceFilter = 100
        if locationManager.authorizationStatus == .notDetermined { locationManager.requestWhenInUseAuthorization() }
        updateLocationService()
        if CLLocationManager.headingAvailable() { locationManager.startUpdatingHeading() }
        startMotion(trueNorth: false)
    }

    private func updateLocationService() {
        guard running else { return }
        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: locationManager.startUpdatingLocation()
        default:
            locationManager.stopUpdatingLocation()
            if reference == "true-north" { startMotion(trueNorth: false) }
            onStatus?("朝向：等待定位授权，暂用磁北")
        }
    }

    private func startMotion(trueNorth: Bool) {
        guard running, motionManager.isDeviceMotionAvailable else { onStatus?("朝向：传感器不可用"); return }
        let frame: CMAttitudeReferenceFrame = trueNorth ? .xTrueNorthZVertical : .xMagneticNorthZVertical
        guard CMMotionManager.availableAttitudeReferenceFrames().contains(frame) else {
            onStatus?("朝向：缺少指南针参考系"); return
        }
        motionManager.stopDeviceMotionUpdates()
        latestMotion = nil
        reference = trueNorth ? "true-north" : "magnetic-north"
        let capturedReference = reference
        motionManager.deviceMotionUpdateInterval = 0.05
        motionManager.showsDeviceMovementDisplay = true
        motionManager.startDeviceMotionUpdates(using: frame, to: .main) { [weak self] motion, error in
            guard let self, self.running, self.reference == capturedReference else { return }
            if error != nil { self.onStatus?("朝向：传感器暂不可用"); return }
            self.latestMotion = motion
            guard let arFrame = self.session?.currentFrame,
                  arFrame.timestamp - self.lastTimestamp >= 0.5,
                  let sample = self.snapshot(for: arFrame) else { return }
            self.samples.append(sample)
            self.lastTimestamp = arFrame.timestamp
            self.onStatus?(self.reference == "true-north" ? "真北：\(self.samples.filter { $0.reference == "true-north" }.count) 组同步记录" : "朝向：磁北记录中")
        }
    }

    func snapshot(for frame: ARFrame) -> CompassSample? {
        guard running, case .normal = frame.camera.trackingState,
              let motion = latestMotion, let heading = locationManager.heading,
              frame.timestamp.isFinite, motion.timestamp.isFinite,
              abs(frame.timestamp - motion.timestamp) <= 0.2,
              abs(heading.timestamp.timeIntervalSinceNow) <= 5,
              heading.headingAccuracy.isFinite, heading.headingAccuracy >= 0, heading.headingAccuracy <= 25,
              motion.magneticField.accuracy == .medium || motion.magneticField.accuracy == .high else { return nil }
        let degrees = reference == "true-north" ? heading.trueHeading : heading.magneticHeading
        guard degrees.isFinite, degrees >= 0, degrees < 360 else { return nil }
        let rotation = motion.attitude.rotationMatrix
        let referenceToDevice = simd_float3x3(columns: (
            SIMD3(Float(rotation.m11), Float(rotation.m21), Float(rotation.m31)),
            SIMD3(Float(rotation.m12), Float(rotation.m22), Float(rotation.m32)),
            SIMD3(Float(rotation.m13), Float(rotation.m23), Float(rotation.m33))
        ))
        let portraitToWorld = frame.camera.viewMatrix(for: .portrait).inverse
        guard let north = HeadingAlignment.north(portraitCameraToWorld: portraitToWorld, northReferenceToDevice: referenceToDevice) else { return nil }
        return CompassSample(arTimestamp: frame.timestamp, motionTimestamp: motion.timestamp,
            headingTimestamp: heading.timestamp, reference: reference, headingDegrees: degrees,
            headingAccuracyDegrees: heading.headingAccuracy, northInWorld: [north.x, north.y, north.z],
            portraitCameraToWorld: MatrixValues.array(portraitToWorld), northReferenceToDevice: MatrixValues.array(referenceToDevice))
    }

    func finish() -> HeadingCapture {
        running = false
        motionManager.stopDeviceMotionUpdates()
        locationManager.stopUpdatingHeading()
        locationManager.stopUpdatingLocation()
        let orientation = HeadingAlignment.summarize(samples, location: location)
        let warnings = orientation?.reference == "true-north" ? [] : ["未取得可靠真北朝向；指南针/定位可能未授权或校准不足。Web 需手动校准北向。"]
        return HeadingCapture(samples: samples, orientation: orientation, warnings: warnings)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { updateLocationService() }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard running, reference != "true-north", newHeading.trueHeading >= 0,
              manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else { return }
        startMotion(trueNorth: true)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard running, let value = locations.last, value.horizontalAccuracy >= 0,
              abs(value.timestamp.timeIntervalSinceNow) < 60,
              CLLocationCoordinate2DIsValid(value.coordinate) else { return }
        location = ScanLocation(latitude: value.coordinate.latitude, longitude: value.coordinate.longitude,
                                accuracyMeters: value.horizontalAccuracy, timestamp: value.timestamp)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if running { onStatus?("朝向：定位暂不可用，扫描继续") }
    }
}
