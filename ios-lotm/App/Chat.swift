import SwiftUI
import PhotosUI
import CryptoKit
import WebKit

// Chat: the club's chat, one-to-one messages and small groups — all end-to-end encrypted (see ChatCrypto.swift).
// Only in the iPhone app.

struct CMsg: Identifiable, Equatable {
    let id: String, userId: String, created: Date
    var epoch = 0, text = "", replyTo: String? = nil, image: String? = nil
    var deleted = false, unreadable = false, unverified = false
}
struct CMember { let id: String, name: String, avatar: URL?; var agree: String? = nil, sign: String? = nil }
struct Convo: Identifiable, Equatable {
    let id: String, kind: String
    var title: String?, createdBy: String?, last: Date, members: [String], unread = 0
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
        async let P = db!.rows("/rest/v1/profiles?status=eq.approved&select=id,display_name,avatar_url")
        async let K = db!.rows("/rest/v1/chat_keys?select=user_id,agree_key,sign_key")
        let (ps, ks) = try await (P, K)
        var out: [String: CMember] = [:]
        for p in ps { guard let i = p["id"] as? String else { continue }; out[i] = CMember(id: i, name: p["display_name"] as? String ?? "Member", avatar: (p["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
        for k in ks { if let i = k["user_id"] as? String, out[i] != nil { out[i]!.agree = k["agree_key"] as? String; out[i]!.sign = k["sign_key"] as? String } }
        people = out
    }

    /// Your conversations, newest first, each with how many messages came since you last read it.
    func loadConvos() async {
        guard let db, let rows = try? await db.rows("/rest/v1/conversations?select=id,kind,title,created_by,last_message_at,conversation_members(user_id,last_read_at)&order=last_message_at.desc.nullslast") else { return }
        var out: [Convo] = rows.compactMap { r in
            guard let i = r["id"] as? String, let k = r["kind"] as? String else { return nil }
            let ms = (r["conversation_members"] as? [[String: Any]]) ?? []
            if k != "club" && !ms.contains(where: { $0["user_id"] as? String == me }) { return nil }
            return Convo(id: i, kind: k, title: r["title"] as? String, createdBy: r["created_by"] as? String, last: parseDate(r["last_message_at"]), members: ms.compactMap { $0["user_id"] as? String })
        }
        // the club chat first, then the rest by their latest message
        out.sort { ($0.kind == "club" ? 1 : 0, $0.last) > ($1.kind == "club" ? 1 : 0, $1.last) }
        let reads = Dictionary(rows.flatMap { r in ((r["conversation_members"] as? [[String: Any]]) ?? []).filter { $0["user_id"] as? String == me }.map { (r["id"] as? String ?? "", $0["last_read_at"] as? String ?? "") } }, uniquingKeysWith: { a, _ in a })
        await withTaskGroup(of: (Int, Int).self) { g in
            for (k, c) in out.enumerated() {
                let last = reads[c.id].flatMap { $0.isEmpty ? nil : $0 } ?? "1970-01-01T00:00:00Z"
                let q = last.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? last
                g.addTask { (k, ((try? await db.rows("/rest/v1/messages?conversation_id=eq.\(c.id)&created_at=gt.\(q)&user_id=neq.\(db.a.me)&deleted_at=is.null&select=id&limit=20")) ?? []).count) }
            }
            for await (k, n) in g { out[k].unread = n }
        }
        convos = out
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

    init(_ c: Convo) { self.c = c }

    /// Who may hold this chat's key: every member for the club chat, otherwise the people in it.
    var members: [String: CMember] {
        c.kind == "club" ? s.people : s.people.filter { c.members.contains($0.key) }
    }

    func start() async {
        do {
            try await loadKeys()
            if keys[latest] != nil { try await maintain() }
            stage = keys[latest] == nil ? .waiting : .ready
            await refresh()
            if let r = try? await db!.rows("/rest/v1/conversation_members?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=muted").first { muted = r["muted"] as? Bool ?? false }
            poll()
        } catch { stage = .failed(error.localizedDescription) }
    }

    private func loadKeys() async throws {
        guard let id = s.id, let db else { return }
        async let E = db.rows("/rest/v1/chat_epochs?conversation_id=eq.\(conv)&select=epoch&order=epoch.desc&limit=1")
        async let S = db.rows("/rest/v1/chat_key_shares?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=epoch,recipient_key,ephemeral,sealed,signature,created_by")
        let (es, ss) = try await (E, S)
        latest = es.first?["epoch"] as? Int ?? 0
        for r in ss {
            guard let e = r["epoch"] as? Int, keys[e] == nil, let to = r["recipient_key"] as? String, to == id.agreePub,
                  let by = r["created_by"] as? String, let signer = s.people[by]?.sign else { continue }
            if let k = try? ChatCrypto.open(conv: conv, epoch: e, user: me, to: to, eph: r["ephemeral"] as? String ?? "", sealed: r["sealed"] as? String ?? "",
                                            sig: r["signature"] as? String ?? "", signer: signer, me: id) { keys[e] = k }
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
        var rows: [[String: Any]] = []
        for m in members.values { guard let to = m.agree else { continue }; rows.append(share(m.id, to, try ChatCrypto.seal(k, conv: conv, epoch: n, user: m.id, to: to, by: id))) }
        if !rows.isEmpty { try await db.req("POST", "/rest/v1/chat_key_shares", json: rows, prefer: "resolution=merge-duplicates,return=minimal") }
    }

    private func poll() {
        timer?.cancel()
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self else { return }
                await self.refresh()
            }
        }
    }
    func stop() { timer?.cancel(); timer = nil }

    func refresh() async {
        guard let db else { return }
        if stage == .waiting || Date().timeIntervalSince(lastMaintain) > 60 {
            try? await loadKeys()
            if keys[latest] != nil { try? await maintain(); if stage == .waiting { stage = .ready } }
        }
        guard let rows = try? await db.rows("/rest/v1/messages?conversation_id=eq.\(conv)&select=id,user_id,ciphertext,epoch,signature,created_at,deleted_at&order=created_at.desc&limit=300") else { return }
        var out: [CMsg] = []
        for r in rows.reversed() {
            guard let mid = r["id"] as? String else { continue }
            let deleted = !(r["deleted_at"] is NSNull) && r["deleted_at"] != nil
            if var x = cache[mid] { if deleted && !x.deleted { x.deleted = true; x.text = ""; cache[mid] = x }; out.append(cache[mid]!); continue }
            var m = CMsg(id: mid, userId: r["user_id"] as? String ?? "", created: parseDate(r["created_at"]), epoch: r["epoch"] as? Int ?? 0, deleted: deleted)
            if !deleted {
                if let e = r["epoch"] as? Int, let k = keys[e], let ct = r["ciphertext"] as? String, let d = Data(base64Encoded: ct),
                   let pd = try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-msg|\(conv)|\(e)"),
                   let p = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any], (p["id"] as? String)?.lowercased() == mid.lowercased() {
                    m.text = p["t"] as? String ?? ""; m.replyTo = p["r"] as? String; m.image = p["img"] as? String
                    m.unverified = !ChatCrypto.verify(r["signature"] as? String ?? "", ChatCrypto.msgText(conv: conv, epoch: e, user: m.userId, id: mid, ct: ct), signer: s.people[m.userId]?.sign)
                } else { m.unreadable = true }
            }
            if !m.unreadable { cache[mid] = m }
            out.append(m)
        }
        if out != msgs { msgs = out; markRead() }
    }

    func send(_ text: String, image: UIImage?, replyTo: String?) async -> Bool {
        guard let db, let id = s.id, let k = keys[latest] else { return false }
        busy = true; defer { busy = false }
        let mid = UUID().uuidString.lowercased(), e = latest
        do {
            var p: [String: Any] = ["id": mid, "t": text]
            if let replyTo { p["r"] = replyTo }
            if let image, let jpg = shrink(image) {
                let path = "\(me)/\(mid).bin"
                try await db.req("POST", "/storage/v1/object/chat-sealed/\(path)", raw: try ChatCrypto.encrypt(jpg, key: k, aad: "lotm-chat-img|\(conv)|\(e)|\(path)"), type: "application/octet-stream")
                p["img"] = path; images[path] = UIImage(data: jpg)
            }
            let ct = try ChatCrypto.encrypt(try JSONSerialization.data(withJSONObject: p), key: k, aad: "lotm-chat-msg|\(conv)|\(e)").base64EncodedString()
            let sig = try id.sign.signature(for: ChatCrypto.msgText(conv: conv, epoch: e, user: me, id: mid, ct: ct)).base64EncodedString()
            try await db.req("POST", "/rest/v1/messages", json: ["id": mid, "conversation_id": conv, "user_id": me, "ciphertext": ct, "epoch": e, "signature": sig], prefer: "return=minimal")
            Haptic.tap()
            await refresh(); return true
        } catch { problem = error.localizedDescription; return false }
    }

    func delete(_ m: CMsg) async {
        guard let db else { return }
        _ = try? await db.req("PATCH", "/rest/v1/messages?id=eq.\(m.id)&user_id=eq.\(me)", json: ["deleted_at": ISO8601DateFormatter().string(from: Date()), "ciphertext": NSNull()], prefer: "return=minimal")
        if let p = m.image { _ = try? await db.req("DELETE", "/storage/v1/object/chat-sealed/\(p)") }
        cache[m.id]?.deleted = true; await refresh()
    }

    func photo(_ m: CMsg) async {
        // the photo is sealed under the same key as its message
        guard let p = m.image, images[p] == nil, let db, let k = keys[m.epoch],
              let d = try? await db.req("GET", "/storage/v1/object/authenticated/chat-sealed/\(p)"),
              let jpg = try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-img|\(conv)|\(m.epoch)|\(p)"), let img = UIImage(data: jpg) else { return }
        images[p] = img
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

    private func shrink(_ img: UIImage) -> Data? {
        let longSide = max(img.size.width, img.size.height), sc = min(1, 2048 / max(longSide, 1))
        let size = CGSize(width: (img.size.width * sc).rounded(), height: (img.size.height * sc).rounded())
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82)
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
@MainActor func openChat(_ web: WebModel, conv: String? = nil, with person: String? = nil) {
    guard !ChatListScreen.showing else { return }
    ChatListScreen.showing = true
    ChatSession.shared.web = web.view
    presentSlide(ChatListScreen(s: ChatSession.shared, goTo: conv, with: person))
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
    @Environment(\.closeScreen) private var close
    @State private var composing = false
    @State private var went = false

    var body: some View {
        VStack(spacing: 0) {
            PageBar(title: "Chat", onBack: { close() }) {
                if s.stage == .ready {
                    Button { composing = true } label: { GlyphView(n: "pencil", s: 20).foregroundStyle(T.ink).frame(width: 40, height: 36) }
                        .accessibilityLabel("New message")
                }
            }
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
        .onDisappear { ChatListScreen.showing = false }
        .sheet(isPresented: $composing) { NewChat(s: s) { c in composing = false; open(c) } }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(s.convos) { c in
                    Button { open(c) } label: { row(c) }.buttonStyle(.plain)
                }
                if s.convos.count <= 1 {
                    Button { composing = true } label: {
                        Text("Message someone in the club").font(.sans(15, .semibold)).foregroundStyle(T.paper)
                            .padding(.horizontal, 20).frame(height: 44).background(Capsule().fill(T.ink))
                    }
                    .padding(.top, 28)
                }
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 10, weight: .semibold))
                    Text("Every chat is end-to-end encrypted.").font(.sans(12))
                }
                .foregroundStyle(T.muted).padding(.top, 24).padding(.bottom, 120)
            }
            .padding(.top, 6)
        }
        .refreshable { await s.loadConvos() }
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
                Text(c.last.timeIntervalSince1970 < 86400 ? "" : ago(c.last)).font(.sans(12)).foregroundStyle(T.muted)
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

    private func open(_ c: Convo) { Haptic.tap(); presentSlide(ChatScreen(m: ChatModel(c))) }

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
    @StateObject var m: ChatModel
    @Environment(\.closeScreen) private var close
    @State private var text = ""
    @State private var image: UIImage?
    @State private var pick: PhotosPickerItem?
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
            Button { Task { await m.setMuted(!m.muted) } } label: {
                GlyphView(n: m.muted ? "mute" : "bell", s: 21).foregroundStyle(m.muted ? T.like : T.ink).frame(width: 40, height: 40)
            }
            .opacity(m.stage == .ready ? 1 : 0).accessibilityLabel(m.muted ? "Unmute" : "Mute")
        }
        .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 8)
        .background(Color(rgb: 0x3a3d2b, 0.96))
        .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
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
            if showName { Text(m.s.people[msg.userId]?.name ?? "Former member").font(.sans(12)).foregroundStyle(T.muted).padding(.leading, 12) }
            if msg.deleted || msg.unreadable {
                bubble(mine: mine) { Text(msg.deleted ? "Message deleted" : "Sent before you joined").italic().opacity(0.55) }
            } else {
                if let p = msg.image {
                    Group {
                        if let img = m.images[p] {
                            Image(uiImage: img).resizable().scaledToFit().frame(maxWidth: 250, maxHeight: 320).clipShape(RoundedRectangle(cornerRadius: 16))
                                .onTapGesture { zoom = img }
                        } else {
                            RoundedRectangle(cornerRadius: 16).fill(T.card).frame(width: 200, height: 150).overlay(ProgressView().tint(T.muted))
                                .task { await m.photo(msg) }
                        }
                    }
                    .contextMenu { menu(msg, mine) }
                }
                if !msg.text.isEmpty || parent != nil {
                    bubble(mine: mine) {
                        VStack(alignment: .leading, spacing: 4) {
                            if let parent {
                                Text(parent.deleted ? "Message deleted" : parent.text.isEmpty ? "Photo" : String(parent.text.prefix(80)))
                                    .font(.sans(14)).opacity(0.7).lineLimit(2).padding(.leading, 6)
                                    .overlay(alignment: .leading) { Rectangle().frame(width: 2).opacity(0.7) }
                            }
                            if !msg.text.isEmpty { Text(linked(msg.text)) }
                        }
                    }
                    .contextMenu { menu(msg, mine) }
                }
                if msg.unverified { Text("Couldn’t confirm who sent this").font(.sans(11)).foregroundStyle(T.like).padding(.horizontal, 6) }
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    private func bubble<C: View>(mine: Bool, @ViewBuilder _ c: () -> C) -> some View {
        c().font(.serif(17)).foregroundStyle(mine ? T.paper : T.ink)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: mine ? 18 : 6, bottomTrailingRadius: mine ? 6 : 18, topTrailingRadius: 18).fill(mine ? T.ink : T.card))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: mine ? 18 : 6, bottomTrailingRadius: mine ? 6 : 18, topTrailingRadius: 18).stroke(mine ? .clear : T.rule))
            .frame(maxWidth: UIScreen.main.bounds.width * 0.76, alignment: mine ? .trailing : .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func menu(_ msg: CMsg, _ mine: Bool) -> some View {
        Button { replyTo = msg; typing = true } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
        if !msg.text.isEmpty { Button { UIPasteboard.general.string = msg.text } label: { Label("Copy", systemImage: "doc.on.doc") } }
        if mine { Button(role: .destructive) { Task { await m.delete(msg) } } label: { Label("Delete", systemImage: "trash") } }
    }

    private func stamp(_ d: Date) -> String {
        (Calendar.current.isDateInToday(d) ? "Today" : d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) + " " + d.formatted(date: .omitted, time: .shortened)
    }

    private var bar: some View {
        let ok = !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && image == nil) && !m.busy
        return VStack(alignment: .leading, spacing: 6) {
            if let r = replyTo {
                HStack {
                    Text("Replying: \(r.text.isEmpty ? "Photo" : String(r.text.prefix(50)))").font(.sans(13)).foregroundStyle(T.muted).lineLimit(1)
                    Spacer()
                    Button { replyTo = nil } label: { Text("✕").font(.sans(14)).foregroundStyle(T.muted) }
                }.padding(.horizontal, 6)
            }
            if let image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(alignment: .topTrailing) { Button { self.image = nil } label: { Text("×").font(.sans(15)).foregroundStyle(.white).frame(width: 22, height: 22).background(Circle().fill(.black.opacity(0.65))) }.padding(4) }
            }
            HStack(alignment: .bottom, spacing: 6) {
                PhotosPicker(selection: $pick, matching: .images) {
                    GlyphView(n: "plus", s: 22).foregroundStyle(T.ink).frame(width: 40, height: 40).background(Circle().fill(Color.white.opacity(0.08)))
                }
                .onChange(of: pick) { _, it in
                    guard let it else { return }
                    Task { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { image = img }; pick = nil }
                }
                TextField("", text: $text, prompt: Text("Message").foregroundColor(T.muted), axis: .vertical)
                    .font(.serif(16)).foregroundStyle(T.ink).lineLimit(1...6).focused($typing)
                    .padding(.horizontal, 14).padding(.vertical, 9).frame(minHeight: 40)
                    .background(RoundedRectangle(cornerRadius: 20).fill(T.card))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(rgb: 0x54563c)))
                Button {
                    let t = text.trimmingCharacters(in: .whitespacesAndNewlines), img = image, r = replyTo?.id
                    text = ""; image = nil; replyTo = nil
                    Task { if !(await m.send(t, image: img, replyTo: r)) { text = t; image = img } }
                } label: {
                    Group { if m.busy { ProgressView().tint(T.paper) } else { GlyphView(n: "send", s: 18) } }
                        .foregroundStyle(T.paper).frame(width: 40, height: 40).background(Circle().fill(T.ink)).opacity(ok || m.busy ? 1 : 0.4)
                }
                .disabled(!ok)
            }
        }
        .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 10)
        .background(Color(rgb: 0x3a3d2b, 0.97).ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { T.rule.frame(height: 1) }
    }
}

private struct ZoomBox: Identifiable { let img: UIImage; var id: ObjectIdentifier { ObjectIdentifier(img) } }
private struct ZoomImageView: View {
    let img: UIImage; let done: () -> Void
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Image(uiImage: img).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
            Button(action: done) { GlyphView(n: "x", s: 20).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.white.opacity(0.15))) }.padding(16)
        }
        .gesture(DragGesture().onEnded { if abs($0.translation.height) > 80 { done() } })
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
