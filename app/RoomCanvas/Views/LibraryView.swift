import RoomPlan
import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var library: ScanLibrary
    @State private var path: [UUID] = []
    @State private var showingScanner = false
    @State private var pendingScan: UUID?
    @State private var deleting: ScanManifest?
    @State private var renaming: ScanManifest?
    @State private var newTitle = ""

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if library.scans.isEmpty {
                    ContentUnavailableView {
                        Label("暂无扫描", systemImage: "square.stack.3d.up")
                    } actions: {
                        Button { showingScanner = true } label: { Label("扫描房间", systemImage: "viewfinder") }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        Section("本地扫描 · \(library.scans.count)") {
                            ForEach(library.scans) { scan in
                                NavigationLink(value: scan.id) { scanRow(scan) }
                                    .swipeActions {
                                        Button(role: .destructive) { deleting = scan } label: { Label("删除", systemImage: "trash") }
                                    }
                                    .contextMenu {
                                        Button { newTitle = scan.title; renaming = scan } label: { Label("重命名", systemImage: "pencil") }
                                        Button(role: .destructive) { deleting = scan } label: { Label("删除", systemImage: "trash") }
                                    }
                            }
                        }
                    }.refreshable { library.reload() }
                }
            }
            .navigationTitle("RoomCanvas")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingScanner = true } label: { Label("扫描房间", systemImage: "plus.viewfinder") }
                        .help("扫描房间")
                }
            }
            .navigationDestination(for: UUID.self) { ScanDetailView(scanId: $0) }
        }
        .fullScreenCover(isPresented: $showingScanner, onDismiss: {
            library.reload()
            if let pendingScan { path.append(pendingScan); self.pendingScan = nil }
        }) {
            ScanScreen { id in
                pendingScan = id
                showingScanner = false
            }
        }
        .alert("删除本地扫描？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("取消", role: .cancel) { deleting = nil }
            Button("删除", role: .destructive) { if let deleting { library.delete(deleting) }; deleting = nil }
        } message: { Text("这会删除这份扫描的模型、关键帧和家具照片，无法撤销。") }
        .alert("重命名", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("房间名称", text: $newTitle)
            Button("取消", role: .cancel) { renaming = nil }
            Button("保存") { if let renaming { library.rename(renaming, title: newTitle) }; renaming = nil }
        }
        .alert("文件读取提示", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("好") { library.errorMessage = nil }
        } message: { Text(library.errorMessage ?? "") }
    }

    private func scanRow(_ scan: ScanManifest) -> some View {
        HStack(spacing: 12) {
            Group {
                if let image = scan.previewImagePath {
                    FileImage(url: ScanFiles.directory(for: scan.id).appendingPathComponent(image), maximumPixelSize: 180)
                } else { Image(systemName: "cube.transparent").font(.title).foregroundStyle(.teal) }
            }
            .frame(width: 64, height: 64).background(Color(.secondarySystemBackground)).clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 5) {
                Text(scan.title).font(.headline).lineLimit(2)
                Text(scan.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text(scan.status.title).foregroundStyle(scan.status == .complete ? Color.teal : Color.red)
                    Text("\(scan.objectCount) 件物品 · \(scan.frameCount) 帧").foregroundStyle(.secondary)
                }.font(.caption)
            }
        }.padding(.vertical, 4)
    }
}
