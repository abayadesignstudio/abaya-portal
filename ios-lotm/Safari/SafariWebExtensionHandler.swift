import Foundation
import SafariServices

/// Safari hands this the passage chosen on a web page (see content.js). It goes into the same queue the share sheet
/// uses, and the app files it in the notebook the next time it is opened.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let msg = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        var ok = false
        if let m = msg, let text = (m["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            let kind = ["quote", "vocab", "entry"].contains(m["kind"] as? String ?? "") ? m["kind"] as? String : "quote"
            let url = (m["url"] as? String).flatMap { $0.hasPrefix("http") ? $0 : nil }
            Inbox.push(.init(text: String(text.prefix(20_000)), url: url, title: m["title"] as? String, at: Date(), kind: kind))
            ok = true
        }
        let out = NSExtensionItem(); out.userInfo = [SFExtensionMessageKey: ["ok": ok]]
        context.completeRequest(returningItems: [out], completionHandler: nil)
    }
}
