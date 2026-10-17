import Foundation
import Security
import Combine

@MainActor
final class UploadSettings: ObservableObject {
    @Published var endpoint: String { didSet { UserDefaults.standard.set(endpoint, forKey: "uploadEndpoint") } }
    @Published private(set) var token: String
    @Published var automaticUploads: Bool { didSet { UserDefaults.standard.set(automaticUploads, forKey: "automaticUploads") } }

    init() {
        endpoint = UserDefaults.standard.string(forKey: "uploadEndpoint") ?? ""
        automaticUploads = UserDefaults.standard.object(forKey: "automaticUploads") as? Bool ?? true
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrService as String: "app.roomcanvas.upload",
                                  kSecAttrAccount as String: "token", kSecReturnData as String: true]
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data {
            token = String(data: data, encoding: .utf8) ?? ""
        } else { token = "" }
    }

    func saveToken(_ value: String) throws {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrService as String: "app.roomcanvas.upload",
                                  kSecAttrAccount as String: "token"]
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
                                       kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ScanError.message("无法安全保存上传令牌 (\(status))。") }
        token = value
    }

    func connection() throws -> (URL, String) {
        let url = try Self.receiverURL(endpoint)
        guard token.count >= 32 else { throw ScanError.message("请填写接收端生成的上传令牌。") }
        return (url, token)
    }

    nonisolated static func receiverURL(_ endpoint: String) throws -> URL {
        guard let components = URLComponents(string: endpoint.trimmingCharacters(in: .whitespacesAndNewlines)),
              let url = components.url, let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil,
              components.fragment == nil, components.path.isEmpty || components.path == "/" else {
            throw ScanError.message("填写公网入口的完整地址，不包含 /api 路径、查询参数或账号。")
        }
        var permitted = components.scheme?.lowercased() == "https"
        let segments = host.split(separator: ".")
        let parts = segments.compactMap { Int($0) }
        let privateIPv4 = segments.count == 4 && parts.count == 4 && parts.allSatisfy { 0...255 ~= $0 }
            && (parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && 16...31 ~= parts[1]))
        let localHost = host == "localhost" || host == "127.0.0.1" || privateIPv4 || host.hasSuffix(".local")
        permitted = permitted || (components.scheme == "http" && localHost)
        guard permitted else { throw ScanError.message("公网上传必须使用 HTTPS。") }
        return url
    }
}
