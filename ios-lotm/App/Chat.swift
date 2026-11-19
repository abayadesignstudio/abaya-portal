import SwiftUI
import PhotosUI
import CryptoKit
import WebKit

// The club's group chat, end-to-end encrypted (see ChatCrypto.swift). Only in the iPhone app.

struct CMsg: Identifiable, Equatable {
    let id: String, userId: String, created: Date
    var epoch = 0, text = "", replyTo: String? = nil, image: String? = nil
    var deleted = false, unreadable = false, unverified = false
}
struct CMember { let id: String, name: String, avatar: URL?; var agree: String? = nil, sign: String? = nil }

@MainActor
final class ChatModel: ObservableObject {
    enum Stage: Equatable { case loading, setup, restore, waiting, ready, failed(String) }
    @Published var stage: Stage = .loading
    @Published var msgs: [CMsg] = []
    @Published var members: [String: CMember] = [:]
    @Published var busy = false
    @Published var problem: String?
    @Published var muted = false
    @Published var images: [String: UIImage] = [:]

    weak var web: WKWebView?
    private var a: SupaAuth?
    private var db: Supa? { a.map { Supa(a: $0) } }
    var me: String { a?.me ?? "" }
    private(set) var conv = ""
    private var id: ChatIdentity?
    private var keys: [Int: SymmetricKey] = [:]
    private var latest = 0
    private var cache: [String: CMsg] = [:]
    private var backupRow: [String: Any]?
    private var timer: Task<Void, Never>?
    private var lastMaintain = Date.distantPast

    static var showing = false
    init(web: WKWebView?) { self.web = web }

    // MARK: starting

    func start() async {
        guard let auth = await webAuth(web) else { stage = .failed("You’re not signed in."); return }
        a = auth
        do {
            guard let c = try await db!.rows("/rest/v1/conversations?kind=eq.club&select=id&limit=1").first?["id"] as? String else { stage = .failed("The club chat isn’t set up."); return }
            conv = c
            try await loadMembers()
            backupRow = try await db!.rows("/rest/v1/chat_keys?user_id=eq.\(me)&select=agree_key,sign_key,backup,salt,rounds").first
            if let raw = ChatKeychain.load(me), let ident = try? ChatIdentity(raw: raw), backupRow?["agree_key"] as? String == ident.agreePub {
                id = ident; await afterKeys()
            } else {
                stage = backupRow == nil ? .setup : .restore
            }
        } catch { stage = .failed(error.localizedDescription) }
    }

    func setUp(pass: String) async {
        busy = true; defer { busy = false }
        do {
            let ident = ChatIdentity()
            let user = me
            let b = try await Task.detached { try ChatCrypto.backup(ident, pass: pass, user: user) }.value
            try await db!.req("POST", "/rest/v1/chat_keys", json: ["user_id": me, "agree_key": ident.agreePub, "sign_key": ident.signPub, "backup": b.backup, "salt": b.salt, "rounds": b.rounds, "updated_at": ISO8601DateFormatter().string(from: Date())],
                              prefer: "resolution=merge-duplicates,return=minimal")
            ChatKeychain.save(me, ident.raw); id = ident
            try await loadMembers(); await afterKeys()
        } catch { problem = error.localizedDescription }
    }

    func restore(pass: String) async {
        guard let r = backupRow, let b = r["backup"] as? String, let s = r["salt"] as? String, let n = r["rounds"] as? Int else { return }
        busy = true; defer { busy = false }
        let user = me
        do {
            let ident = try await Task.detached { try ChatCrypto.restore(backup: b, salt: s, rounds: n, pass: pass, user: user) }.value
            guard ident.agreePub == r["agree_key"] as? String else { throw ChatError("That backup doesn’t match your key.") }
            ChatKeychain.save(me, ident.raw); id = ident; await afterKeys()
        } catch { problem = error.localizedDescription }
    }

    /// Forgotten passphrase: a new key. Earlier messages can't be read on this phone any more.
    func startOver(pass: String) async { await setUp(pass: pass) }

    private func loadMembers() async throws {
        async let P = db!.rows("/rest/v1/profiles?status=eq.approved&select=id,display_name,avatar_url")
        async let K = db!.rows("/rest/v1/chat_keys?select=user_id,agree_key,sign_key")
        let (ps, ks) = try await (P, K)
        var out: [String: CMember] = [:]
        for p in ps { guard let i = p["id"] as? String else { continue }; out[i] = CMember(id: i, name: p["display_name"] as? String ?? "Member", avatar: (p["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
        for k in ks { if let i = k["user_id"] as? String, out[i] != nil { out[i]!.agree = k["agree_key"] as? String; out[i]!.sign = k["sign_key"] as? String } }
        members = out
    }

    private func afterKeys() async {
        do {
            try await loadKeys()
            if keys[latest] != nil { try await maintain() }
            stage = keys[latest] == nil ? .waiting : .ready
            await refresh()
            if let r = try? await db!.rows("/rest/v1/conversation_members?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=muted").first { muted = r["muted"] as? Bool ?? false }
            poll()
        } catch { stage = .failed(error.localizedDescription) }
    }

    // MARK: keys

    private func loadKeys() async throws {
        guard let id else { return }
        async let E = db!.rows("/rest/v1/chat_epochs?conversation_id=eq.\(conv)&select=epoch&order=epoch.desc&limit=1")
        async let S = db!.rows("/rest/v1/chat_key_shares?conversation_id=eq.\(conv)&user_id=eq.\(me)&select=epoch,recipient_key,ephemeral,sealed,signature,created_by")
        let (es, ss) = try await (E, S)
        latest = es.first?["epoch"] as? Int ?? 0
        for s in ss {
            guard let e = s["epoch"] as? Int, keys[e] == nil, let to = s["recipient_key"] as? String, to == id.agreePub,
                  let by = s["created_by"] as? String, let signer = members[by]?.sign else { continue }
            if let k = try? ChatCrypto.open(conv: conv, epoch: e, user: me, to: to, eph: s["ephemeral"] as? String ?? "", sealed: s["sealed"] as? String ?? "",
                                            sig: s["signature"] as? String ?? "", signer: signer, me: id) { keys[e] = k }
        }
        if latest == 0 { try await newEpoch(1) }
    }

    /// Seal the newest key to anyone who doesn't have it yet; start a fresh key when someone has left.
    private func maintain() async throws {
        guard let id, let k = keys[latest] else { return }
        lastMaintain = Date()
        try await loadMembers()
        let shares = try await db!.rows("/rest/v1/chat_key_shares?conversation_id=eq.\(conv)&epoch=eq.\(latest)&select=user_id,recipient_key")
        let had = Dictionary(shares.compactMap { s in (s["user_id"] as? String).map { ($0, s["recipient_key"] as? String ?? "") } }, uniquingKeysWith: { a, _ in a })
        if had.keys.contains(where: { members[$0] == nil }) { try await newEpoch(latest + 1); return }
        var rows: [[String: Any]] = []
        for m in members.values { guard let to = m.agree, had[m.id] != to else { continue }
            let s = try ChatCrypto.seal(k, conv: conv, epoch: latest, user: m.id, to: to, by: id)
            rows.append(share(m.id, to, s))
        }
        if !rows.isEmpty { try await db!.req("POST", "/rest/v1/chat_key_shares", json: rows, prefer: "resolution=merge-duplicates,return=minimal") }
    }

    private func share(_ user: String, _ to: String, _ s: (eph: String, sealed: String, sig: String)) -> [String: Any] {
        ["conversation_id": conv, "epoch": latest, "user_id": user, "recipient_key": to, "ephemeral": s.eph, "sealed": s.sealed, "signature": s.sig, "created_by": me]
    }

    private func newEpoch(_ n: Int) async throws {
        guard let id else { return }
        do { try await db!.req("POST", "/rest/v1/chat_epochs", json: ["conversation_id": conv, "epoch": n, "created_by": me], prefer: "return=minimal") }
        catch { try await loadKeys(); return }   // someone else started it a moment ago
        let k = SymmetricKey(size: .bits256); latest = n; keys[n] = k
        var rows: [[String: Any]] = []
        for m in members.values { guard let to = m.agree else { continue }; rows.append(share(m.id, to, try ChatCrypto.seal(k, conv: conv, epoch: n, user: m.id, to: to, by: id))) }
        try await db!.req("POST", "/rest/v1/chat_key_shares", json: rows, prefer: "resolution=merge-duplicates,return=minimal")
    }

    // MARK: messages

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
        guard let db, !conv.isEmpty else { return }
        if stage == .waiting || Date().timeIntervalSince(lastMaintain) > 60 {
            try? await loadKeys()
            if keys[latest] != nil { try? await maintain(); if stage == .waiting { stage = .ready } }
        }
        guard let rows = try? await db.rows("/rest/v1/messages?conversation_id=eq.\(conv)&select=id,user_id,ciphertext,epoch,signature,created_at,deleted_at&order=created_at.desc&limit=300") else { return }
        var out: [CMsg] = []
        for r in rows.reversed() {
            guard let mid = r["id"] as? String else { continue }
            let deleted = !(r["deleted_at"] is NSNull) && r["deleted_at"] != nil
            if var c = cache[mid] { if deleted && !c.deleted { c.deleted = true; c.text = ""; cache[mid] = c }; out.append(cache[mid]!); continue }
            var m = CMsg(id: mid, userId: r["user_id"] as? String ?? "", created: parseDate(r["created_at"]), epoch: r["epoch"] as? Int ?? 0, deleted: deleted)
            if !deleted {
                if let e = r["epoch"] as? Int, let k = keys[e], let ct = r["ciphertext"] as? String, let d = Data(base64Encoded: ct),
                   let pd = try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-msg|\(conv)|\(e)"),
                   let p = (try? JSONSerialization.jsonObject(with: pd)) as? [String: Any], (p["id"] as? String)?.lowercased() == mid.lowercased() {
                    m.text = p["t"] as? String ?? ""; m.replyTo = p["r"] as? String; m.image = p["img"] as? String
                    m.unverified = !ChatCrypto.verify(r["signature"] as? String ?? "", ChatCrypto.msgText(conv: conv, epoch: e, user: m.userId, id: mid, ct: ct), signer: members[m.userId]?.sign)
                } else { m.unreadable = true }
            }
            if !m.unreadable { cache[mid] = m }
            out.append(m)
        }
        if out != msgs { msgs = out; markRead() }
    }

    func send(_ text: String, image: UIImage?, replyTo: String?) async -> Bool {
        guard let db, let id, let k = keys[latest] else { return false }
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
        guard let p = m.image, images[p] == nil, let db else { return }
        let e = m.epoch
        guard let k = keys[e], let d = try? await db.req("GET", "/storage/v1/object/authenticated/chat-sealed/\(p)"),
              let jpg = try? ChatCrypto.decrypt(d, key: k, aad: "lotm-chat-img|\(conv)|\(e)|\(p)"), let img = UIImage(data: jpg) else { return }
        images[p] = img
    }

    func setMuted(_ v: Bool) async {
        muted = v; Haptic.tap()
        _ = try? await db?.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": conv, "user_id": me, "muted": v], prefer: "resolution=merge-duplicates,return=minimal")
    }

    private func markRead() {
        guard let db else { return }
        Task { _ = try? await db.req("POST", "/rest/v1/conversation_members", json: ["conversation_id": conv, "user_id": me, "last_read_at": ISO8601DateFormatter().string(from: Date())], prefer: "resolution=merge-duplicates,return=minimal") }
    }

    private func shrink(_ img: UIImage) -> Data? {
        let longSide = max(img.size.width, img.size.height), s = min(1, 2048 / max(longSide, 1))
        let size = CGSize(width: (img.size.width * s).rounded(), height: (img.size.height * s).rounded())
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82)
    }

    var myFingerprint: String { id.map { ChatCrypto.fingerprint(agree: $0.agreePub, sign: $0.signPub) } ?? "" }
}

/// How many club-chat messages arrived since you last read it (for the badge on the chat button).
func chatUnread(_ a: SupaAuth) async -> Int {
    let db = Supa(a: a)
    guard let c = try? await db.rows("/rest/v1/conversations?kind=eq.club&select=id&limit=1").first?["id"] as? String else { return 0 }
    let last = (try? await db.rows("/rest/v1/conversation_members?conversation_id=eq.\(c)&user_id=eq.\(a.me)&select=last_read_at").first?["last_read_at"] as? String) ?? "1970-01-01T00:00:00Z"
    let q = last.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? last
    let rows = (try? await db.rows("/rest/v1/messages?conversation_id=eq.\(c)&created_at=gt.\(q)&user_id=neq.\(a.me)&deleted_at=is.null&select=id&limit=20")) ?? []
    return rows.count
}

// MARK: - Screen

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
            case .setup: KeySetup(m: m, restoring: false)
            case .restore: KeySetup(m: m, restoring: true)
            case .failed(let f): Spacer(); Text(f).font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(40); Spacer()
            case .waiting, .ready: thread
            }
        }
        .background(T.paper.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { if m.stage == .ready { bar } }
        .preferredColorScheme(.dark).tint(T.ink)
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .task { await m.start() }
        .onDisappear { m.stop(); ChatModel.showing = false }
        .sheet(isPresented: $info) { ChatInfo(m: m) }
        .fullScreenCover(item: Binding(get: { zoom.map { ZoomBox(img: $0) } }, set: { zoom = $0?.img })) { z in
            ZoomImageView(img: z.img) { zoom = nil }
        }
        .alert("Couldn’t send", isPresented: Binding(get: { m.problem != nil && m.stage == .ready }, set: { if !$0 { m.problem = nil } })) { Button("OK", role: .cancel) {} } message: { Text(m.problem ?? "") }
    }

    private var header: some View {
        HStack(spacing: 4) {
            Button { close() } label: { GlyphView(n: "back", s: 24).foregroundStyle(T.ink).frame(width: 40, height: 40) }
            Button { if m.stage == .ready || m.stage == .waiting { info = true } } label: {
                VStack(spacing: 3) {
                    Text("LM").font(.serif(17, .semibold)).foregroundStyle(T.paper).frame(width: 46, height: 46).background(RoundedRectangle(cornerRadius: 13).fill(T.ink))
                    Text("Life of the Mind").font(.serif(18, .semibold)).foregroundStyle(T.ink)
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill").font(.system(size: 9, weight: .semibold))
                        Text("\(m.members.count) members · end-to-end encrypted").font(.sans(12))
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
                        Text("You’re in. The key that unlocks the chat is shared with you the next time another member opens it — usually within minutes.")
                            .font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(24)
                    } else if m.msgs.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "lock.fill").font(.system(size: 22)).foregroundStyle(T.muted)
                            Text("Messages here are end-to-end encrypted. Only club members, on their phones, can read them — not the server, and not us.")
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
        let showName = !mine && (gap || prev?.userId != msg.userId)
        let parent = msg.replyTo.flatMap { r in m.msgs.first { $0.id.lowercased() == r.lowercased() } }
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if gap {
                Text(stamp(msg.created)).font(.sans(12)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(.top, 6).padding(.bottom, 4)
            }
            if showName { Text(m.members[msg.userId]?.name ?? "Former member").font(.sans(12)).foregroundStyle(T.muted).padding(.leading, 12) }
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
    @ObservedObject var m: ChatModel
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
                     ? "The club chat is end-to-end encrypted. Your key is made on this phone. The passphrase protects a backup of it, so you can read the chat again on a new phone. Nobody — not the server, not an administrator — can recover it for you."
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
                if let p = m.problem { Text(p).font(.sans(14)).foregroundStyle(T.like) }
                Button {
                    m.problem = nil
                    Task { if making { await m.setUp(pass: pass) } else { await m.restore(pass: pass) } }
                } label: {
                    Group { if m.busy { ProgressView().tint(T.paper) } else { Text(making ? "Turn on encrypted chat" : "Unlock").font(.sans(16, .semibold)) } }
                        .foregroundStyle(T.paper).frame(maxWidth: .infinity).frame(height: 48).background(Capsule().fill(T.ink)).opacity(ok ? 1 : 0.45)
                }
                .disabled(!ok || m.busy).padding(.top, 4)
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

/// Who's in the chat, and safety numbers to compare in person.
private struct ChatInfo: View {
    @ObservedObject var m: ChatModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Messages and photos are encrypted on your phone before they’re sent. To check a member’s key hasn’t been swapped, compare their safety number with what their phone shows.")
                        .font(.sans(14)).foregroundStyle(T.sub)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your safety number").font(.sans(13)).foregroundStyle(T.muted)
                        Text(m.myFingerprint).font(.system(size: 16, design: .monospaced)).foregroundStyle(T.ink).textSelection(.enabled)
                    }
                }
                Section("Members") {
                    ForEach(m.members.values.sorted { $0.name < $1.name }, id: \.id) { p in
                        HStack(spacing: 12) {
                            Face(name: p.name, url: p.avatar, s: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.sans(15, .semibold)).foregroundStyle(T.ink)
                                if let a = p.agree, let s = p.sign { Text(ChatCrypto.fingerprint(agree: a, sign: s)).font(.system(size: 12, design: .monospaced)).foregroundStyle(T.muted) }
                                else { Text("Hasn’t turned on chat yet").font(.sans(12)).foregroundStyle(T.muted) }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(T.paper)
            .navigationTitle("Chat").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark).tint(T.ink)
    }
}
