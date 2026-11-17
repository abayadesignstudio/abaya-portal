import Foundation
import Security

/// A tiny queue in the shared keychain: the share extension drops passages here,
/// and the app picks them up next time it opens (no App Group needed).
enum Inbox {
    static let group: String = {
        let prefix = (Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String) ?? ""
        return prefix + "org.lotmstudy.shared"
    }()
    private static let account = "commonplace-inbox"

    struct Item: Codable { var text: String; var url: String?; var title: String?; var at: Date }

    static func load() -> [Item] {
        var q = base(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return [] }
        return (try? JSONDecoder().decode([Item].self, from: d)) ?? []
    }
    static func save(_ items: [Item]) {
        let data = (try? JSONEncoder().encode(items)) ?? Data()
        SecItemDelete(base() as CFDictionary)
        if items.isEmpty { return }
        var add = base(); add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
    static func push(_ item: Item) { var all = load(); all.append(item); save(all) }
    static func popAll() -> [Item] { let all = load(); save([]); return all }

    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.lotmstudy.app",
         kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
    }
}
