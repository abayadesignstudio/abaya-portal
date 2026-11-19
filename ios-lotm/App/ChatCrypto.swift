import Foundation
import CryptoKit
import CommonCrypto
import Security

// End-to-end encryption for the club chat.
//
// Each member has two key pairs, made on their phone: X25519 (to receive the group key) and Ed25519 (to sign).
// The private halves live in this phone's Keychain, and on the server only as a backup sealed with a key derived
// from the member's own recovery passphrase (PBKDF2-SHA256), which the server never sees.
// The chat has a group key per "epoch". It is sealed separately to every member's X25519 key and signed by whoever
// sealed it. A new epoch (a fresh key) starts whenever someone leaves the club, so they can't read what comes after.
// Every message is AES-GCM under the group key and signed by its sender.

struct ChatIdentity {
    let agree: Curve25519.KeyAgreement.PrivateKey
    let sign: Curve25519.Signing.PrivateKey
    var agreePub: String { agree.publicKey.rawRepresentation.base64EncodedString() }
    var signPub: String { sign.publicKey.rawRepresentation.base64EncodedString() }
    var raw: Data { agree.rawRepresentation + sign.rawRepresentation }
    init() { agree = .init(); sign = .init() }
    init(raw: Data) throws {
        guard raw.count == 64 else { throw ChatError("This key is damaged.") }
        agree = try .init(rawRepresentation: raw.prefix(32))
        sign = try .init(rawRepresentation: raw.suffix(32))
    }
}

struct ChatError: LocalizedError { let m: String; init(_ m: String) { self.m = m }; var errorDescription: String? { m } }

/// The private keys, kept on this phone only (not synced to iCloud; the passphrase backup is how they move).
enum ChatKeychain {
    private static let service = "org.lotmstudy.chat"
    static func load(_ user: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: user, kSecReturnData as String: true]
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
    static func save(_ user: String, _ data: Data) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: user]
        SecItemDelete(q as CFDictionary)
        var add = q; add[kSecValueData as String] = data; add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

enum ChatCrypto {
    static let rounds = 600_000

    static func passKey(_ pass: String, salt: Data, rounds: Int) -> SymmetricKey {
        var out = [UInt8](repeating: 0, count: 32)
        let pw = Array(pass.precomposedStringWithCanonicalMapping.utf8)
        let s = [UInt8](salt)
        _ = pw.withUnsafeBufferPointer { p in
            s.withUnsafeBufferPointer { sp in
                p.baseAddress!.withMemoryRebound(to: Int8.self, capacity: p.count) { pp in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pp, p.count, sp.baseAddress, s.count,
                                         CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(rounds), &out, 32)
                }
            }
        }
        return SymmetricKey(data: out)
    }

    static func backup(_ id: ChatIdentity, pass: String, user: String) throws -> (backup: String, salt: String, rounds: Int) {
        var salt = Data(count: 16); _ = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let k = passKey(pass, salt: salt, rounds: rounds)
        let box = try AES.GCM.seal(id.raw, using: k, authenticating: Data("lotm-chat-backup|\(user)".utf8))
        return (box.combined!.base64EncodedString(), salt.base64EncodedString(), rounds)
    }

    static func restore(backup: String, salt: String, rounds: Int, pass: String, user: String) throws -> ChatIdentity {
        guard let b = Data(base64Encoded: backup), let s = Data(base64Encoded: salt) else { throw ChatError("The backup is damaged.") }
        let k = passKey(pass, salt: s, rounds: rounds)
        guard let raw = try? AES.GCM.open(AES.GCM.SealedBox(combined: b), using: k, authenticating: Data("lotm-chat-backup|\(user)".utf8)) else {
            throw ChatError("That passphrase doesn’t match.")
        }
        return try ChatIdentity(raw: raw)
    }

    // MARK: group key shares

    private static func shareKey(_ secret: SharedSecret, eph: String, to: String, ctx: String) -> SymmetricKey {
        secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data((eph + to).utf8), sharedInfo: Data(ctx.utf8), outputByteCount: 32)
    }
    private static func shareText(conv: String, epoch: Int, user: String, to: String, eph: String, sealed: String) -> Data {
        Data("lotm-chat-share|\(conv)|\(epoch)|\(user.lowercased())|\(to)|\(eph)|\(sealed)".utf8)
    }

    static func seal(_ group: SymmetricKey, conv: String, epoch: Int, user: String, to recipient: String, by me: ChatIdentity) throws -> (eph: String, sealed: String, sig: String) {
        guard let rd = Data(base64Encoded: recipient) else { throw ChatError("A member’s key is damaged.") }
        let rpub = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: rd)
        let e = Curve25519.KeyAgreement.PrivateKey(), eph = e.publicKey.rawRepresentation.base64EncodedString()
        let k = shareKey(try e.sharedSecretFromKeyAgreement(with: rpub), eph: eph, to: recipient, ctx: "lotm-chat-share|\(conv)|\(epoch)|\(user.lowercased())")
        let sealed = try AES.GCM.seal(group.withUnsafeBytes { Data($0) }, using: k).combined!.base64EncodedString()
        let sig = try me.sign.signature(for: shareText(conv: conv, epoch: epoch, user: user, to: recipient, eph: eph, sealed: sealed)).base64EncodedString()
        return (eph, sealed, sig)
    }

    static func open(conv: String, epoch: Int, user: String, to: String, eph: String, sealed: String, sig: String, signer: String, me: ChatIdentity) throws -> SymmetricKey {
        guard let sk = Data(base64Encoded: signer), let sg = Data(base64Encoded: sig), let ed = Data(base64Encoded: eph), let sd = Data(base64Encoded: sealed) else { throw ChatError("damaged") }
        let spub = try Curve25519.Signing.PublicKey(rawRepresentation: sk)
        guard spub.isValidSignature(sg, for: shareText(conv: conv, epoch: epoch, user: user, to: to, eph: eph, sealed: sealed)) else { throw ChatError("unsigned") }
        let k = shareKey(try me.agree.sharedSecretFromKeyAgreement(with: try .init(rawRepresentation: ed)), eph: eph, to: to, ctx: "lotm-chat-share|\(conv)|\(epoch)|\(user.lowercased())")
        return SymmetricKey(data: try AES.GCM.open(AES.GCM.SealedBox(combined: sd), using: k))
    }

    // MARK: messages and photos

    static func encrypt(_ data: Data, key: SymmetricKey, aad: String) throws -> Data {
        try AES.GCM.seal(data, using: key, authenticating: Data(aad.utf8)).combined!
    }
    static func decrypt(_ data: Data, key: SymmetricKey, aad: String) throws -> Data {
        try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: Data(aad.utf8))
    }
    static func msgText(conv: String, epoch: Int, user: String, id: String, ct: String) -> Data {
        Data("lotm-chat-msg|\(conv)|\(epoch)|\(user.lowercased())|\(id.lowercased())|\(ct)".utf8)
    }
    static func verify(_ sig: String, _ text: Data, signer: String?) -> Bool {
        guard let signer, let k = Data(base64Encoded: signer), let s = Data(base64Encoded: sig), let pub = try? Curve25519.Signing.PublicKey(rawRepresentation: k) else { return false }
        return pub.isValidSignature(s, for: text)
    }
    /// A short code from someone's public keys, to compare in person ("safety number").
    static func fingerprint(agree: String, sign: String) -> String {
        let h = SHA256.hash(data: Data((agree + sign).utf8))
        let digits = h.prefix(15).map { String(format: "%03d", Int($0) % 1000) }.joined()
        return stride(from: 0, to: 30, by: 5).map { i in String(digits.dropFirst(i).prefix(5)) }.joined(separator: " ")
    }
}
