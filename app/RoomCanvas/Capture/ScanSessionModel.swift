import ARKit
import AVFoundation
import Foundation
import RoomPlan
import simd
import SwiftUI
import UIKit

enum CapturePhase: Equatable {
    case preparing, scanning, finishing, complete, failed, cancelled
}

@MainActor
final class ScanSessionModel: ObservableObject {
    @Published var phase: CapturePhase = .preparing
    @Published var frameCount = 0
    @Published var objectCount = 0
    @Published var elapsedSeconds = 0
    @Published var instruction = "正在准备相机"
    @Published var message: String?
    @Published var cameraDenied = false
    @Published var result: ScanManifest?
    @Published var headingStatus = "朝向：校准中"
    @Published var captureTarget: SurfaceCaptureTarget = .general
    @Published var materialCaptureHint = ""
    weak var controller: RoomScanController?
    var onClose: (() -> Void)?

    private var manifest: ScanManifest?
    private var recorder: FrameRecorder?
    private var headingRecorder: HeadingRecorder?
    private var timer: Timer?
    private var startedAt: Date?
    private var lastSampleTime: TimeInterval = -Double.infinity
    private var lastRoomLogTime: TimeInterval = -Double.infinity
    private var samplePending = false
    private var processingStarted = false
    private var preparingStarted = false
    private var warnings: [String] = []
    private var lastMaterialPose: simd_float4x4?
    private var lastMaterialTarget: SurfaceCaptureTarget?
    private var recentPose: simd_float4x4?
    private var recentPoseTime: TimeInterval?
    private var stopTimeout: Task<Void, Never>?

    var canCapture: Bool { phase == .scanning && frameCount < CapturePolicy().maximumFrames && !samplePending }
    var duration: String { String(format: "%02d:%02d", elapsedSeconds / 60, elapsedSeconds % 60) }

    func startIfNeeded(controller: RoomScanController) {
        self.controller = controller
        guard !preparingStarted else { return }
        preparingStarted = true
        guard RoomCaptureSession.isSupported else {
            phase = .failed
            message = "这台设备不支持 RoomPlan 扫描，需要带 LiDAR 的 iPhone 或 iPad Pro。"
            return
        }
        Task { [weak self, weak controller] in
            guard let self, let controller else { return }
            let authorized: Bool
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: authorized = true
            case .notDetermined: authorized = await AVCaptureDevice.requestAccess(for: .video)
            default: authorized = false
            }
            guard self.phase == .preparing else { return }
            guard authorized else {
                self.cameraDenied = true
                self.phase = .failed
                self.message = "相机访问未获允许。"
                return
            }
            do {
                let id = UUID()
                let date = Date()
                let title = "房间 " + date.formatted(date: .abbreviated, time: .shortened)
                let value = ScanManifest(id: id, title: title, createdAt: date, status: .capturing,
                                         device: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion)
                let directory = ScanFiles.directory(for: id)
                try ScanFiles.createDirectory(directory)
                try ScanFiles.write(value, to: directory.appendingPathComponent("manifest.json"))
                try ScanFiles.write([CameraFrameRecord](), to: directory.appendingPathComponent("cameras.json"))
                self.manifest = value
                self.recorder = FrameRecorder(directory: directory, policy: value.capturePolicy)
                self.startedAt = date
                self.phase = .scanning
                self.instruction = "缓慢移动，扫描墙面和家具"
                UIApplication.shared.isIdleTimerDisabled = true
                controller.captureView.captureSession.run(configuration: .init())
                let headingRecorder = HeadingRecorder()
                headingRecorder.onStatus = { [weak self] status in
                    Task { @MainActor in self?.headingStatus = status }
                }
                self.headingRecorder = headingRecorder
                headingRecorder.start(session: controller.captureView.captureSession.arSession)
                self.timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                    Task { @MainActor in self?.tick() }
                }
            } catch { self.fail(error) }
        }
    }

    private func tick() {
        guard phase == .scanning else { return }
        if let startedAt { elapsedSeconds = Int(Date().timeIntervalSince(startedAt)) }
        if elapsedSeconds >= 300 {
            finish(reason: "达到 5 分钟单次扫描时长，已自动结束以控制温度与存储。")
            return
        }
        guard let frame = controller?.captureView.captureSession.arSession.currentFrame else { return }
        let pose = frame.camera.transform
        var steady = false
        if let previous = recentPose, let time = recentPoseTime, frame.timestamp > time {
            let interval = Float(frame.timestamp - time)
            let movement = pose.columns.3 - previous.columns.3
            let currentDirection = SIMD3(pose.columns.2.x, pose.columns.2.y, pose.columns.2.z)
            let previousDirection = SIMD3(previous.columns.2.x, previous.columns.2.y, previous.columns.2.z)
            let angle = acos(max(-1, min(1, simd_dot(currentDirection, previousDirection))))
            steady = simd_length(SIMD3(movement.x, movement.y, movement.z)) / interval < 0.15
                && angle / interval < Float.pi / 12
        }
        recentPose = pose
        recentPoseTime = frame.timestamp
        if frameCount >= CapturePolicy().maximumFrames {
            instruction = "关键帧已达上限，请结束扫描"
            return
        }
        guard case .normal = frame.camera.trackingState else {
            instruction = "定位尚未稳定，请缓慢移动手机"
            return
        }
        if captureTarget != .general && !steady {
            materialCaptureHint = "请停稳，等待自动补拍"
            return
        }
        if frame.timestamp - lastSampleTime >= CapturePolicy().automaticIntervalSeconds { sample(manual: false) }
    }

    func sample(manual: Bool) {
        guard canCapture, let frame = controller?.captureView.captureSession.arSession.currentFrame else { return }
        let target = captureTarget
        if !manual && target != .general {
            guard target.accepts(frame.camera.transform) else {
                materialCaptureHint = target == .floor ? "向下对准无遮挡的地板" : "平视对准无遮挡的墙面"
                return
            }
            if lastMaterialTarget == target, let previous = lastMaterialPose,
               !SurfaceCaptureTarget.isNewView(frame.camera.transform, after: previous) {
                materialCaptureHint = "换一个位置或角度，再停稳补拍"
                return
            }
        }
        samplePending = true
        lastSampleTime = frame.timestamp
        recorder?.record(frame, manual: manual, compass: headingRecorder?.snapshot(for: frame),
                         materialTarget: target == .general ? nil : target.rawValue) { [weak self] result in
            guard let self else { return }
            self.samplePending = false
            switch result {
            case .success(let count):
                self.frameCount = count
                if target != .general {
                    self.lastMaterialPose = frame.camera.transform
                    self.lastMaterialTarget = target
                    self.materialCaptureHint = "已补拍，继续换角度覆盖\(target.title)"
                }
            case .failure(let error): self.message = error.localizedDescription
            }
        }
    }

    func update(room: CapturedRoom, timestamp: TimeInterval) {
        guard phase == .scanning else { return }
        objectCount = room.objects.count
        if timestamp - lastRoomLogTime >= 1 {
            lastRoomLogTime = timestamp
            recorder?.logRoomUpdate(room, timestamp: timestamp)
        }
    }

    func update(instruction value: RoomCaptureSession.Instruction) {
        guard phase == .scanning else { return }
        let key = String(describing: value)
        let names = ["moveCloseToWall": "靠近墙面一些", "moveAwayFromWall": "与墙面保持一些距离",
                     "slowDown": "移动慢一些", "turnOnLight": "请增加房间光线",
                     "lowTexture": "对准家具或有纹理的区域", "normal": "缓慢移动，扫描墙面和家具"]
        instruction = names[key] ?? "继续扫描墙面和家具"
    }

    func finish(reason: String? = nil) {
        guard phase == .scanning else { return }
        if let reason { warnings.append(reason) }
        sample(manual: true)
        phase = .finishing
        instruction = "正在保存与整理家具"
        stopTimer()
        controller?.captureView.captureSession.stop()
        stopTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self, self.phase == .finishing, !self.processingStarted else { return }
            self.fail(ScanError.message("RoomPlan 未返回结束结果。已保留关键帧，可关闭后重新扫描。"))
        }
    }

    func receive(raw: CapturedRoomData, error: Error?) {
        guard phase == .scanning || phase == .finishing, !processingStarted, var value = manifest else { return }
        processingStarted = true
        phase = .finishing
        stopTimeout?.cancel()
        stopTimer()
        value.orientation = manifest?.orientation
        if let error { warnings.append("RoomPlan 结束时报告：\(error.localizedDescription)") }
        value.status = .processing
        let pendingWarnings = warnings
        recorder?.flush { [weak self] frames, recorderWarnings in
            guard let self else { return }
            self.frameCount = frames.count
            Task {
                do {
                    let snapshot = value
                    let finished = try await Task.detached(priority: .userInitiated) {
                        try await ScanProcessor.process(raw: raw, manifest: snapshot, frames: frames,
                                                        warnings: pendingWarnings + recorderWarnings,
                                                        directory: ScanFiles.directory(for: snapshot.id))
                    }.value
                    self.result = finished
                    self.manifest = finished
                    self.phase = .complete
                    self.instruction = "已保存"
                    AutoUploadQueue.shared.enqueue(finished.id)
                } catch { self.fail(error) }
            }
        }
    }

    func cancel() {
        guard phase != .finishing else { return }
        let wasScanning = phase == .scanning
        phase = .cancelled
        stopTimer()
        if wasScanning { controller?.captureView.captureSession.stop() }
        guard var value = manifest, let recorder else { onClose?(); return }
        recorder.flush { [weak self] frames, warnings in
            value.status = .interrupted
            value.frameCount = frames.count
            value.warnings += warnings + ["用户提前结束，未生成最终房间；关键帧已保留。"]
            do { try ScanFiles.refreshFiles(&value, directory: ScanFiles.directory(for: value.id)) }
            catch { self?.message = error.localizedDescription }
            self?.onClose?()
        }
    }

    private func fail(_ error: Error) {
        phase = .failed
        stopTimer()
        message = error.localizedDescription
        guard var value = manifest else { return }
        let directory = ScanFiles.directory(for: value.id)
        if let disk = try? ScanFiles.read(ScanManifest.self, at: directory.appendingPathComponent("manifest.json")) { value = disk }
        value.status = .failed
        value.frameCount = frameCount
        value.warnings.append(error.localizedDescription)
        do { try ScanFiles.refreshFiles(&value, directory: directory) }
        catch { message = "\(error.localizedDescription)；已写入的扫描文件仍保留。" }
    }

    private func stopTimer() {
        if let headingRecorder {
            let capture = headingRecorder.finish()
            self.headingRecorder = nil
            manifest?.orientation = capture.orientation
            warnings += capture.warnings
            if let value = manifest {
                do {
                    let directory = ScanFiles.directory(for: value.id)
                    try ScanFiles.write(capture, to: directory.appendingPathComponent("heading.json"))
                    try ScanFiles.write(value, to: directory.appendingPathComponent("manifest.json"))
                } catch { warnings.append("朝向记录保存失败：\(error.localizedDescription)") }
            }
        }
        timer?.invalidate()
        timer = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func viewDisappeared() {
        if phase == .scanning || phase == .preparing { cancel() }
    }
}

final class RoomScanController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    lazy var captureView = RoomCaptureView(frame: .zero)
    weak var model: ScanSessionModel?

    init(model: ScanSessionModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Use init(model:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard RoomCaptureSession.isSupported else { return }
        captureView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(captureView)
        NSLayoutConstraint.activate([
            captureView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            captureView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            captureView.topAnchor.constraint(equalTo: view.topAnchor),
            captureView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        captureView.delegate = self
        captureView.captureSession.delegate = self
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        model?.startIfNeeded(controller: self)
    }

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        DispatchQueue.main.async { [weak self] in self?.model?.receive(raw: roomDataForProcessing, error: error) }
        return false
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {}

    func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        let timestamp = session.arSession.currentFrame?.timestamp ?? ProcessInfo.processInfo.systemUptime
        DispatchQueue.main.async { [weak self] in self?.model?.update(room: room, timestamp: timestamp) }
    }

    func captureSession(_ session: RoomCaptureSession, didAdd room: CapturedRoom) {
        captureSession(session, didUpdate: room)
    }

    func captureSession(_ session: RoomCaptureSession, didChange room: CapturedRoom) {
        captureSession(session, didUpdate: room)
    }

    func captureSession(_ session: RoomCaptureSession, didRemove room: CapturedRoom) {
        captureSession(session, didUpdate: room)
    }

    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        DispatchQueue.main.async { [weak self] in self?.model?.update(instruction: instruction) }
    }

    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        DispatchQueue.main.async { [weak self] in self?.model?.receive(raw: data, error: error) }
    }
}
