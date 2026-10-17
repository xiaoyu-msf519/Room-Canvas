import RoomPlan
import SwiftUI

struct ScanDetailView: View {
    let scanId: UUID
    @EnvironmentObject private var library: ScanLibrary
    @EnvironmentObject private var uploads: AutoUploadQueue
    @State private var scene: SceneRecord?
    @State private var frames: [CameraFrameRecord] = []
    @State private var exporting = false
    @State private var reprocessing = false
    @State private var share: URLItem?
    @State private var preview: URLItem?
    @State private var errorMessage: String?

    private var directory: URL { ScanFiles.directory(for: scanId) }
    private var manifest: ScanManifest? { library.scans.first { $0.id == scanId } }

    var body: some View {
        List {
            if let manifest {
                Section {
                    HStack {
                        StatValue(value: "\(manifest.objectCount)", title: "物品")
                        StatValue(value: "\(manifest.croppedObjectCount)", title: "有裁剪图")
                        StatValue(value: "\(frames.count)", title: "关键帧")
                    }.padding(.vertical, 8)
                    LabeledContent("状态", value: manifest.status.title)
                    LabeledContent("扫描时间", value: manifest.createdAt.formatted(date: .abbreviated, time: .shortened))
                }
                if manifest.status == .complete {
                    Section("Web 同步") {
                        Text(uploads.status(for: scanId)).font(.footnote)
                        if uploads.uploader.scanId == scanId && uploads.uploader.busy { ProgressView(value: uploads.uploader.progress) }
                        NavigationLink { UploadSettingsView() } label: { Label("接收端设置", systemImage: "network") }
                        Button { uploads.enqueue(scanId) } label: { Label("发送到 Web", systemImage: "arrow.up.doc") }
                            .disabled(uploads.pending.contains(scanId))
                    }
                }
                if FileManager.default.fileExists(atPath: directory.appendingPathComponent("room.usdz").path) {
                    Section {
                        Button { preview = URLItem(url: directory.appendingPathComponent("room.usdz")) } label: {
                            Label("房间模型", systemImage: "cube.transparent")
                        }
                    }
                }
                if let scene {
                    Section("家具与设备 · \(scene.objects.count)") {
                        if scene.objects.isEmpty { Text("未识别到物品").foregroundStyle(.secondary) }
                        ForEach(scene.objects) { object in
                            NavigationLink {
                                FurnitureDetailView(scanId: scanId, objectId: object.id)
                            } label: { furnitureRow(object) }
                        }
                    }
                    Section("房间结构") {
                        ForEach([("wall", "墙"), ("floor", "地板"), ("door", "门"), ("window", "窗"), ("opening", "开口")], id: \.0) { kind, title in
                            LabeledContent(title, value: "\(scene.surfaces.filter { $0.kind == kind }.count)")
                        }
                    }
                }
                Section("采集文件") {
                    NavigationLink { FrameGalleryView(directory: directory, frames: frames) } label: {
                        Label("关键帧与相机参数", systemImage: "photo.stack")
                    }
                    ForEach(["scene.json", "roomplan.json", "manifest.json", "cameras.json"], id: \.self) { name in
                        if FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) {
                            NavigationLink { MetadataView(url: directory.appendingPathComponent(name)) } label: {
                                Label(name, systemImage: "doc.text")
                            }
                        }
                    }
                }
                if !manifest.warnings.isEmpty {
                    Section("采集情况") {
                        ForEach(Array(manifest.warnings.enumerated()), id: \.offset) { _, warning in
                            Text(warning).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                if manifest.status != .complete && FileManager.default.fileExists(atPath: directory.appendingPathComponent("roomplan.raw.json").path) {
                    Section {
                        Button { reprocess() } label: { Label("重新整理扫描", systemImage: "arrow.clockwise") }
                            .disabled(reprocessing || exporting)
                    }
                }
            }
        }
        .navigationTitle(manifest?.title ?? "扫描")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { export() } label: {
                    if exporting { ProgressView() }
                    else { Label("导出扫描包", systemImage: "square.and.arrow.up") }
                }.disabled(exporting || reprocessing).help("导出扫描包")
            }
        }
        .overlay { if reprocessing { ProgressView("正在重新整理").padding(24).background(.regularMaterial) } }
        .onAppear { load() }
        .sheet(item: $share) { ShareSheet(url: $0.url) }
        .sheet(item: $preview) { ModelPreview(url: $0.url).ignoresSafeArea() }
        .alert("未能完成", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("好") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func load() {
        let sceneURL = directory.appendingPathComponent("scene.json")
        if FileManager.default.fileExists(atPath: sceneURL.path) {
            do { scene = try ScanFiles.read(SceneRecord.self, at: sceneURL) }
            catch { errorMessage = "场景文件读取失败：\(error.localizedDescription)" }
        }
        do {
            let recovered = try ScanFiles.recoverCameraFrames(directory: directory)
            frames = recovered.frames
            if var value = manifest, !recovered.warnings.isEmpty {
                if value.status == .complete && value.frameCount != frames.count { value.status = .failed }
                value.frameCount = frames.count
                value.warnings = Array(Set(value.warnings + recovered.warnings)).sorted()
                try ScanFiles.refreshFiles(&value, directory: directory)
                library.reload()
            }
        }
        catch { errorMessage = "相机记录恢复失败：\(error.localizedDescription)" }
    }

    private func furnitureRow(_ object: FurnitureRecord) -> some View {
        HStack(spacing: 12) {
            Group {
                if let path = object.crops.first?.imagePath ?? object.supplementalImages.first?.imagePath {
                    FileImage(url: directory.appendingPathComponent(path), maximumPixelSize: 180)
                } else { Image(systemName: "photo.badge.exclamationmark").foregroundStyle(.secondary) }
            }.frame(width: 64, height: 64).background(Color(.secondarySystemBackground)).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 5) {
                Text(object.displayName).font(.headline)
                Text(object.sizeDescription).font(.caption).foregroundStyle(.secondary)
                Text(object.crops.isEmpty ? "缺少自动裁剪图" : "\(object.crops.count) 个视角 · 待核对")
                    .font(.caption).foregroundStyle(object.crops.isEmpty ? Color.red : Color.secondary)
            }
        }
    }

    private func export() {
        exporting = true
        let folder = directory
        Task {
            do {
                let url = try await Task.detached(priority: .userInitiated) {
                    let recovered = try ScanFiles.recoverCameraFrames(directory: folder)
                    var manifest = try ScanFiles.read(ScanManifest.self, at: folder.appendingPathComponent("manifest.json"))
                    if manifest.status == .complete && manifest.frameCount != recovered.frames.count {
                        manifest.status = .failed
                        manifest.warnings.append("相机索引恢复后数量变化，导出为未完成记录以保留现场，需重新整理。")
                    }
                    manifest.frameCount = recovered.frames.count
                    manifest.warnings = Array(Set(manifest.warnings + recovered.warnings)).sorted()
                    try ScanFiles.refreshFiles(&manifest, directory: folder)
                    let exports = FileManager.default.temporaryDirectory.appendingPathComponent("RoomCanvasExports")
                    try ScanFiles.createDirectory(exports)
                    let file = exports.appendingPathComponent("RoomCanvas-\(scanId.uuidString)-\(UUID().uuidString.prefix(8)).zip")
                    do { try ZIPArchive.create(from: folder, to: file) }
                    catch { try? FileManager.default.removeItem(at: file); throw error }
                    return file
                }.value
                library.reload()
                share = URLItem(url: url)
            } catch { errorMessage = error.localizedDescription }
            exporting = false
        }
    }

    private func reprocess() {
        guard let manifest else { return }
        reprocessing = true
        let folder = directory
        let cameraFrames = frames
        Task {
            do {
                _ = try await Task.detached(priority: .userInitiated) {
                    let raw = try ScanFiles.read(CapturedRoomData.self, at: folder.appendingPathComponent("roomplan.raw.json"))
                    return try await ScanProcessor.process(raw: raw, manifest: manifest, frames: cameraFrames,
                                                            warnings: ["由已保存的原始数据重新整理。"], directory: folder)
                }.value
                library.reload()
                uploads.enqueue(scanId)
                load()
            } catch { errorMessage = error.localizedDescription; library.reload() }
            reprocessing = false
        }
    }
}

struct FrameGalleryView: View {
    let directory: URL
    let frames: [CameraFrameRecord]
    var body: some View {
        List(frames) { frame in
            NavigationLink {
                List {
                    FileImage(url: directory.appendingPathComponent(frame.imagePath), maximumPixelSize: 1600)
                        .frame(height: 380).listRowInsets(EdgeInsets())
                    LabeledContent("分辨率", value: "\(frame.imageWidth) × \(frame.imageHeight)")
                    LabeledContent("跟踪", value: frame.trackingState)
                    LabeledContent("相机时间戳", value: String(format: "%.3f s", frame.timestamp))
                    LabeledContent("深度", value: frame.depth == nil ? "未提供" : "已保存")
                    NavigationLink("相机参数") { MetadataView(url: directory.appendingPathComponent("frames/\(frame.id).json")) }
                }.navigationTitle(frame.id).navigationBarTitleDisplayMode(.inline)
            } label: {
                HStack {
                    FileImage(url: directory.appendingPathComponent(frame.imagePath), maximumPixelSize: 160).frame(width: 60, height: 80)
                    VStack(alignment: .leading) {
                        Text(frame.id)
                        Text(frame.trackingState).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }.navigationTitle("关键帧").navigationBarTitleDisplayMode(.inline)
    }
}
