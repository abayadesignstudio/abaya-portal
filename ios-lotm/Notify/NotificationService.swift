import UserNotifications
import CryptoKit
import Foundation

/// A chat notification arrives still encrypted (the server can't read it). This unlocks it on the phone,
/// with the chat's key from the shared keychain, so the banner and lock screen show the message itself.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler h: @escaping (UNNotificationContent) -> Void) {
        handler = h
        guard let c = request.content.mutableCopy() as? UNMutableNotificationContent else { return h(request.content) }
        best = c
        let u = c.userInfo
        if let conv = u["c"] as? String, let e = (u["e"] as? NSNumber)?.intValue, let ct = u["ct"] as? String, let d = Data(base64Encoded: ct),
           let kd = ChatKeyStore.load(conv: conv, epoch: e), let box = try? AES.GCM.SealedBox(combined: d),
           let pd = try? AES.GCM.open(box, using: SymmetricKey(data: kd), authenticating: Data("lotm-chat-msg|\(conv)|\(e)".utf8)),
           let p = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any] {
            var text = (p["t"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                if let poll = p["poll"] as? [String: Any] { text = "Poll: \(poll["q"] as? String ?? "")" }
                else if let a = p["att"] as? [String: Any] {
                    let m = a["m"] as? String ?? ""
                    text = m == "image/gif" ? "GIF" : m.hasPrefix("image/") ? "Photo" : m.hasPrefix("video/") ? "Video" : (a["n"] as? String ?? "Attachment")
                } else if p["img"] != nil { text = "Photo" }
            }
            if !text.isEmpty { c.body = (u["p"] as? String ?? "") + text }
        }
        h(c)
    }
    override func serviceExtensionTimeWillExpire() { if let handler, let best { handler(best) } }
}
