import SwiftUI
import PhotosUI
import CryptoKit
import WebKit
import ImageIO
import QuickLook
import UniformTypeIdentifiers

// Chat: the club's chat, one-to-one messages and small groups — all end-to-end encrypted (see ChatCrypto.swift).
// Only in the iPhone app.

struct CMsg: Identifiable, Equatable {
    let id: String, userId: String, created: Date
    var epoch = 0, text = "", replyTo: String? = nil
    var deleted = false, unreadable = false, unverified = false
    /// shown at once when you send; pending until the server has it, failed if it couldn't be sent
    var pending = false, failed = false
    var att: CAtt? = nil, poll: CPoll? = nil
    /// emoji → who reacted; member → the poll option they chose
    var reacts: [String: [String]] = [:], votes: [String: Int] = [:]
    // reactions and votes are messages too (encrypted like the rest); they are folded into their target, not shown
    var ctl: String? = nil, target: String? = nil, emoji: String? = nil, option: Int? = nil
}
struct CAtt: Equatable { let path: String, name: String, mime: String, size: Int
    var isImage: Bool { mime.hasPrefix("image/") }
    var isVideo: Bool { mime.hasPrefix("video/") }
}
struct CPoll: Equatable { let q: String, opts: [String] }
/// Something about to be sent with a message: a photo, GIF, video or any file.
struct Outgoing { let data: Data, name: String, mime: String; var thumb: UIImage? = nil }

func shrinkJPEG(_ img: UIImage) -> Data? {
    let longSide = max(img.size.width, img.size.height), sc = min(1, 2048 / max(longSide, 1))
    let size = CGSize(width: (img.size.width * sc).rounded(), height: (img.size.height * sc).rounded())
    let f = UIGraphicsImageRendererFormat(); f.scale = 1
    return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82)
}
/// An emoji drawn large, for the press-and-hold menu (menus shrink plain text).
func emojiImage(_ e: String, _ s: CGFloat = 30) -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: s + 8, height: s + 8)).image { _ in
        (e as NSString).draw(at: CGPoint(x: 4, y: 2), withAttributes: [.font: UIFont.systemFont(ofSize: s)])
    }.withRenderingMode(.alwaysOriginal)
}
/// Message text with its links, and *italic*, **bold**, ~~struck~~ and `code` shown as such.
func rich(_ s: String) -> AttributedString {
    guard var a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return linked(s) }
    let plain = String(a.characters)
    guard let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return a }
    for match in d.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
        guard let url = match.url, let r = Range(match.range, in: plain),
              let lo = AttributedString.Index(r.lowerBound, within: a), let hi = AttributedString.Index(r.upperBound, within: a) else { continue }
        a[lo..<hi].link = url; a[lo..<hi].underlineStyle = .single
    }
    return a
}
/// A GIF's frames as one animated image.
func animatedGIF(_ d: Data) -> UIImage? {
    guard let src = CGImageSourceCreateWithData(d as CFData, nil) else { return nil }
    let n = CGImageSourceGetCount(src); guard n > 1 else { return UIImage(data: d) }
    var frames: [UIImage] = [], total = 0.0
    for i in 0..<min(n, 150) {
        guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
        let g = (CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [CFString: Any])?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        let t = (g?[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (g?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
        total += t < 0.02 ? 0.1 : t; frames.append(UIImage(cgImage: cg))
    }
    return UIImage.animatedImage(with: frames, duration: total)
}
struct GIFView: UIViewRepresentable {
    let img: UIImage
    func makeUIView(context: Context) -> UIImageView {
        let v = UIImageView(); v.contentMode = .scaleAspectFill; v.clipsToBounds = true
        for ax in [NSLayoutConstraint.Axis.horizontal, .vertical] { v.setContentHuggingPriority(.defaultLow, for: ax); v.setContentCompressionResistancePriority(.defaultLow, for: ax) }
        return v
    }
    func updateUIView(_ v: UIImageView, context: Context) { if v.image !== img { v.image = img; v.startAnimating() } }
}
struct CMember { let id: String, name: String, avatar: URL?; var agree: String? = nil, sign: String? = nil }
struct Convo: Identifiable, Equatable {
    let id: String, kind: String
    var title: String?, createdBy: String?, last: Date, members: [String], unread = 0, muted = false
}

/// Who you are in chat (your keys), who everyone else is, and your list of conversations.
@MainActor
final class ChatSession: ObservableObject {
    static let shared = ChatSession()
    enum Stage: Equatable { case loading, setup, restore, ready, failed(String) }
    @Published var stage: Stage = .loading
    @Published var people: [String: CMember] = [:]
    @Published var convos: [Convo] = []
    @Published var busy = false
    @Published var problem: String?
    @Published var admin = false
    @Published var blocked: Set<String> = []
    private var models: [String: ChatModel] = [:]
    /// One live model per chat, kept while the app runs, so a chat opens at once the second time.
    func model(_ c: Convo) -> ChatModel { if let m = models[c.id] { m.c = c; return m }; let m = ChatModel(c); models[c.id] = m; return m }
    weak var web: WKWebView?
    private(set) var a: SupaAuth?
    var db: Supa? { a.map { Supa(a: $0) } }
    var me: String { a?.me ?? "" }
    private(set) var id: ChatIdentity?
    private var backupRow: [String: Any]?

    func start(_ web: WKWebView?) async {
        if let web { self.web = web }
        guard let auth = await webAuth(self.web) else { stage = .failed("You’re not signed in."); return }
        if a?.me != auth.me { id = nil; stage = .loading }
        a = auth
        do {
            try await loadPeople()
            if id == nil {
                backupRow = try await db!.rows("/rest/v1/chat_keys?user_id=eq.\(me)&select=agree_key,sign_key,backup,salt,rounds").first
                if let raw = ChatKeychain.load(me), let ident = try? ChatIdentity(raw: raw), backupRow?["agree_key"] as? String == ident.agreePub { id = ident }
            }
            if id == nil { stage = backupRow == nil ? .setup : .restore; return }
            await loadConvos(); stage = .ready
        } catch { stage = .failed(error.localizedDescription) }
    }

    func setUp(pass: String) async {
        busy = true; defer { busy = false }
        do {
            let ident = ChatIdentity(), user = me
            let b = try await Task.detached { try ChatCrypto.backup(ident, pass: pass, user: user) }.value
            try await db!.req("POST", "/rest/v1/chat_keys", json: ["user_id": me, "agree_key": ident.agreePub, "sign_key": ident.signPub, "backup": b.backup, "salt": b.salt, "rounds": b.rounds, "updated_at": ISO8601DateFormatter().string(from: Date())],
                              prefer: "resolution=merge-duplicates,return=minimal")
            ChatKeychain.save(me, ident.raw); id = ident
            try await loadPeople(); await loadConvos(); stage = .ready
        } catch { problem = error.localizedDescription }
    }

    func restore(pass: String) async {
        guard let r = backupRow, let b = r["backup"] as? String, let s = r["salt"] as? String, let n = r["rounds"] as? Int else { return }
        busy = true; defer { busy = false }
        let user = me
        do {
            let ident = try await Task.detached { try ChatCrypto.restore(backup: b, salt: s, rounds: n, pass: pass, user: user) }.value
            guard ident.agreePub == r["agree_key"] as? String else { throw ChatError("That backup doesn’t match your key.") }
            ChatKeychain.save(me, ident.raw); id = ident; await loadConvos(); stage = .ready
        } catch { problem = error.localizedDescription }
    }

    func loadPeople() async throws {
        async let P = db!.rows("/rest/v1/profiles?status=eq.approved&select=id,display_name,avatar_url,role")
        async let K = db!.rows("/rest/v1/chat_keys?select=user_id,agree_key,sign_key")
        async let B = db!.rows("/rest/v1/member_mutes?user_id=eq.\(me)&select=muted_user_id")
        let (ps, ks) = try await (P, K)
        blocked = Set(((try? await B) ?? []).compactMap { $0["muted_user_id"] as? String })
        var out: [String: CMember] = [:]
        for p in ps { guard let i = p["id"] as? String else { continue }; out[i] = CMember(id: i, name: p["display_name"] as? String ?? "Member", avatar: (p["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
        for k in ks { if let i = k["user_id"] as? String, out[i] != nil { out[i]!.agree = k["agree_key"] as? String; out[i]!.sign = k["sign_key"] as? String } }
        people = out
        admin = ps.first { $0["id"] as? String == me }?["role"] as? String == "administrator"
    }

    /// Your conversations, newest first, each with how many messages came since you last read it.
    func loadConvos() async {
        guard let db, let rows = try? await db.rows("/rest/v1/conversations?select=id,kind,title,created_by,last_message_at,conversation_members(user_id,last_read_at,muted)&order=last_message_at.desc.nullslast") else { return }
        var out: [Convo] = rows.compactMap { r in
            guard let i = r["id"] as? String, let k = r["kind"] as? String else { return nil }
            let ms = (r["conversation_members"] as? [[String: Any]]) ?? []
            if k != "club" && !ms.contains(where: { $0["user_id"] as? String == me }) { return nil }
            let mine = ms.first { $0["user_id"] as? String == me }
            return Convo(id: i, kind: k, title: r["title"] as? String, createdBy: r["created_by"] as? String, last: parseDate(r["last_message_at"]), members: ms.compactMap { $0["user_id"] as? String }, muted: mine?["muted"] as? Bool ?? false)
        }
        // the club chat first, then the rest by their latest message
        out.sort { ($0.kind == "club" ? 1 : 0, $0.last) > ($1.kind == "club" ? 1 : 0, $1.last) }
        let reads = Dictionary(rows.flatMap { r in ((r["conversation_members"] as? [[String: Any]]) ?? []).filter { $0["user_id"] as? String == me }.map { (r["id"] as? String ?? "", $0["last_read_at"] as? String ?? "") } }, uniquingKeysWith: { a, _ in a })
        await withTaskGroup(of: (Int, Int).self) { g in
            for (k, c) in out.enumerated() {
                let last = reads[c.id].flatMap { $0.isEmpty ? nil : $0 } ?? "1970-01-01T00:00:00Z"
                let q = last.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? last
                g.addTask { (k, ((try? await db.rows("/rest/v1/messages?conversation_id=eq.\(c.id)&created_at=gt.\(q)&user_id=neq.\(db.a.me)&deleted_at=is.null&quiet=is.false&select=id&limit=20")) ?? []).count) }
            }
            for await (k, n) in g { out[k].unread = n }
        }
        convos = out
        await syncKeys()
        // get the first few chats ready in the background, so they open with their messages already there
        for c in out.prefix(4) { let m = model(c); Task { await m.warm() } }
    }

    /// Every chat key shared with you, unlocked and kept in this phone's keychain, so a notification can show its message.
    private var stored: Set<String> = []
    private func syncKeys() async {
        guard let db, let id, let rows = try? await db.rows("/rest/v1/chat_key_shares?user_id=eq.\(me)&select=conversation_id,epoch,recipient_key,ephemeral,sealed,signature,created_by") else { return }
        for r in rows {
            guard let c = r["conversation_id"] as? String, let e = r["epoch"] as? Int, !stored.contains("\(c)|\(e)"), let to = r["recipient_key"] as? String, to == id.agreePub,
                  let by = r["created_by"] as? String, let signer = people[by]?.sign,
                  let k = try? ChatCrypto.open(conv: c, epoch: e, user: me, to: to, eph: r["ephemeral"] as? String ?? "", sealed: r["sealed"] as? String ?? "", sig: r["signature"] as? String ?? "", signer: signer, me: id) else { continue }
            ChatKeyStore.save(conv: c, epoch: e, key: k.withUnsafeBytes { Data($0) }); stored.insert("\(c)|\(e)")
        }
    }

    var unread: Int { convos.reduce(0) { $0 + $1.unread } }

    func name(_ c: Convo) -> String {
        switch c.kind {
        case "club": return "Life of the Mind"
        case "direct": return c.members.first { $0 != me }.flatMap { people[$0]?.name } ?? "Former member"
        default: return c.title?.isEmpty == false ? c.title! : c.members.filter { $0 != me }.compactMap { people[$0]?.name.split(separator: " ").first.map(String.init) }.joined(separator: ", ")
        }
    }

    /// Your chat with one person: the one you have, or a new one.
    func direct(with other: String) async -> Convo? {
        if convos.isEmpty { await loadConvos() }
        if let c = convos.first(where: { $0.kind == "direct" && Set($0.members) == Set([me, other]) }) { return c }
        return await create(kind: "direct", title: nil, with: [other])
    }

    func create(kind: String, title: String?, with others: [String]) async -> Convo? {
        guard let db else { return nil }
        busy = true; defer { busy = false }
        do {
            var row: [String: Any] = ["kind": kind, "created_by": me]
            if let title, !title.isEmpty { row["title"] = title }
            let d = try await db.req("POST", "/rest/v1/conversations?select=id", json: row, prefer: "return=representation")
            guard let cid = ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]])?.first?["id"] as? String else { throw ChatError("Couldn’t start the chat.") }
            try await db.req("POST", "/rest/v1/conversation_members", json: ([me] + others).map { ["conversation_id": cid, "user_id": $0] }, prefer: "return=minimal")
            await loadConvos()
            return convos.first { $0.id == cid } ?? Convo(id: cid, kind: kind, title: title, createdBy: me, last: Date(), members: [me] + others)
        } catch { problem = error.localizedDescription; return nil }
    }

    func setMuted(_ c: Convo, _ v: Bool) async {
        if let k = convos.firstIndex(where: { $0.id == c.id }) { convos[k].muted = v }
        Haptic.tap()
        _ = try? await db?.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": c.id, "user_id": me, "muted": v], prefer: "resolution=merge-duplicates,return=minimal")
    }
    func block(_ uid: String) async {
        blocked.insert(uid); Haptic.tap()
        _ = try? await db?.req("POST", "/rest/v1/member_mutes", json: ["user_id": me, "muted_user_id": uid], prefer: "resolution=ignore-duplicates,return=minimal")
        NotificationCenter.default.post(name: .lotmFeedChanged, object: nil)
    }
    func unblock(_ uid: String) async {
        blocked.remove(uid); Haptic.tap()
        _ = try? await db?.req("DELETE", "/rest/v1/member_mutes?user_id=eq.\(me)&muted_user_id=eq.\(uid)")
        NotificationCenter.default.post(name: .lotmFeedChanged, object: nil)
    }
    func add(_ ids: [String], to c: Convo) async {
        _ = try? await db?.req("POST", "/rest/v1/conversation_members", json: ids.map { ["conversation_id": c.id, "user_id": $0] }, prefer: "resolution=ignore-duplicates,return=minimal")
        await loadConvos()
    }
    func remove(_ uid: String, from c: Convo) async {
        _ = try? await db?.req("DELETE", "/rest/v1/conversation_members?conversation_id=eq.\(c.id)&user_id=eq.\(uid)")
        await loadConvos()
    }

    var myFingerprint: String { id.map { ChatCrypto.fingerprint(agree: $0.agreePub, sign: $0.signPub) } ?? "" }
}

/// One conversation: its keys, its messages.
@MainActor
final class ChatModel: ObservableObject {
    enum Stage: Equatable { case loading, waiting, ready, failed(String) }
    @Published var stage: Stage = .loading
    @Published var msgs: [CMsg] = []
    @Published var c: Convo
    @Published var busy = false
    @Published var problem: String?
    @Published var muted = false
    @Published var receipts = true
    @Published var seenAt: Date?
    private var readsAt = Date.distantPast
    @Published var images: [String: UIImage] = [:]
    let s = ChatSession.shared
    private var db: Supa? { s.db }
    var me: String { s.me }
    private var conv: String { c.id }
    private var keys: [Int: SymmetricKey] = [:]
    private var latest = 0
    private var cache: [String: CMsg] = [:]
    private var timer: Task<Void, Never>?
    private var lastMaintain = Date.distantPast
    private var started = false, starting = false
    private var rows: [[String: Any]] = []      // what the server has, oldest first
    private var ticks = 0
    private var outbox: [String: (p: [String: Any], attach: Outgoing?, epoch: Int)] = [:]
    private var sendingOrder: [String] = []
    @Published var notice: String?

    init(_ c: Convo) { self.c = c }

    /// Load keys and messages without starting to watch (used to get a chat ready before it is opened).
    func warm() async {
        guard !started, !starting, s.id != nil else { return }
        starting = true; defer { starting = false }
        do {
            try await loadKeys()
            if keys[latest] != nil { try await maintain() }
            stage = keys[latest] == nil ? .waiting : .ready
            await refresh(full: true)
            if let r = try? await db!.rows("/rest/v1/conversation_members?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=muted").first { muted = r["muted"] as? Bool ?? false }
            started = true
        } catch { stage = .failed(error.localizedDescription) }
    }

    /// Who may hold this chat's key: every member for the club chat, otherwise the people in it.
    var members: [String: CMember] {
        c.kind == "club" ? s.people : s.people.filter { c.members.contains($0.key) }
    }

    func start() async {
        while starting { try? await Task.sleep(nanoseconds: 50_000_000) }
        if !started { await warm() } else { Task { await refresh(full: true) } }
        if started { markRead(); poll() }
    }

    private func loadKeys() async throws {
        guard let id = s.id, let db else { return }
        async let E = db.rows("/rest/v1/chat_epochs?conversation_id=eq.\(conv)&select=epoch&order=epoch.desc&limit=1")
        async let S = db.rows("/rest/v1/chat_key_shares?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=epoch,recipient_key,ephemeral,sealed,signature,created_by")
        let (es, ss) = try await (E, S)
        latest = es.first?["epoch"] as? Int ?? 0
        // keys this phone already unlocked (kept in its keychain) still work if whoever shared them has since left
        if latest > 0 { for e in 1...latest where keys[e] == nil { if let d = ChatKeyStore.load(conv: conv, epoch: e) { keys[e] = SymmetricKey(data: d) } } }
        for r in ss {
            guard let e = r["epoch"] as? Int, keys[e] == nil, let to = r["recipient_key"] as? String, to == id.agreePub,
                  let by = r["created_by"] as? String, let signer = s.people[by]?.sign else { continue }
            if let k = try? ChatCrypto.open(conv: conv, epoch: e, user: me, to: to, eph: r["ephemeral"] as? String ?? "", sealed: r["sealed"] as? String ?? "",
                                            sig: r["signature"] as? String ?? "", signer: signer, me: id) { keys[e] = k; ChatKeyStore.save(conv: conv, epoch: e, key: k.withUnsafeBytes { Data($0) }) }
        }
        if latest == 0 { try await newEpoch(1) }
    }

    /// Seal the newest key to anyone in the chat who doesn't have it yet; start a fresh key when someone has left.
    private func maintain() async throws {
        guard let id = s.id, let k = keys[latest], let db else { return }
        lastMaintain = Date()
        try await s.loadPeople()
        if c.kind != "club", let ms = try? await db.rows("/rest/v1/conversation_members?conversation_id=eq.\(conv)&select=user_id") {
            c.members = ms.compactMap { $0["user_id"] as? String }
        }
        let shares = try await db.rows("/rest/v1/chat_key_shares?conversation_id=eq.\(conv)&epoch=eq.\(latest)&select=user_id,recipient_key")
        let had = Dictionary(shares.compactMap { r in (r["user_id"] as? String).map { ($0, r["recipient_key"] as? String ?? "") } }, uniquingKeysWith: { a, _ in a })
        let who = members
        if had.keys.contains(where: { who[$0] == nil }) { try await newEpoch(latest + 1); return }
        var rows: [[String: Any]] = []
        for m in who.values { guard let to = m.agree, had[m.id] != to else { continue }
            rows.append(share(m.id, to, try ChatCrypto.seal(k, conv: conv, epoch: latest, user: m.id, to: to, by: id)))
        }
        if !rows.isEmpty { try await db.req("POST", "/rest/v1/chat_key_shares", json: rows, prefer: "resolution=merge-duplicates,return=minimal") }
    }

    private func share(_ user: String, _ to: String, _ x: (eph: String, sealed: String, sig: String)) -> [String: Any] {
        ["conversation_id": conv, "epoch": latest, "user_id": user, "recipient_key": to, "ephemeral": x.eph, "sealed": x.sealed, "signature": x.sig, "created_by": me]
    }

    private func newEpoch(_ n: Int) async throws {
        guard let id = s.id, let db else { return }
        do { try await db.req("POST", "/rest/v1/chat_epochs", json: ["conversation_id": conv, "epoch": n, "created_by": me], prefer: "return=minimal") }
        catch { try await loadKeys(); return }   // someone else started it a moment ago
        let k = SymmetricKey(size: .bits256); latest = n; keys[n] = k
        ChatKeyStore.save(conv: conv, epoch: n, key: k.withUnsafeBytes { Data($0) })
        var rows: [[String: Any]] = []
        for m in members.values { guard let to = m.agree else { continue }; rows.append(share(m.id, to, try ChatCrypto.seal(k, conv: conv, epoch: n, user: m.id, to: to, by: id))) }
        if !rows.isEmpty { try await db.req("POST", "/rest/v1/chat_key_shares", json: rows, prefer: "resolution=merge-duplicates,return=minimal") }
    }

    private func poll() {
        timer?.cancel()
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                guard let self else { return }
                self.ticks += 1
                await self.refresh(full: self.ticks % 12 == 0)
            }
        }
    }
    func stop() { timer?.cancel(); timer = nil }

    /// New messages are asked for every second or so (only what came since the last one); a full look, which also
    /// catches deletions, happens every quarter minute.
    func refresh(full: Bool = false) async {
        await loadReads()
        guard let db else { return }
        if stage == .waiting || Date().timeIntervalSince(lastMaintain) > 60 {
            try? await loadKeys()
            if keys[latest] != nil { try? await maintain(); if stage == .waiting { stage = .ready } }
        }
        let cols = "id,user_id,ciphertext,epoch,signature,created_at,deleted_at"
        if full || rows.isEmpty {
            guard let got = try? await db.rows("/rest/v1/messages?conversation_id=eq.\(conv)&select=\(cols)&order=created_at.desc&limit=300") else { return }
            rows = got.reversed()
        } else {
            let last = rows.last?["created_at"] as? String ?? "1970-01-01T00:00:00Z"
            let q = last.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? last
            guard let got = try? await db.rows("/rest/v1/messages?conversation_id=eq.\(conv)&created_at=gt.\(q)&select=\(cols)&order=created_at.asc&limit=100") else { return }
            if got.isEmpty { return }
            let have = Set(rows.compactMap { $0["id"] as? String })
            rows += got.filter { !have.contains($0["id"] as? String ?? "") }
        }
        var all: [CMsg] = []
        for r in rows {
            guard let mid = r["id"] as? String else { continue }
            let deleted = !(r["deleted_at"] is NSNull) && r["deleted_at"] != nil
            if var x = cache[mid] { if x.pending || x.failed { x.pending = false; x.failed = false; cache[mid] = x; outbox[mid] = nil }; if deleted && !x.deleted { x.deleted = true; x.text = ""; x.att = nil; x.poll = nil; cache[mid] = x }; all.append(cache[mid]!); continue }
            var m = CMsg(id: mid, userId: r["user_id"] as? String ?? "", created: parseDate(r["created_at"]), epoch: r["epoch"] as? Int ?? 0, deleted: deleted)
            if !deleted {
                if let e = r["epoch"] as? Int, let k = keys[e], let ct = r["ciphertext"] as? String, let d = Data(base64Encoded: ct),
                   let pd = try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-msg|\(conv)|\(e)"),
                   let p = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any], (p["id"] as? String)?.lowercased() == mid.lowercased() {
                    m.text = p["t"] as? String ?? ""; m.replyTo = p["r"] as? String
                    if let a = p["att"] as? [String: Any], let path = a["p"] as? String {
                        m.att = CAtt(path: path, name: a["n"] as? String ?? "File", mime: a["m"] as? String ?? "application/octet-stream", size: a["s"] as? Int ?? 0)
                    } else if let path = p["img"] as? String { m.att = CAtt(path: path, name: "Photo.jpg", mime: "image/jpeg", size: 0) }
                    if let q = p["poll"] as? [String: Any], let o = q["o"] as? [String] { m.poll = CPoll(q: q["q"] as? String ?? "", opts: o) }
                    m.ctl = p["k"] as? String; m.target = (p["m"] as? String)?.lowercased(); m.emoji = p["e"] as? String; m.option = p["o"] as? Int
                    m.unverified = !ChatCrypto.verify(r["signature"] as? String ?? "", ChatCrypto.msgText(conv: conv, epoch: e, user: m.userId, id: mid, ct: ct), signer: s.people[m.userId]?.sign)
                } else { m.unreadable = true }
            }
            if !m.unreadable { cache[mid] = m }
            all.append(m)
        }
        // fold reactions (each one toggles) and votes (the latest wins) into the messages they point at
        var reacts: [String: [String: [String]]] = [:], votes: [String: [String: Int]] = [:]
        for x in all where !x.deleted && !x.unreadable && !x.unverified {
            guard let t = x.target else { continue }
            if x.ctl == "react", let e = x.emoji {
                var l = reacts[t]?[e] ?? []
                if let k = l.firstIndex(of: x.userId) { l.remove(at: k) } else { l.append(x.userId) }
                reacts[t, default: [:]][e] = l.isEmpty ? nil : l
            } else if x.ctl == "vote", let o = x.option { votes[t, default: [:]][x.userId] = o < 0 ? nil : o }
        }
        var out: [CMsg] = all.filter { $0.ctl == nil && !s.blocked.contains($0.userId) }.map { var y = $0; y.reacts = reacts[y.id.lowercased()] ?? [:]; y.votes = votes[y.id.lowercased()] ?? [:]; return y }
        // what you've just sent and the server doesn't have yet stays at the bottom
        let seen = Set(all.map(\.id))
        sendingOrder.removeAll { seen.contains($0) || cache[$0] == nil }
        out += sendingOrder.compactMap { cache[$0] }
        if out != msgs { msgs = out; markRead() }
    }

    /// Seal, sign and post one message. Quiet ones (reactions, votes) ask the server not to notify anyone.
    private func post(_ p0: [String: Any], mid: String = UUID().uuidString.lowercased(), epoch: Int? = nil, quiet: Bool = false) async throws {
        let e = epoch ?? latest
        guard let db, let id = s.id, let k = keys[e] else { throw ChatError("This chat isn’t unlocked yet.") }
        var p = p0; p["id"] = mid
        let ct = try ChatCrypto.encrypt(try JSONSerialization.data(withJSONObject: p), key: k, aad: "lotm-chat-msg|\(conv)|\(e)").base64EncodedString()
        let sig = try id.sign.signature(for: ChatCrypto.msgText(conv: conv, epoch: e, user: me, id: mid, ct: ct)).base64EncodedString()
        var row: [String: Any] = ["id": mid, "conversation_id": conv, "user_id": me, "ciphertext": ct, "epoch": e, "signature": sig]
        if quiet {
            row["quiet"] = true
            if (try? await db.req("POST", "/rest/v1/messages", json: row, prefer: "return=minimal")) != nil { return }
            row["quiet"] = nil   // a server that doesn't know "quiet" yet
        }
        try await db.req("POST", "/rest/v1/messages", json: row, prefer: "return=minimal")
    }

    /// Your message appears at once; sealing and sending happen behind it. If sending fails it is marked, and a tap retries.
    func send(_ text: String, attach: Outgoing?, replyTo: String?) {
        guard keys[latest] != nil else { problem = "This chat isn’t unlocked yet."; return }
        if let attach, attach.data.count > 45_000_000 { problem = "That’s too large to send (45 MB at most)."; return }
        let mid = UUID().uuidString.lowercased(), e = latest
        var p: [String: Any] = ["t": text]
        if let replyTo { p["r"] = replyTo }
        var local = CMsg(id: mid, userId: me, created: Date(), epoch: e, text: text, replyTo: replyTo, pending: true)
        if let attach {
            let path = "\(me)/\(mid).bin"
            p["att"] = ["p": path, "n": attach.name, "m": attach.mime, "s": attach.data.count]
            local.att = CAtt(path: path, name: attach.name, mime: attach.mime, size: attach.data.count)
            if attach.mime.hasPrefix("image/") { images[path] = attach.mime == "image/gif" ? animatedGIF(attach.data) : UIImage(data: attach.data) }
        }
        cache[mid] = local; sendingOrder.append(mid); outbox[mid] = (p, attach, e)
        msgs.append(local)
        Haptic.tap()
        deliver(mid)
    }

    func retry(_ m: CMsg) {
        guard m.failed, outbox[m.id] != nil else { return }
        cache[m.id]?.failed = false; cache[m.id]?.pending = true
        if let k = msgs.firstIndex(where: { $0.id == m.id }) { msgs[k].failed = false; msgs[k].pending = true }
        deliver(m.id)
    }

    private func deliver(_ mid: String) {
        guard let job = outbox[mid], let db, let k = keys[job.epoch] else { return }
        Task {
            do {
                if let a = job.attach, let path = (job.p["att"] as? [String: Any])?["p"] as? String {
                    let sealed = try ChatCrypto.encrypt(a.data, key: k, aad: "lotm-chat-img|\(conv)|\(job.epoch)|\(path)")
                    try await db.req("POST", "/storage/v1/object/chat-sealed/\(path)", raw: sealed, type: "application/octet-stream", prefer: nil, extra: ["x-upsert": "true"])
                }
                try await post(job.p, mid: mid, epoch: job.epoch)
                outbox[mid] = nil
                cache[mid]?.pending = false
                if let i = msgs.firstIndex(where: { $0.id == mid }) { msgs[i].pending = false }
                await refresh()
            } catch {
                cache[mid]?.pending = false; cache[mid]?.failed = true
                if let i = msgs.firstIndex(where: { $0.id == mid }) { msgs[i].pending = false; msgs[i].failed = true }
            }
        }
    }

    func report(_ m: CMsg, _ why: String) async {
        let who = s.people[m.userId]?.name ?? "a member"
        let what = !m.text.isEmpty ? "“\(m.text.prefix(500))”" : m.poll != nil ? "a poll" : "an attachment"
        let reason = "Chat message from \(who): \(what)" + (why.isEmpty ? "" : " — \(why)")
        do { try await db?.req("POST", "/rest/v1/reports", json: ["reporter_id": me, "message_id": m.id, "reason": reason], prefer: "return=minimal"); notice = "Reported to the administrators. They review reports within 24 hours." }
        catch { problem = error.localizedDescription }
    }

    func sendPoll(_ q: String, _ opts: [String]) async {
        do { try await post(["t": "", "poll": ["q": q, "o": opts]]); Haptic.tap(); await refresh() } catch { problem = error.localizedDescription }
    }
    func react(_ m: CMsg, _ e: String) async {
        Haptic.tap()
        if let i = msgs.firstIndex(where: { $0.id == m.id }) {
            var l = msgs[i].reacts[e] ?? []
            if let k = l.firstIndex(of: me) { l.remove(at: k) } else { l.append(me) }
            msgs[i].reacts[e] = l.isEmpty ? nil : l
        }
        do { try await post(["k": "react", "m": m.id.lowercased(), "e": e], quiet: true); await refresh() } catch { problem = error.localizedDescription }
    }
    func vote(_ m: CMsg, _ o: Int) async {
        Haptic.tap()
        if let i = msgs.firstIndex(where: { $0.id == m.id }) { msgs[i].votes[me] = m.votes[me] == o ? nil : o }
        do { try await post(["k": "vote", "m": m.id.lowercased(), "o": m.votes[me] == o ? -1 : o], quiet: true); await refresh() } catch { problem = error.localizedDescription }
    }

    func delete(_ m: CMsg) async {
        guard let db else { return }
        _ = try? await db.req("PATCH", "/rest/v1/messages?id=eq.\(m.id)" + (m.userId == me ? "&user_id=eq.\(me)" : ""), json: ["deleted_at": ISO8601DateFormatter().string(from: Date()), "ciphertext": NSNull()], prefer: "return=minimal")
        if let p = m.att?.path { _ = try? await db.req("DELETE", "/storage/v1/object/chat-sealed/\(p)") }
        cache[m.id]?.deleted = true; sendingOrder.removeAll { $0 == m.id }; outbox[m.id] = nil; await refresh(full: true)
    }

    /// An attachment, fetched and opened with the key of the message it came with.
    private func data(_ m: CMsg) async -> Data? {
        guard let a = m.att, let db, let k = keys[m.epoch], let d = try? await db.req("GET", "/storage/v1/object/authenticated/chat-sealed/\(a.path)") else { return nil }
        return try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-img|\(conv)|\(m.epoch)|\(a.path)")
    }
    func photo(_ m: CMsg) async {
        guard let a = m.att, a.isImage, images[a.path] == nil, let d = await data(m) else { return }
        images[a.path] = a.mime == "image/gif" ? animatedGIF(d) : UIImage(data: d)
    }
    /// A video or file, opened into a temporary copy on this phone so it can be viewed.
    func file(_ m: CMsg) async -> URL? {
        guard let a = m.att, let d = await data(m) else { return nil }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("lotm-chat/\(m.id)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = a.name.replacingOccurrences(of: "/", with: "-")
        let u = dir.appendingPathComponent(name.isEmpty ? "File" : name)
        do { try d.write(to: u, options: .completeFileProtection); return u } catch { return nil }
    }

    /// Your own choice, kept with your membership of this chat; nobody else is told.
    func setReceipts(_ v: Bool) async {
        receipts = v; Haptic.tap()
        _ = try? await db?.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": conv, "user_id": me, "read_receipts": v], prefer: "resolution=merge-duplicates,return=minimal")
    }
    /// When the other person last opened this chat, if they share read receipts (and you do: receipts are mutual).
    func loadReads() async {
        guard let db, Date().timeIntervalSince(readsAt) > 6 else { return }
        readsAt = Date()
        guard let rows = try? await db.rows("/rest/v1/conversation_members?conversation_id=eq.\(conv)&select=user_id,last_read_at,read_receipts,muted") else { return }
        var seen: Date?
        for r in rows {
            let uid = r["user_id"] as? String ?? ""
            if uid == me { receipts = r["read_receipts"] as? Bool ?? true; continue }
            if r["read_receipts"] as? Bool ?? true, let s = r["last_read_at"] as? String { let d = parseDate(s); if d > (seen ?? .distantPast) { seen = d } }
        }
        let v = receipts ? seen : nil
        if v != seenAt { seenAt = v }
    }
    func setMuted(_ v: Bool) async {
        muted = v; Haptic.tap()
        _ = try? await db?.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": conv, "user_id": me, "muted": v], prefer: "resolution=merge-duplicates,return=minimal")
    }

    private func markRead() {
        guard let db else { return }
        let cid = conv, me = me
        Task {
            _ = try? await db.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": cid, "user_id": me, "last_read_at": ISO8601DateFormatter().string(from: Date())], prefer: "resolution=merge-duplicates,return=minimal")
            if let k = s.convos.firstIndex(where: { $0.id == cid }) { s.convos[k].unread = 0 }
        }
    }

}

/// How many messages arrived since you last read each of your chats (for the badge on the dock's chat button).
@MainActor func chatUnread(web: WKWebView?) async -> Int {
    let s = ChatSession.shared
    if s.a == nil { await s.start(web) }
    guard s.a != nil else { return 0 }
    await s.loadConvos()
    return s.unread
}

/// The chat list slides in (the dock's chat button); a notification or a profile's Message button can go straight to a chat.
/// Chat is built but not yet opened to members: while this is off its tab reads "Coming soon", nothing of it loads,
/// and the ways into a conversation lead to that page.
let chatOpen = true

struct ChatSoon: View {
    var body: some View {
        VStack(spacing: 10) {
            GlyphView(n: "chat", s: 40).foregroundStyle(T.muted)
            Text("Chat").font(.serif(26, .semibold)).foregroundStyle(T.ink).padding(.top, 6)
            Text("Coming soon").font(.sans(13, .bold)).tracking(1.4).textCase(.uppercase).foregroundStyle(T.paper).padding(.horizontal, 14).frame(height: 28).background(Capsule().fill(T.ink))
            Text("Private, end-to-end encrypted messages and group conversations for LOTM.").font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: 280).padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(.bottom, 120).background(T.paper.ignoresSafeArea())
    }
}

@MainActor func openChat(_ web: WebModel, conv: String? = nil, with person: String? = nil) {
    guard chatOpen else { web.select(.chat); return }
    ChatSession.shared.web = web.view
    // The list of chats is a page of the app, under its header; a particular chat slides in over it.
    if conv == nil && person == nil { web.select(.chat); return }
    // One chat at a time: whatever is open (another chat, a post, a profile) is put away first and the Chat tab shown,
    // so swiping back out of any chat always lands on the list of chats.
    let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
    ChatListScreen.showing = false
    let go = {
        web.select(.chat)
        let s = ChatSession.shared
        Task { @MainActor in
            if s.stage == .ready {
                if s.convos.isEmpty { await s.loadConvos() }
                var c = conv.flatMap { id in s.convos.first { $0.id == id } }
                if c == nil, let person, person != s.me { c = await s.direct(with: person) }
                if let c { presentSlide(ChatScreen(m: s.model(c))); return }
            }
            ChatListScreen.showing = true
            presentSlide(ChatListScreen(s: s, goTo: conv, with: person))
        }
    }
    if root?.presentedViewController != nil { root?.dismiss(animated: false, completion: go) } else { go() }
}

/// window.webkit.messageHandlers.chat.postMessage(userId) — a profile's Message button.
final class ChatHandler: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let uid = m.body as? String, let model else { return }
        DispatchQueue.main.async { openChat(model, with: uid) }
    }
}

// MARK: - The list of chats

struct ChatListScreen: View {
    static var showing = false
    @ObservedObject var s: ChatSession
    var goTo: String? = nil
    var with: String? = nil
    var embedded = false
    @Environment(\.closeScreen) private var close
    @State private var composing = false
    @State private var went = false
    @State private var removing: Convo?

    var body: some View {
        VStack(spacing: 0) {
            if !embedded {
                PageBar(title: "Chat", onBack: { close() }) {
                    if s.stage == .ready {
                        Button { composing = true } label: { GlyphView(n: "pencil", s: 20).foregroundStyle(T.ink).frame(width: 40, height: 36) }
                            .accessibilityLabel("New message")
                    }
                }
            } else if s.stage != .ready { heading }
            switch s.stage {
            case .loading: Spacer(); ProgressView().tint(T.muted); Spacer()
            case .setup: KeySetup(s: s, restoring: false)
            case .restore: KeySetup(s: s, restoring: true)
            case .failed(let f): Spacer(); Text(f).font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(40); Spacer()
            case .ready: list
            }
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark).tint(T.ink)
        .task { await s.start(nil); await jump() }
        .onChange(of: s.stage) { _, st in if st == .ready { Task { await jump() } } }
        .onDisappear { if !embedded { ChatListScreen.showing = false } }
        .sheet(isPresented: $composing) { NewChat(s: s) { c in composing = false; open(c) } }
    }

    /// As a page of the app, its title and the new-message button scroll with the list.
    private var heading: some View {
        HStack {
            Text("Chat").font(.serif(20, .semibold)).foregroundStyle(T.ink)
            Spacer()
            if s.stage == .ready {
                Button { composing = true } label: { GlyphView(n: "pencil", s: 20).foregroundStyle(T.ink).frame(width: 40, height: 36) }
                    .buttonStyle(.plain).accessibilityLabel("New message")
            }
        }
        .padding(.leading, 20).padding(.trailing, 10).frame(height: 50)
    }

    private var list: some View {
        List {
            if embedded { heading.listRowInsets(EdgeInsets()).listRowBackground(T.paper).listRowSeparator(.hidden) }
            ForEach(s.convos) { c in
                Button { open(c) } label: { row(c) }.buttonStyle(.plain)
                    .listRowInsets(EdgeInsets()).listRowBackground(T.paper).listRowSeparator(.hidden)
                    // swipe left: mute, or (for anything but the club chat) delete
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if c.kind != "club" { Button(role: .destructive) { removing = c } label: { Label(c.kind == "group" ? "Leave" : "Delete", systemImage: "trash") } }
                        Button { Task { await s.setMuted(c, !c.muted) } } label: { Label(c.muted ? "Unmute" : "Mute", systemImage: c.muted ? "bell" : "bell.slash") }.tint(Color(rgb: 0x6f7350))
                    }
            }
            VStack(spacing: 0) {
                if s.convos.count <= 1 {
                    Button { composing = true } label: {
                        Text("Message someone in the club").font(.sans(15, .semibold)).foregroundStyle(T.paper)
                            .padding(.horizontal, 20).frame(height: 44).background(Capsule().fill(T.ink))
                    }
                    .buttonStyle(.plain).padding(.top, 28)
                }
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold))
                    Text("Every chat is end-to-end encrypted.").font(.sans(12))
                }
                .foregroundStyle(T.muted).padding(.top, 24).padding(.bottom, 120)
            }
            .frame(maxWidth: .infinity)
            .listRowInsets(EdgeInsets()).listRowBackground(T.paper).listRowSeparator(.hidden)
        }
        .listStyle(.plain).scrollContentBackground(.hidden)
        .refreshable { await s.loadConvos() }
        .confirmationDialog(removing?.kind == "group" ? "Leave this group?" : "Delete this chat?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button(removing?.kind == "group" ? "Leave" : "Delete", role: .destructive) { if let c = removing { Task { await s.remove(s.me, from: c) } } }
        } message: { Text("It’s removed from your list and you stop getting its messages. The others keep their copy.") }
    }

    private func row(_ c: Convo) -> some View {
        HStack(spacing: 12) {
            ConvoFace(s: s, c: c, size: 50)
            VStack(alignment: .leading, spacing: 3) {
                Text(s.name(c)).font(.serif(18, .semibold)).foregroundStyle(T.ink).lineLimit(1)
                Text(c.kind == "club" ? "Everyone in the club" : c.kind == "group" ? "\(c.members.count) people" : "Direct message")
                    .font(.sans(13)).foregroundStyle(T.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 4) {
                    if c.muted { Image(systemName: "bell.slash.fill").font(.system(size: 10)).foregroundStyle(T.muted) }
                    Text(c.last.timeIntervalSince1970 < 86400 ? "" : ago(c.last)).font(.sans(12)).foregroundStyle(T.muted)
                }
                if c.unread > 0 {
                    Text(c.unread > 9 ? "9+" : "\(c.unread)").font(.sans(11, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).frame(minWidth: 20, minHeight: 20).background(Capsule().fill(T.like))
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) { T.rule.frame(height: 0.5).padding(.leading, 82) }
    }

    private func open(_ c: Convo) { Haptic.tap(); presentSlide(ChatScreen(m: s.model(c))) }

    /// Straight to a chat: from a notification (a conversation) or a profile's Message button (a person).
    private func jump() async {
        guard s.stage == .ready, !went else { return }
        if let goTo { went = true; if let c = s.convos.first(where: { $0.id == goTo }) { open(c) } }
        else if let with, with != s.me { went = true; if let c = await s.direct(with: with) { open(c) } }
    }
}

/// A chat's picture: the club's LM mark, the other person's face, or a group's two faces.
private struct ConvoFace: View {
    @ObservedObject var s: ChatSession
    let c: Convo, size: CGFloat
    var body: some View {
        let others = c.members.filter { $0 != s.me }
        if c.kind == "club" {
            Text("LM").font(.serif(size * 0.36, .semibold)).foregroundStyle(T.paper).frame(width: size, height: size).background(RoundedRectangle(cornerRadius: size * 0.28).fill(T.ink))
        } else if c.kind == "direct" || others.count < 2 {
            Face(name: others.first.flatMap { s.people[$0]?.name } ?? "", url: others.first.flatMap { s.people[$0]?.avatar }, s: size)
        } else {
            ZStack(alignment: .bottomTrailing) {
                Face(name: s.people[others[0]]?.name ?? "", url: s.people[others[0]]?.avatar, s: size * 0.68).frame(width: size, height: size, alignment: .topLeading)
                Face(name: s.people[others[1]]?.name ?? "", url: s.people[others[1]]?.avatar, s: size * 0.68).overlay(Circle().stroke(T.paper, lineWidth: 2))
            }
            .frame(width: size, height: size)
        }
    }
}

/// Pick one person for a direct message, or several (and a name) for a group.
private struct NewChat: View {
    @ObservedObject var s: ChatSession
    var adding: Convo? = nil
    let done: (Convo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var picked: [String] = []
    @State private var title = ""
    private var everyone: [CMember] {
        s.people.values.filter { $0.id != s.me && !(adding?.members.contains($0.id) ?? false) }
            .filter { q.isEmpty || $0.name.localizedCaseInsensitiveContains(q) }.sorted { $0.name < $1.name }
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("", text: $q, prompt: Text("Search members").foregroundColor(T.muted))
                    .font(.sans(16)).foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                    .padding(.horizontal, 16).padding(.top, 8)
                if picked.count > 1 && adding == nil {
                    TextField("", text: $title, prompt: Text("Group name (optional)").foregroundColor(T.muted))
                        .font(.serif(17)).foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                        .padding(.horizontal, 16).padding(.top, 8)
                }
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(everyone, id: \.id) { p in
                            Button {
                                Haptic.tap()
                                if let k = picked.firstIndex(of: p.id) { picked.remove(at: k) } else { picked.append(p.id) }
                            } label: {
                                HStack(spacing: 12) {
                                    Face(name: p.name, url: p.avatar, s: 40)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.name).font(.sans(16, .semibold)).foregroundStyle(T.ink)
                                        if p.agree == nil { Text("Hasn’t opened chat yet — they’ll see it once they do").font(.sans(12)).foregroundStyle(T.muted) }
                                    }
                                    Spacer()
                                    Image(systemName: picked.contains(p.id) ? "checkmark.circle.fill" : "circle").font(.system(size: 22)).foregroundStyle(picked.contains(p.id) ? T.ink : T.muted)
                                }
                                .padding(.horizontal, 20).padding(.vertical, 10).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .background(T.paper.ignoresSafeArea())
            .navigationTitle(adding != nil ? "Add people" : picked.count > 1 ? "New group" : "New message").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(adding != nil ? "Add" : picked.count > 1 ? "Create" : "Chat") {
                        Task {
                            if let adding { await s.add(picked, to: adding); dismiss(); return }
                            let c = picked.count == 1 ? await s.direct(with: picked[0]) : await s.create(kind: "group", title: title.trimmingCharacters(in: .whitespaces), with: picked)
                            if let c { done(c) }
                        }
                    }
                    .disabled(picked.isEmpty || s.busy).fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark).tint(T.ink)
    }
}

// MARK: - One chat

struct ChatScreen: View {
    @ObservedObject var m: ChatModel
    @Environment(\.closeScreen) private var close
    @State private var reportingMsg: CMsg?
    @State private var why = ""
    @State private var text = ""
    @State private var attach: Outgoing?
    @State private var pick: PhotosPickerItem?
    @State private var picking = false
    @State private var filing = false
    @State private var polling = false
    @State private var gifs = false
    @State private var deleting: CMsg?
    @State private var reacting: CMsg?
    @State private var dragId: String?
    @State private var dragX: CGFloat = 0
    @State private var preview: URL?
    @State private var opening: String?
    @State private var replyTo: CMsg?
    @State private var info = false
    @State private var zoom: UIImage?
    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            switch m.stage {
            case .loading: Spacer(); ProgressView().tint(T.muted); Spacer()
            case .failed(let f): Spacer(); Text(f).font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(40); Spacer()
            case .waiting, .ready: thread
            }
        }
        .background(T.paper.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { if m.stage == .ready { bar } }
        .preferredColorScheme(.dark).tint(T.ink)
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .task { await m.start() }
        .onDisappear { m.stop(); Task { await m.s.loadConvos() } }
        .sheet(isPresented: $info) { ChatInfo(m: m) { close() } }
        .sheet(item: $reacting) { msg in EmojiPicker { e in reacting = nil; Task { await m.react(msg, e) } }.presentationDetents([.medium, .large]) }
        .alert("Report this message?", isPresented: Binding(get: { reportingMsg != nil }, set: { if !$0 { reportingMsg = nil } })) {
            TextField("What’s wrong? (optional)", text: $why)
            Button("Cancel", role: .cancel) {}
            Button("Report") { if let x = reportingMsg { Task { await m.report(x, why) } } }
        } message: { Text("The message’s text is sent to the administrators with your report.") }
        .alert("Thank you", isPresented: Binding(get: { m.notice != nil }, set: { if !$0 { m.notice = nil } })) { Button("OK", role: .cancel) {} } message: { Text(m.notice ?? "") }
        .sheet(isPresented: $gifs) { GifPicker(db: m.s.db) { d in attach = Outgoing(data: d, name: "Animation.gif", mime: "image/gif", thumb: UIImage(data: d)) } }
        .confirmationDialog("Delete this message for everyone?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let d = deleting { Task { await m.delete(d) } } }
        }
        .sheet(isPresented: $polling) { PollMaker { q, o in Task { await m.sendPoll(q, o) } } }
        .quickLookPreview($preview)
        .photosPicker(isPresented: $picking, selection: $pick, matching: .any(of: [.images, .videos]))
        .onChange(of: pick) { _, it in
            guard let it else { return }
            Task {
                let types = it.supportedContentTypes
                if let d = try? await it.loadTransferable(type: Data.self) {
                    if let v = types.first(where: { $0.conforms(to: .movie) }) {
                        attach = Outgoing(data: d, name: "Video.\(v.preferredFilenameExtension ?? "mov")", mime: v.preferredMIMEType ?? "video/quicktime")
                    } else if types.contains(where: { $0.conforms(to: .gif) }) {
                        attach = Outgoing(data: d, name: "Animation.gif", mime: "image/gif", thumb: UIImage(data: d))
                    } else if let img = UIImage(data: d), let jpg = shrinkJPEG(img) {
                        attach = Outgoing(data: jpg, name: "Photo.jpg", mime: "image/jpeg", thumb: img)
                    }
                }
                pick = nil
            }
        }
        .fileImporter(isPresented: $filing, allowedContentTypes: [.item]) { res in
            guard case .success(let u) = res else { return }
            let ok = u.startAccessingSecurityScopedResource(); defer { if ok { u.stopAccessingSecurityScopedResource() } }
            guard let d = try? Data(contentsOf: u) else { m.problem = "Couldn’t read that file."; return }
            let t = UTType(filenameExtension: u.pathExtension)
            let mime = t?.preferredMIMEType ?? "application/octet-stream"
            attach = Outgoing(data: d, name: u.lastPathComponent, mime: mime, thumb: mime.hasPrefix("image/") ? UIImage(data: d) : nil)
        }
        .fullScreenCover(item: Binding(get: { zoom.map { ZoomBox(img: $0) } }, set: { zoom = $0?.img })) { z in
            ZoomImageView(img: z.img) { zoom = nil }
        }
        .alert("Couldn’t send", isPresented: Binding(get: { m.problem != nil }, set: { if !$0 { m.problem = nil } })) { Button("OK", role: .cancel) {} } message: { Text(m.problem ?? "") }
    }

    private var subtitle: String {
        switch m.c.kind {
        case "club": return "\(m.members.count) members"
        case "group": return "\(m.c.members.count) people"
        default: return "Direct message"
        }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button { close() } label: { GlyphView(n: "back", s: 24).foregroundStyle(T.ink).frame(width: 40, height: 40) }
            Button { info = true } label: {
                VStack(spacing: 3) {
                    ConvoFace(s: m.s, c: m.c, size: 46)
                    Text(m.s.name(m.c)).font(.serif(18, .semibold)).foregroundStyle(T.ink).lineLimit(1)
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill").font(.system(size: 9, weight: .semibold))
                        Text("\(subtitle) · end-to-end encrypted").font(.sans(12))
                    }.foregroundStyle(T.muted)
                }
                .frame(maxWidth: .infinity)
            }.buttonStyle(.plain)
            Color.clear.frame(width: 40, height: 40)     // (alerts are set under the picture, in the chat's own page)
        }
        .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 8)
        .background(Color(rgb: 0x3a3d2b, 0.96))
        .overlay(alignment: .bottom) {
            if m.msgs.contains(where: { $0.failed }) { T.danger.frame(height: 2) }
            else if m.msgs.contains(where: { $0.pending }) { ProgressView().progressViewStyle(.linear).tint(Color(rgb: 0x5a9a68)).frame(height: 2).scaleEffect(x: 1, y: 0.6, anchor: .bottom) }
            else { T.rule.frame(height: 1) }
        }
    }

    /// Under your latest message: whether it is on its way, delivered, or (if they share receipts) read.
    @ViewBuilder private var receipt: some View {
        if let last = m.msgs.last(where: { $0.ctl == nil && !$0.deleted }), last.userId == m.me {
            let t: String = last.failed ? "Not delivered · tap the message to try again" : last.pending ? "Sending…"
                : (m.c.kind == "direct" && (m.seenAt ?? .distantPast) >= last.created) ? "Read " + (m.seenAt ?? Date()).formatted(date: .omitted, time: .shortened) : "Delivered"
            Text(t).font(.sans(11.5, .medium)).foregroundStyle(last.failed ? T.danger : T.muted).frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 18).padding(.top, 1)
        }
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if m.stage == .waiting {
                        Text("You’re in. The key that unlocks this chat is shared with you the next time someone else in it opens it.")
                            .font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(24)
                    } else if m.msgs.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "lock.fill").font(.system(size: 22)).foregroundStyle(T.muted)
                            Text("Messages here are end-to-end encrypted. Only the people in this chat, on their phones, can read them — not the server, and not us.")
                                .font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity).padding(32)
                    }
                    ForEach(Array(m.msgs.enumerated()), id: \.element.id) { i, msg in
                        row(msg, prev: i > 0 ? m.msgs[i - 1] : nil).id(msg.id)
                    }
                    receipt
                    Color.clear.frame(height: 4).id("end")
                }
                .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: m.msgs.count) { _, _ in withAnimation(.snappy) { proxy.scrollTo("end", anchor: .bottom) } }
            .onChange(of: typing) { _, t in if t { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { withAnimation { proxy.scrollTo("end", anchor: .bottom) } } } }
        }
    }

    @ViewBuilder private func row(_ msg: CMsg, prev: CMsg?) -> some View {
        let mine = msg.userId == m.me
        let gap = prev == nil || msg.created.timeIntervalSince(prev!.created) > 3600
        let showName = !mine && m.c.kind != "direct" && (gap || prev?.userId != msg.userId)
        let parent = msg.replyTo.flatMap { r in m.msgs.first { $0.id.lowercased() == r.lowercased() } }
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if gap {
                Text(stamp(msg.created)).font(.sans(12)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(.top, 6).padding(.bottom, 4)
            }
            if showName { Text(m.s.people[msg.userId]?.name ?? "Former member").font(.sans(13)).foregroundStyle(T.muted).padding(.leading, 12) }
            if msg.deleted || msg.unreadable {
                bubble(mine: mine) { Text(msg.deleted ? "Message deleted" : "Sent before you joined").italic().opacity(0.55) }
            } else {
                if let a = msg.att {
                    Group { if a.isImage { picture(msg, a) } else { fileCard(msg, a) } }
                        .onTapGesture(count: 2) { Task { await m.react(msg, "❤️") } }
                        .contextMenu { menu(msg, mine) }
                }
                if let p = msg.poll { pollCard(msg, p).contextMenu { menu(msg, mine) } }
                if !msg.text.isEmpty || (parent != nil && msg.att == nil && msg.poll == nil) {
                    bubble(mine: mine) {
                        VStack(alignment: .leading, spacing: 4) {
                            if let parent {
                                Text(parent.deleted ? "Message deleted" : !parent.text.isEmpty ? String(parent.text.prefix(80)) : parent.poll != nil ? "Poll" : parent.att?.name ?? "Attachment")
                                    .font(.system(size: 15)).opacity(0.7).lineLimit(2).padding(.leading, 6)
                                    .overlay(alignment: .leading) { Rectangle().frame(width: 2).opacity(0.7) }
                            }
                            if !msg.text.isEmpty { Text(rich(msg.text)) }
                        }
                    }
                    .onTapGesture(count: 2) { Task { await m.react(msg, "❤️") } }
                    .contextMenu { menu(msg, mine) }
                }
                if !msg.reacts.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(msg.reacts.keys.sorted(), id: \.self) { e in
                            let who = msg.reacts[e] ?? []
                            Button { Task { await m.react(msg, e) } } label: {
                                HStack(spacing: 4) { Text(e).font(.system(size: 19)); Text("\(who.count)").font(.sans(14, .semibold)) }.foregroundStyle(T.ink).padding(.horizontal, 10).frame(height: 34)
                                    .background(Capsule().fill(who.contains(m.me) ? Color.white.opacity(0.16) : T.card)).overlay(Capsule().stroke(T.rule))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(e), \(who.compactMap { m.s.people[$0]?.name }.joined(separator: ", "))")
                        }
                        Button { typing = false; reacting = msg } label: {
                            Image(systemName: "face.smiling").font(.system(size: 18, weight: .semibold)).foregroundStyle(T.muted)
                                .overlay(alignment: .bottomTrailing) { Image(systemName: "plus").font(.system(size: 9, weight: .black)).foregroundStyle(T.muted).offset(x: 6, y: 3) }
                                .padding(.horizontal, 12).frame(height: 34).background(Capsule().fill(T.card)).overlay(Capsule().stroke(T.rule))
                        }
                        .buttonStyle(.plain).accessibilityLabel("Add a reaction")
                    }
                    .padding(.horizontal, 4)
                }
                if msg.failed {
                    Button { m.retry(msg) } label: { Text("Not delivered · Tap to try again").font(.sans(12, .semibold)).foregroundStyle(T.like).padding(.horizontal, 6) }.buttonStyle(.plain)
                }
                if msg.unverified { Text("Couldn’t confirm who sent this").font(.sans(11)).foregroundStyle(T.like).padding(.horizontal, 6) }
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .opacity(msg.pending ? 0.72 : 1)
        // swipe a message from the outside in to reply to it: yours (on the right) leftward, theirs rightward
        .offset(x: dragId == msg.id ? (mine ? -dragX : dragX) : 0)
        .background(alignment: mine ? .trailing : .leading) {
            if dragId == msg.id { Image(systemName: mine ? "arrowshape.turn.up.right.fill" : "arrowshape.turn.up.left.fill").font(.system(size: 16)).foregroundStyle(T.muted).opacity(Double(min(1, dragX / 44))).padding(.horizontal, 2) }
        }
        .contentShape(Rectangle())
        .simultaneousGesture(DragGesture(minimumDistance: 22).onChanged { v in
            let w = mine ? -v.translation.width : v.translation.width
            guard !msg.deleted, !msg.unreadable, w > 0, abs(v.translation.width) > abs(v.translation.height) * 1.6 else { return }
            if dragId != msg.id { dragId = msg.id }
            let x = min(72, w * 0.55)
            if x >= 44 && dragX < 44 { Haptic.tap() }
            dragX = x
        }.onEnded { _ in
            if dragId == msg.id && dragX >= 44 { replyTo = msg; typing = true }
            withAnimation(.spring(response: 0.3, dampingFraction: 0.78)) { dragX = 0 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) { if dragX == 0 { dragId = nil } }
        })
    }

    /// A photo or GIF, sized to fit; GIFs play.
    @ViewBuilder private func picture(_ msg: CMsg, _ a: CAtt) -> some View {
        if let img = m.images[a.path] {
            let k = min(250 / max(img.size.width, 1), 320 / max(img.size.height, 1), 1)
            let size = CGSize(width: max(60, img.size.width * k), height: max(60, img.size.height * k))
            Group {
                if img.images != nil { GIFView(img: img) } else { Image(uiImage: img).resizable().scaledToFill() }
            }
            .frame(width: size.width, height: size.height).clipShape(RoundedRectangle(cornerRadius: 16))
            .onTapGesture { if img.images == nil { zoom = img } }.imageMenu(image: img)
        } else {
            RoundedRectangle(cornerRadius: 16).fill(T.card).frame(width: 200, height: 150).overlay(ProgressView().tint(T.muted))
                .task { await m.photo(msg) }
        }
    }

    /// A video or any other file: a card that opens it.
    private func fileCard(_ msg: CMsg, _ a: CAtt) -> some View {
        Button {
            guard opening == nil else { return }
            opening = msg.id
            Task { let u = await m.file(msg); opening = nil; if let u { preview = u } else { m.problem = "Couldn’t open that." } }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: a.isVideo ? "play.fill" : a.mime.hasPrefix("audio/") ? "waveform" : "doc.fill").font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(T.paper).frame(width: 40, height: 40).background(Circle().fill(T.ink))
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.name).font(.sans(15, .semibold)).foregroundStyle(T.ink).lineLimit(1).truncationMode(.middle)
                    Text(ByteCountFormatter.string(fromByteCount: Int64(a.size), countStyle: .file)).font(.sans(12)).foregroundStyle(T.muted)
                }
                Spacer(minLength: 0)
                if opening == msg.id { ProgressView().tint(T.muted) }
            }
            .padding(10).frame(width: 250)
            .background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
        }
        .buttonStyle(.plain)
    }

    /// A poll: tap an option to vote, tap it again to take the vote back.
    private func pollCard(_ msg: CMsg, _ p: CPoll) -> some View {
        let total = max(msg.votes.count, 1), my = msg.votes[m.me]
        return VStack(alignment: .leading, spacing: 8) {
            Text(p.q).font(.serif(18, .semibold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true)
            ForEach(Array(p.opts.enumerated()), id: \.offset) { i, o in
                let n = msg.votes.values.filter { $0 == i }.count
                Button { Task { await m.vote(msg, i) } } label: {
                    HStack(spacing: 8) {
                        Text(o).font(.sans(15, my == i ? .semibold : .regular)).foregroundStyle(T.ink).multilineTextAlignment(.leading)
                        Spacer(minLength: 4)
                        if my == i { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(T.ink) }
                        Text("\(n)").font(.sans(13)).foregroundStyle(T.muted).monospacedDigit()
                    }
                    .padding(.horizontal, 12).padding(.vertical, 9).frame(minHeight: 40)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(alignment: .leading) { GeometryReader { g in (my == i ? T.maroon : Color.white.opacity(0.10)).frame(width: g.size.width * CGFloat(n) / CGFloat(total)) } }
                    .contentShape(Rectangle())
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(my == i ? T.ink : T.border))
                }
                .buttonStyle(.plain)
            }
            Text("\(msg.votes.count) \(msg.votes.count == 1 ? "vote" : "votes")").font(.sans(12)).foregroundStyle(T.muted)
        }
        .padding(14).frame(width: 270, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 18).stroke(T.rule))
    }

    private func bubble<C: View>(mine: Bool, @ViewBuilder _ c: () -> C) -> some View {
        c().font(.system(size: 17)).foregroundStyle(mine ? T.paper : T.ink)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: mine ? 18 : 6, bottomTrailingRadius: mine ? 6 : 18, topTrailingRadius: 18).fill(mine ? T.ink : T.card))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: mine ? 18 : 6, bottomTrailingRadius: mine ? 6 : 18, topTrailingRadius: 18).stroke(mine ? .clear : T.rule))
            .frame(maxWidth: UIScreen.main.bounds.width * 0.76, alignment: mine ? .trailing : .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func menu(_ msg: CMsg, _ mine: Bool) -> some View {
        ControlGroup {
            ForEach(["❤️", "👍", "😂", "😮", "🙏"], id: \.self) { e in
                Button { Task { await m.react(msg, e) } } label: { Image(uiImage: emojiImage(e)) }.accessibilityLabel(e)
            }
        }
        .controlGroupStyle(.palette)
        Button { typing = false; reacting = msg } label: { Label("More emoji…", systemImage: "face.smiling") }
        Divider()
        Button { replyTo = msg; typing = true } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
        if !msg.text.isEmpty { Button { UIPasteboard.general.string = msg.text } label: { Label("Copy", systemImage: "doc.on.doc") } }
        if !mine {
            Button { why = ""; reportingMsg = msg } label: { Label("Report", systemImage: "flag") }
            Button(role: .destructive) { Task { await m.s.block(msg.userId); await m.refresh(full: true) } } label: { Label("Block \(m.s.people[msg.userId]?.name.split(separator: " ").first.map(String.init) ?? "member")", systemImage: "hand.raised") }
        }
        if mine || m.s.admin { Button(role: .destructive) { deleting = msg } label: { Label(mine ? "Delete" : "Delete (administrator)", systemImage: "trash") } }
    }

    private func stamp(_ d: Date) -> String {
        (Calendar.current.isDateInToday(d) ? "Today" : d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) + " " + d.formatted(date: .omitted, time: .shortened)
    }

    private var bar: some View {
        let ok = !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && attach == nil)
        return VStack(alignment: .leading, spacing: 6) {
            if let r = replyTo {
                HStack {
                    Text("Replying: \(!r.text.isEmpty ? String(r.text.prefix(50)) : r.poll != nil ? "Poll" : r.att?.name ?? "Attachment")").font(.sans(13)).foregroundStyle(T.muted).lineLimit(1)
                    Spacer()
                    Button { replyTo = nil } label: { Text("✕").font(.sans(14)).foregroundStyle(T.muted) }
                }.padding(.horizontal, 6)
            }
            if let a = attach {
                HStack(spacing: 8) {
                    if let t = a.thumb { Image(uiImage: t).resizable().scaledToFill().frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 12)) }
                    else { Image(systemName: a.mime.hasPrefix("video/") ? "play.fill" : "doc.fill").foregroundStyle(T.paper).frame(width: 40, height: 40).background(Circle().fill(T.ink)) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.name).font(.sans(14, .semibold)).foregroundStyle(T.ink).lineLimit(1).truncationMode(.middle)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(a.data.count), countStyle: .file)).font(.sans(12)).foregroundStyle(T.muted)
                    }
                    Spacer(minLength: 0)
                    Button { attach = nil } label: { Text("✕").font(.sans(14)).foregroundStyle(T.muted).frame(width: 32, height: 32) }
                }
                .padding(8).background(RoundedRectangle(cornerRadius: 14).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule))
            }
            HStack(alignment: .bottom, spacing: 6) {
                Menu {
                    Button { picking = true } label: { Label("Photo or video", systemImage: "photo.on.rectangle") }
                    Button { typing = false; gifs = true } label: { Label("GIF", systemImage: "sparkles.rectangle.stack") }
                    Button { filing = true } label: { Label("File", systemImage: "doc") }
                    Button { typing = false; polling = true } label: { Label("Poll", systemImage: "chart.bar") }
                } label: {
                    GlyphView(n: "plus", s: 22).foregroundStyle(T.ink).frame(width: 40, height: 40).background(Circle().fill(Color.white.opacity(0.08)))
                }
                .accessibilityLabel("Add a photo, file or poll")
                TextField("", text: $text, prompt: Text("Message").foregroundColor(T.muted), axis: .vertical)
                    .font(.system(size: 17)).foregroundStyle(T.ink).lineLimit(1...6).focused($typing)
                    .padding(.horizontal, 14).padding(.vertical, 9).frame(minHeight: 40)
                    .background(RoundedRectangle(cornerRadius: 20).fill(T.card))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(rgb: 0x54563c)))
                Button {
                    let t = text.trimmingCharacters(in: .whitespacesAndNewlines), a = attach, r = replyTo?.id
                    text = ""; attach = nil; replyTo = nil
                    withAnimation(.snappy(duration: 0.22)) { m.send(t, attach: a, replyTo: r) }
                } label: {
                    GlyphView(n: "arrowup", s: 19, w: 2.6)
                        .foregroundStyle(T.paper).frame(width: 36, height: 36).background(Circle().fill(T.ink)).opacity(ok ? 1 : 0.35).padding(2)
                }
                .disabled(!ok)
            }
        }
        .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 10)
        .background(Color(rgb: 0x3a3d2b, 0.97).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { T.rule.frame(height: 1) }
    }
}

/// Ask the chat a question with two to six answers.
private struct PollMaker: View {
    let send: (String, [String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var opts = ["", ""]
    private var clean: [String] { opts.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
    var body: some View {
        NavigationStack {
            Form {
                Section("Question") { TextField("Ask something", text: $q, axis: .vertical) }
                Section("Answers") {
                    ForEach(opts.indices, id: \.self) { i in TextField("Answer \(i + 1)", text: $opts[i]) }
                    if opts.count < 6 { Button("Add an answer") { opts.append("") } }
                }
            }
            .scrollContentBackground(.hidden).background(T.paper)
            .navigationTitle("New poll").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { send(q.trimmingCharacters(in: .whitespacesAndNewlines), clean); dismiss() }
                        .disabled(q.trimmingCharacters(in: .whitespaces).isEmpty || clean.count < 2).fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark).tint(T.ink)
    }
}

private struct ZoomBox: Identifiable { let img: UIImage; var id: ObjectIdentifier { ObjectIdentifier(img) } }
private struct ZoomImageView: View {
    let img: UIImage; let done: () -> Void
    @State private var drop: CGFloat = 0
    @State private var scale: CGFloat = 1
    @State private var held: CGFloat = 1
    @State private var pan: CGSize = .zero
    @State private var panHeld: CGSize = .zero
    private func reset() { scale = 1; held = 1; pan = .zero; panHeld = .zero }
    var body: some View {
        // As in Photos: pinch or double-tap to zoom, drag to move about when zoomed, swipe down to close.
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Image(uiImage: img).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(scale).offset(pan)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { withAnimation(.snappy) { if scale > 1 { reset() } else { scale = 2.5; held = 2.5 } } }
                .gesture(MagnifyGesture().onChanged { scale = max(1, min(6, held * $0.magnification)) }
                    .onEnded { _ in held = scale; if scale <= 1.02 { withAnimation(.snappy) { reset() } } })
            Button(action: done) { GlyphView(n: "x", s: 20).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.white.opacity(0.15))) }.padding(16)
        }
        .offset(y: drop).opacity(Double(1 - min(0.5, abs(drop) / 500)))
        .simultaneousGesture(DragGesture(minimumDistance: 10)
            .onChanged { g in if scale > 1 { pan = CGSize(width: panHeld.width + g.translation.width, height: panHeld.height + g.translation.height) } else { drop = g.translation.height } }
            .onEnded { g in
                if scale > 1 { panHeld = pan; return }
                if abs(g.translation.height) > 90 || abs(g.predictedEndTranslation.height) > 320 { done() } else { withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { drop = 0 } }
            })
    }
}

/// First time: choose a recovery passphrase. On a new phone: enter it. Forgotten: start over.
private struct KeySetup: View {
    @ObservedObject var s: ChatSession
    let restoring: Bool
    @State private var pass = ""
    @State private var again = ""
    @State private var fresh = false
    @State private var confirmFresh = false
    private var making: Bool { !restoring || fresh }
    private var ok: Bool { making ? pass.count >= 8 && pass == again : !pass.isEmpty }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "lock.fill").font(.system(size: 26)).foregroundStyle(T.cream).padding(.top, 24)
                Text(making ? "Set your chat passphrase" : "Unlock the chat on this phone").font(.serif(26, .semibold)).foregroundStyle(T.ink)
                Text(making
                     ? "Chat in Life of the Mind is end-to-end encrypted. Your key is made on this phone. The passphrase protects a backup of it, so you can read the chat again on a new phone. Nobody — not the server, not an administrator — can recover it for you."
                     : "Enter the chat passphrase you chose before. It unlocks your key and every message you could read.")
                    .font(.serif(17)).foregroundStyle(T.sub).fixedSize(horizontal: false, vertical: true)
                SecureField("", text: $pass, prompt: Text(making ? "Passphrase (8+ characters)" : "Passphrase").foregroundColor(T.muted))
                    .textContentType(making ? .newPassword : .password).font(.sans(17)).foregroundStyle(T.ink)
                    .padding(.horizontal, 14).frame(height: 48).background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                if making {
                    SecureField("", text: $again, prompt: Text("Again").foregroundColor(T.muted))
                        .textContentType(.newPassword).font(.sans(17)).foregroundStyle(T.ink)
                        .padding(.horizontal, 14).frame(height: 48).background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                    if !again.isEmpty && pass != again { Text("The two don’t match.").font(.sans(13)).foregroundStyle(T.like) }
                }
                if let p = s.problem { Text(p).font(.sans(14)).foregroundStyle(T.like) }
                Button {
                    s.problem = nil
                    Task { if making { await s.setUp(pass: pass) } else { await s.restore(pass: pass) } }
                } label: {
                    Group { if s.busy { ProgressView().tint(T.paper) } else { Text(making ? "Turn on encrypted chat" : "Unlock").font(.sans(16, .semibold)) } }
                        .foregroundStyle(T.paper).frame(maxWidth: .infinity).frame(height: 48).background(Capsule().fill(T.ink)).opacity(ok ? 1 : 0.45)
                }
                .disabled(!ok || s.busy).padding(.top, 4)
                if making { Text("Write it down somewhere safe. If it’s lost, messages from before can’t be read on a new phone.").font(.sans(13)).foregroundStyle(T.muted) }
                if restoring && !fresh {
                    Button("Forgot it? Start over") { confirmFresh = true }.font(.sans(14)).foregroundStyle(T.ticker).frame(maxWidth: .infinity).padding(.top, 8)
                }
            }
            .padding(.horizontal, 24)
        }
        .confirmationDialog("Start over with a new key?", isPresented: $confirmFresh, titleVisibility: .visible) {
            Button("Start over", role: .destructive) { fresh = true; pass = ""; again = "" }
        } message: { Text("You’ll get a new passphrase and key. Messages from before can’t be read on this phone; new ones can, once another member opens the chat.") }
    }
}

/// Who's in a chat, safety numbers to compare in person, and (for groups) adding, removing and leaving.
/// What has been shared in a chat: its photos, its files and its links.
private struct SharedSections: View {
    @ObservedObject var m: ChatModel
    @State private var shown: UIImage?
    @State private var preview: URL?
    private var photos: [CMsg] { m.msgs.filter { !$0.deleted && $0.att?.isImage == true }.reversed() }
    private var files: [CMsg] { m.msgs.filter { !$0.deleted && $0.att != nil && $0.att?.isImage != true }.reversed() }
    private var links: [(String, URL, Date)] {
        guard let re = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
        var out: [(String, URL, Date)] = []
        for x in m.msgs.reversed() where !x.deleted && x.ctl == nil && x.text.contains("http") {
            for h in re.matches(in: x.text, range: NSRange(x.text.startIndex..., in: x.text)) { if let u = h.url, u.scheme?.hasPrefix("http") == true { out.append((x.id + u.absoluteString, u, x.created)) } }
        }
        return out
    }
    var body: some View {
        Section("Photos") {
            if photos.isEmpty { Text("None yet").font(.sans(14)).foregroundStyle(T.muted) } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
                    ForEach(photos.prefix(60)) { x in SharedThumb(m: m, msg: x) { shown = $0 } }
                }.padding(.vertical, 4)
            }
        }
        Section("Files") {
            if files.isEmpty { Text("None yet").font(.sans(14)).foregroundStyle(T.muted) } else {
                ForEach(files.prefix(60)) { x in
                    Button { Task { preview = await m.file(x) } } label: {
                        HStack(spacing: 10) { Image(systemName: "doc").foregroundStyle(T.muted); Text(x.att?.name ?? "File").font(.sans(15)).foregroundStyle(T.ink).lineLimit(1); Spacer(); Text(x.created.formatted(date: .abbreviated, time: .omitted)).font(.sans(12)).foregroundStyle(T.muted) }
                    }
                }
            }
        }
        .quickLookPreview($preview)
        Section("Links") {
            if links.isEmpty { Text("None yet").font(.sans(14)).foregroundStyle(T.muted) } else {
                ForEach(links.prefix(60), id: \.0) { l in
                    Button { openInApp(l.1) } label: {
                        VStack(alignment: .leading, spacing: 2) { Text(l.1.host ?? l.1.absoluteString).font(.sans(15, .semibold)).foregroundStyle(T.ink); Text(l.1.absoluteString).font(.sans(12)).foregroundStyle(T.muted).lineLimit(1) }
                    }
                }
            }
        }
        .fullScreenCover(item: Binding(get: { shown.map { ZoomBox(img: $0) } }, set: { shown = $0?.img })) { z in ZoomImageView(img: z.img) { shown = nil } }
    }
}
private struct SharedThumb: View {
    @ObservedObject var m: ChatModel
    let msg: CMsg
    let open: (UIImage) -> Void
    @State private var img: UIImage?
    var body: some View {
        Color(rgb: 0x2a2d1d).aspectRatio(1, contentMode: .fit)
            .overlay { if let img { Image(uiImage: img).resizable().scaledToFill() } }
            .clipShape(RoundedRectangle(cornerRadius: 6)).contentShape(Rectangle())
            .onTapGesture { if let img { open(img) } }
            .task { if img == nil, let u = await m.file(msg), let d = try? Data(contentsOf: u) { img = UIImage(data: d) } }
    }
}

private struct ChatInfo: View {
    @ObservedObject var m: ChatModel
    let left: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var adding = false
    @State private var confirmLeave = false
    private var mine: Bool { m.c.createdBy == m.me }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle(isOn: Binding(get: { m.muted }, set: { v in Task { await m.setMuted(v) } })) { Label("Hide alerts", systemImage: "bell.slash").font(.sans(15)).foregroundStyle(T.ink) }.tint(T.green)
                    Toggle(isOn: Binding(get: { m.receipts }, set: { v in Task { await m.setReceipts(v) } })) { Label("Send read receipts", systemImage: "checkmark.message").font(.sans(15)).foregroundStyle(T.ink) }.tint(T.green)
                } footer: { Text("Only you see these settings. With read receipts off, you won’t see theirs either.").font(.sans(12)) }
                SharedSections(m: m)
                Section {
                    Text("Messages and photos are encrypted on your phone before they’re sent. To check that nobody’s key has been swapped, compare a person’s safety number with what their own phone shows.")
                        .font(.sans(14)).foregroundStyle(T.sub)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your safety number").font(.sans(13)).foregroundStyle(T.muted)
                        Text(m.s.myFingerprint).font(.system(size: 16, design: .monospaced)).foregroundStyle(T.ink).textSelection(.enabled)
                    }
                }
                Section(m.c.kind == "club" ? "Members" : "People") {
                    ForEach(m.members.values.sorted { $0.name < $1.name }, id: \.id) { p in
                        HStack(spacing: 12) {
                            Face(name: p.name, url: p.avatar, s: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.id == m.me ? "\(p.name) (you)" : p.name).font(.sans(15, .semibold)).foregroundStyle(T.ink)
                                if let a = p.agree, let s = p.sign { Text(ChatCrypto.fingerprint(agree: a, sign: s)).font(.system(size: 12, design: .monospaced)).foregroundStyle(T.muted) }
                                else { Text("Hasn’t opened chat yet").font(.sans(12)).foregroundStyle(T.muted) }
                            }
                        }
                        .swipeActions {
                            if m.c.kind == "group" && mine && p.id != m.me {
                                Button("Remove", role: .destructive) { Task { await m.s.remove(p.id, from: m.c); m.c.members.removeAll { $0 == p.id } } }
                            }
                        }
                    }
                    if m.c.kind == "group" && mine { Button("Add people…") { adding = true }.foregroundStyle(T.ticker) }
                }
                if m.c.kind != "club" {
                    Section { Button(m.c.kind == "group" ? "Leave group" : "Delete this chat for me", role: .destructive) { confirmLeave = true } }
                }
            }
            .scrollContentBackground(.hidden).background(T.paper)
            .navigationTitle(m.s.name(m.c)).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $adding) { NewChat(s: m.s, adding: m.c) { _ in } }
            .confirmationDialog(m.c.kind == "group" ? "Leave this group?" : "Remove this chat?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button(m.c.kind == "group" ? "Leave" : "Remove", role: .destructive) {
                    Task { await m.s.remove(m.me, from: m.c); dismiss(); left() }
                }
            } message: { Text("You’ll stop getting its messages. The others will move to a new key, so you can’t read what comes after.") }
        }
        .preferredColorScheme(.dark).tint(T.ink)
        .onChange(of: m.s.convos) { _, cs in if let c = cs.first(where: { $0.id == m.c.id }) { m.c.members = c.members } }
    }
}

// MARK: - GIF search (GIPHY, asked through the club's server so the key stays off the phone)

private struct GifHit: Identifiable { let id: String, preview: URL, url: URL, w: CGFloat, h: CGFloat }

private struct GifPicker: View {
    let db: Supa?
    let pick: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var hits: [GifHit] = []
    @State private var note: String?
    @State private var loading = false
    @State private var fetching: String?
    @State private var run = 0
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TextField("", text: $q, prompt: Text("Search GIPHY").foregroundColor(T.muted))
                    .font(.sans(16)).foregroundStyle(T.ink).autocorrectionDisabled().submitLabel(.search)
                    .padding(.horizontal, 14).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                    .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 8)
                ScrollView {
                    if let note { Text(note).font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(32) }
                    else if loading && hits.isEmpty { ProgressView().tint(T.muted).padding(40) }
                    HStack(alignment: .top, spacing: 6) {
                        ForEach(0..<2, id: \.self) { col in
                            LazyVStack(spacing: 6) {
                                ForEach(Array(hits.enumerated()).filter { $0.offset % 2 == col }.map(\.element)) { g in
                                    Button { choose(g) } label: {
                                        GifThumb(url: g.preview).aspectRatio(g.w / max(g.h, 1), contentMode: .fit)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                            .overlay { if fetching == g.id { Color.black.opacity(0.4).clipShape(RoundedRectangle(cornerRadius: 10)); ProgressView().tint(.white) } }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    Text("Powered by GIPHY").font(.sans(11, .semibold)).tracking(0.6).foregroundStyle(T.muted).padding(.vertical, 16)
                }
                .scrollDismissesKeyboard(.immediately)
            }
            .background(T.paper.ignoresSafeArea())
            .navigationTitle("GIFs").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .preferredColorScheme(.dark).tint(T.ink)
        .task(id: q) {
            // wait for a pause in typing, then search (nothing typed: what's trending)
            if !q.isEmpty { try? await Task.sleep(nanoseconds: 450_000_000) }
            if Task.isCancelled { return }
            await search()
        }
    }
    private func search() async {
        guard let db else { note = "You’re not signed in."; return }
        loading = true; defer { loading = false }
        let term = q.trimmingCharacters(in: .whitespaces).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        do {
            let d = try await db.req("GET", "/functions/v1/gif-search?q=\(term)")
            let list = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["gifs"] as? [[String: Any]] ?? []
            hits = list.compactMap { g in
                guard let i = g["id"] as? String, let p = (g["preview"] as? String).flatMap(URL.init(string:)), let u = (g["url"] as? String).flatMap(URL.init(string:)) else { return nil }
                return GifHit(id: i, preview: p, url: u, w: CGFloat(g["w"] as? Double ?? 100), h: CGFloat(g["h"] as? Double ?? 100))
            }
            note = hits.isEmpty ? "Nothing found." : nil
        } catch {
            hits = []
            note = error.localizedDescription.contains("503") ? "GIF search isn’t set up yet. An administrator needs to add the club’s GIPHY key." : "GIF search isn’t available right now."
        }
    }
    private func choose(_ g: GifHit) {
        guard fetching == nil else { return }
        fetching = g.id; Haptic.tap()
        Task {
            if let (d, _) = try? await URLSession.shared.data(from: g.url), d.count > 0 { pick(d); dismiss() } else { note = "Couldn’t fetch that GIF." }
            fetching = nil
        }
    }
}

/// A small moving preview in the picker.
private struct GifThumb: View {
    let url: URL
    @State private var img: UIImage?
    var body: some View {
        ZStack { T.card; if let img { GIFView(img: img) } }
            .task(id: url) { if let (d, _) = try? await URLSession.shared.data(from: url) { img = animatedGIF(d) } }
    }
}

// MARK: - Any emoji as a reaction

/// A text field that opens the iPhone's own emoji keyboard, so any emoji can be a reaction.
private struct EmojiKeyboardField: UIViewRepresentable {
    let pick: (String) -> Void
    final class Field: UITextField {
        override var textInputMode: UITextInputMode? { UITextInputMode.activeInputModes.first { $0.primaryLanguage == "emoji" } ?? super.textInputMode }
        override var textInputContextIdentifier: String? { "" }
    }
    final class Coord: NSObject, UITextFieldDelegate {
        let pick: (String) -> Void
        init(_ p: @escaping (String) -> Void) { pick = p }
        func textField(_ f: UITextField, shouldChangeCharactersIn range: NSRange, replacementString s: String) -> Bool {
            if let c = s.first, c.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation || ($0.properties.isEmoji && $0.value > 0x238C) }) { pick(String(c)) }
            return false
        }
    }
    func makeCoordinator() -> Coord { Coord(pick) }
    func makeUIView(context: Context) -> Field {
        let f = Field(); f.delegate = context.coordinator; f.tintColor = .clear; f.autocorrectionType = .no
        f.attributedPlaceholder = NSAttributedString(string: "Tap for the emoji keyboard", attributes: [.foregroundColor: UIColor(white: 0.75, alpha: 0.8)])
        f.font = UIFont(name: "Inter-Regular", size: 15)
        return f
    }
    func updateUIView(_ v: Field, context: Context) {}
}

private struct EmojiPicker: View {
    let pick: (String) -> Void
    private let common = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥", "👏", "🎉", "💯", "🤔", "😍", "😊", "😅", "🙌", "👀", "✅", "❌", "😎", "🥳", "😭", "🤣", "💪", "🤝", "👎", "😬", "🤯", "🫡", "✝️", "📖", "☕️", "🍻"]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("React").font(.serif(22, .semibold)).foregroundStyle(T.ink).padding(.top, 22)
            EmojiKeyboardField(pick: pick).frame(height: 44).padding(.horizontal, 14)
                .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 6), spacing: 10) {
                ForEach(common, id: \.self) { e in
                    Button { pick(e) } label: { Text(e).font(.system(size: 36)).frame(maxWidth: .infinity, minHeight: 50) }.buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
