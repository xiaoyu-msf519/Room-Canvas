import SwiftUI
import UIKit

struct RoomScannerView: UIViewControllerRepresentable {
    let model: ScanSessionModel
    func makeUIViewController(context: Context) -> RoomScanController { RoomScanController(model: model) }
    func updateUIViewController(_ controller: RoomScanController, context: Context) {}
}

struct ScanScreen: View {
    @StateObject private var session = ScanSessionModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingCancel = false
    let close: (UUID?) -> Void

    private var showingCapture: Bool { session.phase == .scanning || session.phase == .preparing }

    var body: some View {
        ZStack {
            RoomScannerView(model: session)
                .safeAreaInset(edge: .top, spacing: 0) {
                    if showingCapture { HStack {
                        Button { confirmingCancel = true } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                            .help("退出扫描")
                        Spacer()
                        Text("RoomCanvas").font(.headline)
                        Spacer()
                        Text(session.duration).font(.system(.body, design: .monospaced)).frame(minWidth: 60)
                    }.foregroundStyle(.white).padding(.horizontal, 12).background(.black) }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if showingCapture { VStack(spacing: 12) {
                        Text(session.instruction).font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                        HStack {
                            Label("\(session.objectCount) 件物品", systemImage: "chair.lounge")
                            Spacer()
                            Label("\(session.frameCount) 帧", systemImage: "photo.stack")
                        }.font(.caption.monospacedDigit())
                        Label(session.headingStatus, systemImage: "location.north.line").font(.caption)
                        if let message = session.message { Text(message).font(.caption).foregroundStyle(.yellow) }
                        HStack(spacing: 32) {
                            Button { session.sample(manual: true) } label: {
                                Image(systemName: "camera.fill").font(.title2).frame(width: 56, height: 56)
                            }.disabled(!session.canCapture).accessibilityLabel("保存当前关键帧").help("保存当前关键帧")
                            Button { session.finish() } label: {
                                Label("结束扫描", systemImage: "stop.fill").font(.headline)
                                    .frame(maxWidth: .infinity, minHeight: 52)
                            }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                                .disabled(session.phase != .scanning)
                        }
                    }.padding(20).foregroundStyle(.white).background(.black) }
                }
            if !showingCapture {
                Color(.systemBackground).ignoresSafeArea()
                VStack(spacing: 24) {
                    if session.phase == .finishing {
                        ProgressView().controlSize(.large)
                        Text("正在整理扫描").font(.title3.weight(.semibold))
                        HStack {
                            StatValue(value: "\(session.objectCount)", title: "物品")
                            StatValue(value: "\(session.frameCount)", title: "关键帧")
                        }
                    } else if let result = session.result {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 48)).foregroundStyle(.teal)
                        Text("已保存").font(.title2.weight(.semibold))
                        HStack {
                            StatValue(value: "\(result.objectCount)", title: "物品")
                            StatValue(value: "\(result.croppedObjectCount)", title: "已生成裁剪")
                            StatValue(value: "\(result.frameCount)", title: "关键帧")
                        }
                        Button { close(result.id) } label: { Label("查看扫描", systemImage: "square.stack.3d.up") }
                            .buttonStyle(.borderedProminent)
                    } else {
                        Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.red)
                        Text("无法完成扫描").font(.title3.weight(.semibold))
                        Text(session.message ?? "扫描已中断").font(.body).multilineTextAlignment(.center)
                        if session.cameraDenied {
                            Button { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } } label: {
                                Label("打开设置", systemImage: "gear")
                            }
                        }
                        Button { close(nil) } label: { Label("返回", systemImage: "arrow.left") }.buttonStyle(.bordered)
                    }
                }.padding(24).frame(maxWidth: 500)
            }
        }
        .interactiveDismissDisabled()
        .statusBarHidden(session.phase == .scanning)
        .onAppear { session.onClose = { close(nil) } }
        .onDisappear { session.viewDisappeared() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { session.finish(reason: "扫描因 App 进入后台而结束。") }
        }
        .confirmationDialog("退出当前扫描？", isPresented: $confirmingCancel, titleVisibility: .visible) {
            Button("退出并保留已采集文件", role: .destructive) { session.cancel() }
            Button("继续扫描", role: .cancel) {}
        }
    }
}
