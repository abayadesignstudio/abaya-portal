import Foundation
import Security

/// The chat's group keys, kept in the keychain the app shares with its notification extension, so a new message's
/// text can be unlocked on this phone for its banner. They never leave the phone.
enum ChatKeyStore {
    static let group: String = {
        let prefix = (Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String) ?? ""
        return prefix + "org.lotmstudy.shared"
    }()
    private static func base(_ conv: String, _ epoch: Int) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.lotmstudy.chatkeys",
         kSecAttrAccount as String: "\(conv.lowercased())|\(epoch)", kSecAttrAccessGroup as String: group]
    }
    static func save(conv: String, epoch: Int, key: Data) {
        SecItemDelete(base(conv, epoch) as CFDictionary)
        var add = base(conv, epoch); add[kSecValueData as String] = key
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
    static func load(conv: String, epoch: Int) -> Data? {
        var q = base(conv, epoch); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
}
