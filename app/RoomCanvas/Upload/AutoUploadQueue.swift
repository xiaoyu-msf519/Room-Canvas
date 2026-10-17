import Combine
import Foundation
import UIKit

@MainActor
final class AutoUploadQueue: ObservableObject {
    static let shared = AutoUploadQueue()
    let settings = UploadSettings()
    let uploader = ScanUploader()
    @Published private(set) var pending: [UUID]
    @Published private(set) var delivered: [String: String]
    private var worker: Task<Void, Never>?
    private var observations: Set<AnyCancellable> = []

    private init() {
        pending = (UserDefaults.standard.stringArray(forKey: "pendingWebScans") ?? []).compactMap(UUID.init(uuidString:))
        delivered = UserDefaults.standard.dictionary(forKey: "deliveredWebScans") as? [String: String] ?? [:]
        uploader.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &observations)
    }

    func enqueue(_ id: UUID) {
        guard delivered[id.uuidString] != settings.endpoint else { return }
        if !pending.contains(id) { pending.append(id); persist() }
        resume()
    }

    private func persist() {
        UserDefaults.standard.set(pending.map(\.uuidString), forKey: "pendingWebScans")
        UserDefaults.standard.set(delivered, forKey: "deliveredWebScans")
    }

    func pause() { worker?.cancel(); uploader.cancel() }

    func resume() {
        guard worker == nil, settings.automaticUploads, (try? settings.connection()) != nil,
              UIApplication.shared.applicationState == .active else { return }
        worker = Task {
            defer { worker = nil }
            var failures = 0
            while !Task.isCancelled, !pending.isEmpty, settings.automaticUploads {
                if uploader.busy {
                    do { try await Task.sleep(nanoseconds: 200_000_000) } catch { return }
                    continue
                }
                let id = pending[0]
                guard FileManager.default.fileExists(atPath: ScanFiles.directory(for: id).appendingPathComponent("manifest.json").path) else {
                    pending.removeFirst(); persist(); continue
                }
                uploader.start(scanId: id, settings: settings)
                while uploader.busy && !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 200_000_000) } catch { return }
                }
                if Task.isCancelled { return }
                if uploader.sceneId != nil && uploader.errorMessage == nil {
                    delivered[id.uuidString] = settings.endpoint
                    pending.removeAll { $0 == id }; persist(); failures = 0
                } else {
                    failures += 1
                    if pending.count > 1 { pending.append(pending.removeFirst()); persist() }
                    do { try await Task.sleep(nanoseconds: UInt64(min(60, failures * 10)) * 1_000_000_000) } catch { return }
                }
            }
        }
    }

    func status(for id: UUID) -> String {
        if uploader.scanId == id { return uploader.message }
        if pending.contains(id) { return (try? settings.connection()) == nil ? "等待配置 Web 接收端" : "等待自动上传" }
        if delivered[id.uuidString] == settings.endpoint { return "已送达 Web" }
        return "尚未发送"
    }
}
