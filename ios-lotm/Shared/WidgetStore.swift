import Foundation
import Security

/// The snapshot the web app hands over for the home-screen widgets, kept in the shared keychain
/// (the same no-App-Group approach as the Commonplace inbox), readable by the widget extension.
struct WidgetSnapshot: Codable {
    struct Event: Codable { var title: String; var start: String; var place: String }
    struct Book: Codable { var title: String; var author: String; var cover: String; var page: Int; var total: Int; var pct: Int }
    var v: Int
    var at: String
    var day: String        // yyyy-MM-dd the counts are for
    var goal: Int
    var done: Int
    var streak: Int
    var week: [Bool]
    var book: Book?
    var events: [Event]

    static let sample = WidgetSnapshot(v: 1, at: "", day: "", goal: 20, done: 12, streak: 2, week: [true, true, false, false, false, false, false],
        book: Book(title: "On the Incarnation", author: "St. Athanasius", cover: "", page: 48, total: 120, pct: 40),
        events: [Event(title: "Study · On the Incarnation", start: ISO8601DateFormatter().string(from: Date().addingTimeInterval(2 * 86400)), place: "Coppell")])
}

enum WidgetStore {
    static let group: String = {
        let prefix = (Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String) ?? ""
        return prefix + "org.lotmstudy.shared"
    }()
    private static let account = "widget-snapshot"
    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.lotmstudy.app",
         kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
    }
    static func save(_ json: Data) {
        guard (try? JSONDecoder().decode(WidgetSnapshot.self, from: json)) != nil else { return }
        let q = base()
        let status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: json] as CFDictionary)
        if status == errSecItemNotFound {
            var add = q; add[kSecValueData as String] = json
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(add as CFDictionary, nil)
        }
    }
    static func load() -> WidgetSnapshot? {
        var q = base(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: d)
    }
}
