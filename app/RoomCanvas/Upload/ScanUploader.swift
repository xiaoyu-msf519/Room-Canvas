import Foundation
import CryptoKit
import Combine
import UIKit

struct RemoteUpload: Decodable {
    var id: String
    var offset: Int64
    var size: Int64
    var chunkSize: Int
    var status: String
    var sceneId: String?
    var error: String?
}

private struct UploadSnapshot: Codable {
    var fingerprint: String
    var sha256: String
    var size: Int64
}

struct UploadHTTPError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { "\(message) (HTTP \(status))" }
}

// Redirects must never forward the upload credential to a different endpoint.
private final class UploadRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class ScanUploader: ObservableObject {
    @Published private(set) var scanId: UUID?
    @Published private(set) var busy = false
    @Published private(set) var message = "尚未上传"
    @Published private(set) var progress = 0.0
    @Published private(set) var sceneId: String?
    @Published private(set) var errorMessage: String?
    private var task: Task<Void, Never>?
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 120
        configuration.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: configuration, delegate: UploadRedirectPolicy(), delegateQueue: nil)
    }

    func cancel() { task?.cancel() }

    func start(scanId id: UUID, settings: UploadSettings) {
        guard !busy else { return }
        scanId = id; busy = true; sceneId = nil; progress = 0; errorMessage = nil
        message = "正在准备扫描包"
        UIApplication.shared.isIdleTimerDisabled = true
        task = Task {
            defer { busy = false; task = nil; UIApplication.shared.isIdleTimerDisabled = false }
            do {
                let (base, token) = try settings.connection()
                let folder = ScanFiles.directory(for: id)
                let preparation = Task.detached(priority: .utility) { try Self.prepare(id: id, folder: folder) }
                let snapshot = try await withTaskCancellationHandler(operation: { try await preparation.value },
                                                                    onCancel: { preparation.cancel() })
                try Task.checkCancellation()
                message = "正在连接接收端"
                let payload: [String: Any] = ["scanId": id.uuidString, "size": snapshot.1.size, "sha256": snapshot.1.sha256]
                var state: RemoteUpload = try await retryRequest(base: base, token: token, path: "api/mobile/uploads",
                                                               method: "POST", body: JSONSerialization.data(withJSONObject: payload))
                let handle = try FileHandle(forReadingFrom: snapshot.0)
                defer { try? handle.close() }
                var failures = 0
                let deadline = Date().addingTimeInterval(3600)
                while state.status == "uploading" && state.offset < state.size {
                    try Task.checkCancellation()
                    guard Date() < deadline else { throw ScanError.message("本次上传等待过久，稍后可继续。") }
                    guard state.offset >= 0, state.offset <= snapshot.1.size, state.size == snapshot.1.size,
                          state.chunkSize > 0, state.chunkSize <= 2 * 1024 * 1024 else {
                        throw ScanError.message("接收端返回了不兼容的分块参数。")
                    }
                    progress = Double(state.offset) / Double(state.size)
                    message = "已发送 \(ByteCountFormatter.string(fromByteCount: state.offset, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: state.size, countStyle: .file))"
                    try handle.seek(toOffset: UInt64(state.offset))
                    let length = Int(min(Int64(state.chunkSize), state.size - state.offset))
                    guard let data = try handle.read(upToCount: length), data.count == length else {
                        throw ScanError.message("上传缓存文件不完整，请重新准备。")
                    }
                    let previousOffset = state.offset
                    do {
                        state = try await request(base: base, token: token, path: "api/mobile/uploads/\(state.id)", method: "PUT",
                                                  body: data, headers: ["Upload-Offset": String(state.offset),
                                                                        "X-Chunk-SHA256": Self.digest(data)])
                        failures = 0
                    } catch {
                        try Task.checkCancellation()
                        if let http = error as? UploadHTTPError, http.status != 409 && !Self.retryable(error) { throw error }
                        failures += 1
                        guard failures <= 5 else { throw error }
                        message = "连接中断，正在确认续传位置"
                        try await Task.sleep(nanoseconds: UInt64(min(failures * 2, 10)) * 1_000_000_000)
                        state = try await retryRequest(base: base, token: token, path: "api/mobile/uploads/\(state.id)", method: "GET")
                        if state.offset > previousOffset { failures = 0 }
                    }
                }
                progress = 1
                let processingDeadline = Date().addingTimeInterval(900)
                while state.status != "complete" {
                    try Task.checkCancellation()
                    if state.status == "failed" { throw ScanError.message(state.error ?? "接收端处理失败。") }
                    guard Date() < processingDeadline else { throw ScanError.message("接收端仍在处理，稍后点击继续上传检查结果。") }
                    message = "已发送，接收端正在校验并发布场景"
                    if state.status == "uploading" {
                        state = try await retryRequest(base: base, token: token, path: "api/mobile/uploads/\(state.id)/complete", method: "POST")
                    }
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    state = try await retryRequest(base: base, token: token, path: "api/mobile/uploads/\(state.id)", method: "GET")
                }
                sceneId = state.sceneId
                message = "已送达 Web，房间正在自动建模"
            } catch is CancellationError {
                message = "已暂停，可继续上传"
            } catch {
                if Task.isCancelled { message = "已暂停，可继续上传" }
                else { errorMessage = error.localizedDescription; message = "上传未完成，可重试" }
            }
        }
    }

    func test(settings: UploadSettings) async throws {
        struct Health: Decodable { var status: String; var `protocol`: String }
        let (base, token) = try settings.connection()
        let value: Health = try await request(base: base, token: token, path: "api/mobile/health", method: "GET")
        guard value.status == "ok", value.protocol == "roomcanvas.upload.v1" else {
            throw ScanError.message("该地址不是兼容的 RoomCanvas 上传网关。")
        }
    }

    private func retryRequest<T: Decodable>(base: URL, token: String, path: String, method: String, body: Data? = nil) async throws -> T {
        for attempt in 0..<4 {
            do { return try await request(base: base, token: token, path: path, method: method, body: body) }
            catch {
                try Task.checkCancellation()
                guard attempt < 3, Self.retryable(error) else { throw error }
                try await Task.sleep(nanoseconds: UInt64(1 << attempt) * 1_000_000_000)
            }
        }
        throw ScanError.message("连接接收端失败。")
    }

    private static func retryable(_ error: Error) -> Bool {
        if let value = error as? UploadHTTPError { return [408, 429, 500, 502, 503, 504].contains(value.status) }
        return error is URLError
    }

    private func request<T: Decodable>(base: URL, token: String, path: String, method: String, body: Data? = nil,
                                       headers: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(method == "PUT" ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.httpBody = body ?? (method == "POST" ? Data() : nil)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ScanError.message("接收端响应无效。") }
        guard (200..<300).contains(response.statusCode) else {
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = payload?["detail"] as? String ?? "接收端返回错误，请检查公网地址与服务状态"
            throw UploadHTTPError(status: response.statusCode, message: message)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw ScanError.message("接收端响应格式不正确，请确认地址指向上传网关。") }
    }

    nonisolated private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func fingerprint(_ folder: URL) throws -> String {
        var hash = SHA256()
        for name in try ScanFiles.listFiles(in: folder) {
            let values = try folder.appendingPathComponent(name).resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            hash.update(data: Data("\(name)\u{0}\(values.fileSize ?? 0)\u{0}\(values.contentModificationDate?.timeIntervalSince1970 ?? 0)\n".utf8))
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func prepare(id: UUID, folder: URL) throws -> (URL, UploadSnapshot) {
        let manifest = try ScanFiles.read(ScanManifest.self, at: folder.appendingPathComponent("manifest.json"))
        guard manifest.status == .complete else { throw ScanError.message("只有整理完成的扫描可以上传到 Web。") }
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("UploadCache/\(id.uuidString)", isDirectory: true)
        try ScanFiles.createDirectory(root)
        var excluded = root
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        let archive = root.appendingPathComponent("scan.zip")
        let metadata = root.appendingPathComponent("snapshot.json")
        let original = try fingerprint(folder)
        if let cached = try? ScanFiles.read(UploadSnapshot.self, at: metadata), cached.fingerprint == original,
           let size = try? archive.resourceValues(forKeys: [.fileSizeKey]).fileSize, Int64(size) == cached.size {
            return (archive, cached)
        }
        try Task.checkCancellation()
        try? FileManager.default.removeItem(at: metadata)
        try ZIPArchive.create(from: folder, to: archive)
        try Task.checkCancellation()
        guard try fingerprint(folder) == original else { throw ScanError.message("扫描文件在打包时发生变化，请停止编辑后重试。") }
        let handle = try FileHandle(forReadingFrom: archive)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard size > 0, size <= 2 * 1024 * 1024 * 1024 else { throw ScanError.message("扫描包超过接收端 2 GiB 上限。") }
        try handle.seek(toOffset: 0)
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
        let snapshot = UploadSnapshot(fingerprint: original, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined(), size: Int64(size))
        try ScanFiles.write(snapshot, to: metadata)
        return (archive, snapshot)
    }
}
