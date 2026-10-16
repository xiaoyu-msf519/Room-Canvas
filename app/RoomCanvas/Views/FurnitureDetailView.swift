import PhotosUI
import SwiftUI
import UIKit

struct FurnitureDetailView: View {
    let scanId: UUID
    let objectId: String
    @State private var object: FurnitureRecord?
    @State private var imageMode = 0
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var savingPhoto = false
    @State private var errorMessage: String?
    @State private var share: URLItem?

    private var directory: URL { ScanFiles.directory(for: scanId) }

    var body: some View {
        List {
            if let object {
                Section {
                    if !object.crops.isEmpty {
                        Picker("图片", selection: $imageMode) {
                            Text("家具裁剪").tag(0)
                            Text("原图框选").tag(1)
                        }.pickerStyle(.segmented)
                        TabView {
                            ForEach(object.crops) { crop in
                                FileImage(url: directory.appendingPathComponent(imageMode == 0 ? crop.imagePath : crop.overlayPath), maximumPixelSize: 1600)
                                    .padding(.bottom, 28)
                            }
                        }.tabViewStyle(.page).indexViewStyle(.page(backgroundDisplayMode: .always))
                            .frame(height: 350)
                    } else {
                        ContentUnavailableView("没有合适的可见关键帧", systemImage: "photo.badge.exclamationmark")
                            .frame(minHeight: 180)
                    }
                }.listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                Section("扫描信息") {
                    LabeledContent("类别", value: object.displayName)
                    LabeledContent("宽 × 高 × 深", value: object.sizeDescription)
                    LabeledContent("识别置信度", value: object.confidence)
                    LabeledContent("位置", value: positionDescription(object))
                    LabeledContent("对象 ID") { Text(object.id).font(.caption.monospaced()).textSelection(.enabled) }
                    NavigationLink { MetadataView(url: directory.appendingPathComponent("objects/\(object.id)/metadata.json")) } label: {
                        Label("家具参数与图片关联", systemImage: "doc.text")
                    }
                    NavigationLink { MetadataView(url: directory.appendingPathComponent(object.rawMetadataPath)) } label: {
                        Label("RoomPlan 原始信息", systemImage: "doc.text.magnifyingglass")
                    }
                }
                if !object.crops.isEmpty {
                    Section("裁剪来源 · 待核对") {
                        ForEach(object.crops) { crop in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(crop.frameId).font(.subheadline.monospaced())
                                    Spacer()
                                    Button { share = URLItem(url: directory.appendingPathComponent(crop.imagePath)) } label: {
                                        Image(systemName: "square.and.arrow.up")
                                    }
                                        .help("导出这张裁剪图")
                                }
                                Text("投影框可见比例 \(Int(crop.visibleFraction * 100))%").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("补充照片 · 无相机位姿") {
                    ForEach(object.supplementalImages) { photo in
                        FileImage(url: directory.appendingPathComponent(photo.imagePath), maximumPixelSize: 1200)
                            .frame(height: 240)
                    }
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Label(savingPhoto ? "正在保存" : "添加照片", systemImage: "photo.badge.plus")
                    }.disabled(savingPhoto)
                }
            }
        }
        .navigationTitle(object?.displayName ?? "家具")
        .navigationBarTitleDisplayMode(.inline)
        .task { load() }
        .sheet(item: $share) { ShareSheet(url: $0.url) }
        .onChange(of: selectedPhoto) { _, item in if let item { addPhoto(item) } }
        .alert("未能完成", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("好") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    private func positionDescription(_ object: FurnitureRecord) -> String {
        guard object.objectToWorld.count == 16 else { return "未知" }
        return String(format: "(%.2f, %.2f, %.2f) m", object.objectToWorld[12], object.objectToWorld[13], object.objectToWorld[14])
    }

    private func load() {
        do {
            let scene = try ScanFiles.read(SceneRecord.self, at: directory.appendingPathComponent("scene.json"))
            object = scene.objects.first { $0.id == objectId }
        } catch { errorMessage = error.localizedDescription }
    }

    private func addPhoto(_ item: PhotosPickerItem) {
        savingPhoto = true
        let folder = directory
        Task {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw ScanError.message("无法读取所选照片。") }
                try await Task.detached(priority: .userInitiated) {
                    guard let image = UIImage(data: data) else { throw ScanError.message("照片格式不受支持。") }
                    let maxEdge: CGFloat = 2048
                    let scale = min(1, maxEdge / max(image.size.width, image.size.height))
                    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                    let format = UIGraphicsImageRendererFormat(); format.scale = 1
                    let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                        image.draw(in: CGRect(origin: .zero, size: size))
                    }
                    guard let jpeg = normalized.jpegData(compressionQuality: 0.92) else { throw ScanError.message("照片编码失败。") }
                    var scene = try ScanFiles.read(SceneRecord.self, at: folder.appendingPathComponent("scene.json"))
                    guard let index = scene.objects.firstIndex(where: { $0.id == objectId }) else { throw ScanError.message("物品不存在。") }
                    let path = "objects/\(objectId)/supplement_\(UUID().uuidString).jpg"
                    try jpeg.write(to: folder.appendingPathComponent(path), options: .atomic)
                    scene.objects[index].supplementalImages.append(SupplementalImage(imagePath: path, createdAt: Date()))
                    try ScanFiles.write(scene, to: folder.appendingPathComponent("scene.json"))
                    try ScanFiles.write(scene.objects[index], to: folder.appendingPathComponent("objects/\(objectId)/metadata.json"))
                    var manifest = try ScanFiles.read(ScanManifest.self, at: folder.appendingPathComponent("manifest.json"))
                    try ScanFiles.refreshFiles(&manifest, directory: folder)
                }.value
                load()
            } catch { errorMessage = error.localizedDescription }
            savingPhoto = false
            selectedPhoto = nil
        }
    }
}
