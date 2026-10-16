import Foundation
import Combine
import UIKit

enum ScanFiles {
    static var root: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Scans", isDirectory: true)
    }

    static func directory(for id: UUID) -> URL {
        root.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        do {
            try encoder.encode(value).write(to: url, options: .atomic)
        } catch EncodingError.invalidValue(_, let context) {
            let field = context.codingPath.map { $0.intValue.map { "[\($0)]" } ?? $0.stringValue }.joined(separator: ".")
            throw ScanError.message("\(url.lastPathComponent) JSON 编码失败 [\(field)]：\(context.debugDescription)")
        } catch {
            throw ScanError.message("\(url.lastPathComponent) 写入失败：\(error.localizedDescription)")
        }
    }

    static func read<T: Decodable>(_ type: T.Type, at url: URL) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: Data(contentsOf: url))
    }

    static func createDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    static func listFiles(in directory: URL) throws -> [String] {
        guard let enumerator = FileManager.default.enumerator(
            at: directory, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]
        ) else { return [] }
        var paths: [String] = []
        let baseComponents = directory.standardizedFileURL.pathComponents
        for case let url as URL in enumerator {
            if try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
                let components = url.standardizedFileURL.pathComponents
                guard Array(components.prefix(baseComponents.count)) == baseComponents else {
                    throw ScanError.message("导出文件位于扫描目录之外。")
                }
                paths.append(components.dropFirst(baseComponents.count).joined(separator: "/"))
            }
        }
        return paths.sorted()
    }

    static func saveCameraFrames(_ candidates: [CameraFrameRecord], directory: URL) throws
        -> (frames: [CameraFrameRecord], warnings: [String]) {
        var frames: [CameraFrameRecord] = []
        var warnings: [String] = []
        try createDirectory(directory.appendingPathComponent("frames", isDirectory: true))
        for candidate in candidates {
            do {
                let frame = try candidate.validatedForStorage()
                guard FileManager.default.fileExists(atPath: directory.appendingPathComponent(frame.imagePath).path) else {
                    throw ScanError.message("\(frame.id): 关键帧图片不存在，未纳入相机索引。")
                }
                try write(frame, to: directory.appendingPathComponent("frames/\(frame.id).json"))
                frames.append(frame)
                if frame.sharpness != candidate.sharpness || frame.lightIntensity != candidate.lightIntensity {
                    warnings.append("\(frame.id): 非有限清晰度/光照已置为默认值/空值；相机位姿未改写。")
                }
            } catch { warnings.append("已跳过异常关键帧：\(error.localizedDescription)") }
        }
        try write(frames, to: directory.appendingPathComponent("cameras.json"))
        return (frames, warnings)
    }

    static func recoverCameraFrames(directory: URL) throws
        -> (frames: [CameraFrameRecord], warnings: [String]) {
        let camerasURL = directory.appendingPathComponent("cameras.json")
        var candidates: [String: CameraFrameRecord] = [:]
        var warnings: [String] = []
        if FileManager.default.fileExists(atPath: camerasURL.path) {
            do {
                for frame in try read([CameraFrameRecord].self, at: camerasURL) { candidates[frame.id] = frame }
            } catch {
                // Keep the original failed index for diagnosis before rebuilding it.
                let backup = directory.appendingPathComponent("cameras-invalid-\(UUID().uuidString).json")
                try FileManager.default.copyItem(at: camerasURL, to: backup)
                warnings.append("相机索引无法读取，原文件已保留为 \(backup.lastPathComponent)：\(error.localizedDescription)")
            }
        } else {
            warnings.append("缺少 cameras.json，已尝试从逐帧 JSON 恢复相机索引。")
        }
        let framesURL = directory.appendingPathComponent("frames", isDirectory: true)
        if FileManager.default.fileExists(atPath: framesURL.path) {
            for url in try FileManager.default.contentsOfDirectory(at: framesURL, includingPropertiesForKeys: nil).sorted(by: { $0.path < $1.path })
                where url.pathExtension == "json" {
                do {
                    let frame = try read(CameraFrameRecord.self, at: url)
                    if candidates[frame.id] == nil { candidates[frame.id] = frame }
                } catch { warnings.append("无法恢复 \(url.lastPathComponent)：\(error.localizedDescription)") }
            }
        }
        let saved = try saveCameraFrames(candidates.values.sorted { $0.id < $1.id }, directory: directory)
        return (saved.frames, warnings + saved.warnings)
    }

    static func refreshFiles(_ manifest: inout ScanManifest, directory: URL) throws {
        manifest.files = try listFiles(in: directory)
        if !manifest.files.contains("manifest.json") { manifest.files.append("manifest.json") }
        manifest.files.sort()
        try write(manifest, to: directory.appendingPathComponent("manifest.json"))
    }
}

@MainActor
final class ScanLibrary: ObservableObject {
    @Published var scans: [ScanManifest] = []
    @Published var errorMessage: String?

    init() { reload(recoverInterrupted: true) }

    func reload(recoverInterrupted: Bool = false) {
        do {
            try ScanFiles.createDirectory(ScanFiles.root)
            let directories = try FileManager.default.contentsOfDirectory(
                at: ScanFiles.root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
            )
            var results: [ScanManifest] = []
            var unreadable = 0
            for directory in directories {
                do {
                    var item = try ScanFiles.read(ScanManifest.self, at: directory.appendingPathComponent("manifest.json"))
                    if recoverInterrupted && (item.status == .capturing || item.status == .processing) {
                        item.status = .interrupted
                        item.warnings.append("上次扫描未正常结束；已保留当时写入的文件。")
                        try ScanFiles.refreshFiles(&item, directory: directory)
                    }
                    results.append(item)
                } catch { unreadable += 1 }
            }
            scans = results.sorted { $0.createdAt > $1.createdAt }
            if unreadable > 0 { errorMessage = "有 \(unreadable) 份扫描目录无法读取，原文件仍保留在“文件”App 中。" }
        } catch { errorMessage = error.localizedDescription }
    }

    func rename(_ scan: ScanManifest, title: String) {
        do {
            var value = scan
            value.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.title.isEmpty else { return }
            try ScanFiles.write(value, to: ScanFiles.directory(for: scan.id).appendingPathComponent("manifest.json"))
            reload()
        } catch { errorMessage = error.localizedDescription }
    }

    func delete(_ scan: ScanManifest) {
        do {
            try FileManager.default.removeItem(at: ScanFiles.directory(for: scan.id))
            reload()
        } catch { errorMessage = error.localizedDescription }
    }
}
