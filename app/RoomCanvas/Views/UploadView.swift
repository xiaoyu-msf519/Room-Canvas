import SwiftUI
import VisionKit

struct UploadSettingsView: View {
    @EnvironmentObject private var uploads: AutoUploadQueue
    @ObservedObject private var settings = AutoUploadQueue.shared.settings
    @State private var token = ""
    @State private var connectionText = ""
    @State private var testing = false
    @State private var result: String?
    @State private var scanningCode = false

    var body: some View {
        Form {
            Section("Web 接收端") {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    Button { scanningCode = true } label: { Label("扫描连接二维码", systemImage: "qrcode.viewfinder") }
                }
                TextField("https://接收端地址", text: $settings.endpoint)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("上传令牌", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("粘贴 Web 连接信息", text: $connectionText, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Toggle("扫描完成后自动发送", isOn: $settings.automaticUploads)
                Button {
                    testing = true; result = nil
                    Task {
                        do {
                            if !connectionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                struct Connection: Decodable { let endpoint: String; let token: String }
                                let value = try JSONDecoder().decode(Connection.self, from: Data(connectionText.utf8))
                                settings.endpoint = value.endpoint; token = value.token
                            }
                            try settings.saveToken(token)
                            try await uploads.uploader.test(settings: settings)
                            result = "连接成功"
                            connectionText = ""
                            uploads.resume()
                        } catch { result = error.localizedDescription }
                        testing = false
                    }
                } label: { Label(testing ? "正在连接" : "保存并测试连接", systemImage: "network") }
                    .disabled(testing || uploads.uploader.busy)
                if let result { Text(result).font(.footnote).foregroundStyle(.secondary) }
            }.disabled(uploads.uploader.busy)
            if !uploads.pending.isEmpty {
                Section("发送队列") {
                    Text("\(uploads.pending.count) 份扫描等待自动发送")
                    Text(uploads.uploader.message).font(.footnote).foregroundStyle(.secondary)
                    if let error = uploads.uploader.errorMessage { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            }
        }
        .navigationTitle("连接 Web").navigationBarTitleDisplayMode(.inline)
        .onAppear { token = settings.token }
        .sheet(isPresented: $scanningCode) {
            ConnectionCodeScanner(receive: { value in connectionText = value; scanningCode = false },
                                  failure: { error in result = error; scanningCode = false })
        }
        .onChange(of: settings.automaticUploads) { _, enabled in
            if enabled { uploads.resume() } else { uploads.pause() }
        }
    }
}
