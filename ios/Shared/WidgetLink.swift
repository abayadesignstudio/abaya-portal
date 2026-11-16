import AppIntents
import Foundation
import Security
import WidgetKit

/// The widget's own link to the portal: a per-phone token kept in a keychain group shared by the app and the widget.
enum WidgetLink {
    static let endpoint = URL(string: "https://ozowlkstprkvktosetci.supabase.co/functions/v1/widget")!
    private static var group: String { ((Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String) ?? "") + "com.abayadesignstudio.shared" }
    private static let account = "widget-token"

    static var token: String? {
        var q = base(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func save(_ token: String) {
        SecItemDelete(base() as CFDictionary)
        var q = base()
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.abayadesignstudio.widget",
         kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
    }

    /// POST an action ("feed", "start", "pause", "resume", "stop") and get the latest feed back.
    static func call(_ action: String) async throws -> Feed {
        guard let token else { throw LinkError.notLinked }
        var req = URLRequest(url: endpoint, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-widget-token")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": action])
        let (data, resp) = try await URLSession.shared.data(for: req)
        if (resp as? HTTPURLResponse)?.statusCode == 401 { throw LinkError.notLinked }
        return try JSONDecoder().decode(Feed.self, from: data)
    }
    enum LinkError: Error { case notLinked }
}

struct Feed: Codable {
    struct Timer: Codable { let code: String; let title: String; let detail: String; let color: String?; let elapsed: Double; let paused: Bool }
    struct Recent: Codable { let code: String; let title: String; let detail: String }
    struct Pick: Codable, Hashable { let key: String; let code: String; let title: String; let detail: String; let color: String }
    struct Item: Codable, Hashable { let day: String; let time: String?; let kind: String; let title: String; let code: String?; let color: String; let overdue: Bool? }
    let today: String?
    let timer: Timer?
    let recent: Recent?
    var recents: [Pick]? = nil
    let items: [Item]?
    let error: String?
}

/// Timer buttons on the widget (work without opening the app).
struct TimerControlIntent: AppIntent {
    static var title: LocalizedStringResource = "Abaya timer"
    static var isDiscoverable = false
    @Parameter(title: "Action") var action: String
    init() {}
    init(_ action: String) { self.action = action }
    func perform() async throws -> some IntentResult {
        _ = try? await WidgetLink.call(action)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
