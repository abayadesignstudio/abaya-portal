import SwiftUI
import PhotosUI
import WebKit
import SafariServices

// The post screen, built natively: the post (and its thread), the replies, and a reply box that rides the keyboard.
// It reads and writes the club's database directly as the signed-in member (the web app hands over its session).

private extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255) }
}
private enum P {
    static let paper = Color(hex: 0x3b3e2a), card = Color(hex: 0x414530), ink = Color(hex: 0xf1eedd), muted = Color(hex: 0xc3c3a6)
    static let rule = Color(hex: 0x4d4f37), like = Color(hex: 0xe08a98), tan = Color(hex: 0x2d301f), soft = Color(hex: 0x454832)
}

// MARK: - Database

struct SupaAuth { let token: String, me: String, url: String, key: String }

struct Supa {
    let a: SupaAuth
    @discardableResult
    func req(_ method: String, _ path: String, json: Any? = nil, raw: Data? = nil, type: String = "application/json", prefer: String? = nil, extra: [String: String] = [:]) async throws -> Data {
        guard let url = URL(string: a.url + path) else { throw err("Bad address") }
        var r = URLRequest(url: url); r.httpMethod = method; r.timeoutInterval = 30
        r.setValue(a.key, forHTTPHeaderField: "apikey"); r.setValue("Bearer \(a.token)", forHTTPHeaderField: "Authorization")
        r.setValue(type, forHTTPHeaderField: "Content-Type")
        if let prefer { r.setValue(prefer, forHTTPHeaderField: "Prefer") }
        for (k, v) in extra { r.setValue(v, forHTTPHeaderField: k) }
        if let raw { r.httpBody = raw } else if let json { r.httpBody = try JSONSerialization.data(withJSONObject: json) }
        let (d, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 300 {
            let msg = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["message"] as? String
            throw err(msg ?? "Something went wrong (\(code))")
        }
        return d
    }
    func rows(_ path: String) async throws -> [[String: Any]] {
        let d = try await req("GET", path)
        return ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]]) ?? []
    }
    func err(_ m: String) -> NSError { NSError(domain: "LOTM", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }
    /// A photo into the club's post-media storage; returns its public address.
    func upload(_ img: UIImage, bucket: String = "post-media") async throws -> String {
        let longSide = max(img.size.width, img.size.height), s = min(1, 2048 / max(longSide, 1))
        let size = CGSize(width: (img.size.width * s).rounded(), height: (img.size.height * s).rounded())
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        let data = UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82) ?? Data()
        let path = "\(a.me)/\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6).lowercased()).jpg"
        try await req("POST", "/storage/v1/object/\(bucket)/\(path)", raw: data, type: "image/jpeg")
        return "\(a.url)/storage/v1/object/public/\(bucket)/\(path)"
    }
}

func parseDate(_ v: Any?) -> Date {
    guard let s = v as? String, s.count >= 19 else { return Date() }
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    var d = f.date(from: String(s.prefix(19))) ?? Date()
    // a time written with another offset (+hh:mm) is moved to UTC
    if let m = s.range(of: #"([+-])(\d\d):(\d\d)$"#, options: .regularExpression) {
        let t = s[m]; let sign: Double = t.hasPrefix("-") ? -1 : 1
        let h = Double(t.dropFirst().prefix(2)) ?? 0, mi = Double(t.suffix(2)) ?? 0
        d = d.addingTimeInterval(-sign * (h * 3600 + mi * 60))
    }
    return d
}
func ago(_ d: Date) -> String {
    let s = Date().timeIntervalSince(d)
    if s < 60 { return "now" }; if s < 3600 { return "\(Int(s / 60))m" }; if s < 86400 { return "\(Int(s / 3600))h" }; if s < 604800 { return "\(Int(s / 86400))d" }
    return d.formatted(.dateTime.month(.abbreviated).day())
}

/// The signed-in member's session, from the web app (which keeps it fresh).
@MainActor func webAuth(_ web: WKWebView?) async -> SupaAuth? {
    guard let web else { return nil }
    return await withCheckedContinuation { (k: CheckedContinuation<SupaAuth?, Never>) in
        web.callAsyncJavaScript("return window.lotmNativeAuth ? await window.lotmNativeAuth() : ''", arguments: [:], in: nil, in: .page) { r in
            guard case .success(let v) = r, let s = v as? String, let d = s.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: String],
                  let t = o["token"], let me = o["me"], let u = o["url"], let key = o["key"] else { return k.resume(returning: nil) }
            k.resume(returning: SupaAuth(token: t, me: me, url: u, key: key))
        }
    }
}
extension Notification.Name { static let lotmFeedChanged = Notification.Name("lotmFeedChanged") }

// MARK: - Model

struct Person { let name: String, avatar: URL? }

struct NPost: Identifiable {
    let id: String, userId: String
    var title: String, body: String, photos: [URL], link: URL?, created: Date, edited: Bool, views: Int
    var allowReplies: Bool, likes = 0, liked = false, tags: [String] = [], quoted: NQuote? = nil, quoteId: String?, saved = false
    var showTitle: Bool {
        let n = { (t: String) in t.replacingOccurrences(of: quoteMark, with: "").lowercased().replacingOccurrences(of: #"[…\.\s"“”'‘’,:;!?-]+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
        let t = n(title); return !t.isEmpty && t != "voice note" && t != "photo" && !n(body).hasPrefix(t)
    }
}
struct NQuote { let id: String, userId: String, text: String }
struct NReply: Identifiable, Equatable {
    let id: String, userId: String, body: String, created: Date, parent: String?
    var hidden: Bool, attachment: URL?, likes: Int, liked: Bool
    var saved = false
}

final class PostModel: ObservableObject {
    @Published var post: NPost?
    @Published var parts: [NPost] = []
    @Published var replies: [NReply] = []
    @Published var replyCount = 0
    @Published var failed: String?
    @Published var sending = false
    @Published var replyTo: NReply?
    @Published var scrollTo: String?
    var id: String
    let people: [String: Person]
    let focusReply: Bool
    var auth: () async -> SupaAuth? = { nil }
    var close: () -> Void = {}
    var webGo: (String) -> Void = { _ in }      // open a web screen (member, tag…) after closing
    var notifyWeb: () -> Void = {}              // the Feed refreshes its counts
    private(set) var me = ""

    init(id: String, people: [String: Person], focusReply: Bool) { self.id = id; self.people = people; self.focusReply = focusReply }
    func person(_ id: String) -> Person { people[id] ?? Person(name: "Member", avatar: nil) }
    var canReply: Bool { post?.allowReplies ?? false }

    private static let cols = "id,user_id,title,body,body_html,link_url,thumbnail_url,image_urls,created_at,edited_at,allow_comments,reply_policy,view_count,post_format,quote_of_id,audio_url"
    private func makePost(_ r: [String: Any]) -> NPost {
        let photos = ((r["image_urls"] as? [String])?.isEmpty == false ? (r["image_urls"] as? [String] ?? []) : [r["thumbnail_url"] as? String].compactMap { $0 }).compactMap(URL.init(string:))
        let body = r["body"] as? String ?? ""
        let link = (r["link_url"] as? String).flatMap(URL.init(string:)) ?? firstLink(body)
        return NPost(id: r["id"] as? String ?? "", userId: r["user_id"] as? String ?? "", title: r["title"] as? String ?? "", body: quoteMarked(body, r["body_html"] as? String),
                     photos: photos, link: photos.isEmpty ? link : nil, created: parseDate(r["created_at"]), edited: r["edited_at"] as? String != nil,
                     views: r["view_count"] as? Int ?? 0, allowReplies: (r["allow_comments"] as? Bool ?? true) && (r["reply_policy"] as? String) != "none",
                     quoteId: r["quote_of_id"] as? String)
    }
    private func firstLink(_ t: String) -> URL? {
        let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return d?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t))?.url
    }

    /// Loads everything. Returns false for a post this screen can't show yet (it then opens in the web view).
    @MainActor func load(countView: Bool = false) async -> Bool {
        guard let a = await auth() else { failed = "You’re signed out."; return true }
        me = a.me; let db = Supa(a: a)
        do {
            guard let r = try await db.rows("/rest/v1/asides?id=eq.\(id)&select=\(Self.cols)").first else { failed = "This post was deleted."; return true }
            if (r["post_format"] as? String) == "article" || (r["audio_url"] as? String) != nil { return false }
            let polls = try await db.rows("/rest/v1/polls?aside_id=eq.\(id)&select=id"); if !polls.isEmpty { return false }
            var p = makePost(r)
            let partRows = try await db.rows("/rest/v1/asides?thread_root_id=eq.\(id)&select=\(Self.cols)&order=created_at")
            var ps = partRows.map(makePost)
            let ids = ([p.id] + ps.map(\.id)).joined(separator: ",")
            async let likes = db.rows("/rest/v1/aside_likes?aside_id=in.(\(ids))&select=aside_id,user_id")
            async let tags = db.rows("/rest/v1/aside_tags?aside_id=eq.\(id)&select=tag")
            async let sv = db.rows("/rest/v1/saved_posts?user_id=eq.\(a.me)&aside_id=in.(\(ids))&select=aside_id")
            async let cs = db.rows("/rest/v1/comments?aside_id=eq.\(id)&select=id,user_id,body,created_at,parent_comment_id,hidden_by_author,attachment_url&order=created_at")
            let (L, Tg, C, SV) = try await (likes, tags, cs, sv)
            let tally = { (pid: String) in (L.filter { $0["aside_id"] as? String == pid }.count, L.contains { $0["aside_id"] as? String == pid && $0["user_id"] as? String == a.me }) }
            (p.likes, p.liked) = tally(p.id); p.tags = Tg.compactMap { $0["tag"] as? String }
            let savedIds = Set(SV.compactMap { $0["aside_id"] as? String }); p.saved = savedIds.contains(p.id)
            for k in ps.indices { (ps[k].likes, ps[k].liked) = tally(ps[k].id); ps[k].saved = savedIds.contains(ps[k].id) }
            if let q = p.quoteId, let qr = try? await db.rows("/rest/v1/asides?id=eq.\(q)&select=id,user_id,title,body").first {
                let t = (qr["body"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (qr["title"] as? String ?? "")
                p.quoted = NQuote(id: q, userId: qr["user_id"] as? String ?? "", text: t)
            }
            let cids = C.compactMap { $0["id"] as? String }
            var CL: [[String: Any]] = []
            var SC = Set<String>()
            if !cids.isEmpty {
                CL = try await db.rows("/rest/v1/comment_likes?comment_id=in.(\(cids.joined(separator: ",")))&select=comment_id,user_id")
                SC = Set(((try? await db.rows("/rest/v1/saved_comments?user_id=eq.\(a.me)&comment_id=in.(\(cids.joined(separator: ",")))&select=comment_id")) ?? []).compactMap { $0["comment_id"] as? String })
            }
            replies = C.map { c in
                let cid = c["id"] as? String ?? ""
                return NReply(id: cid, userId: c["user_id"] as? String ?? "", body: c["body"] as? String ?? "", created: parseDate(c["created_at"]),
                              parent: c["parent_comment_id"] as? String, hidden: c["hidden_by_author"] as? Bool ?? false,
                              attachment: (c["attachment_url"] as? String).flatMap(URL.init(string:)),
                              likes: CL.filter { $0["comment_id"] as? String == cid }.count,
                              liked: CL.contains { $0["comment_id"] as? String == cid && $0["user_id"] as? String == a.me }, saved: SC.contains(cid))
            }
            replyCount = replies.count
            post = p; parts = ps; failed = nil
            if countView { _ = try? await db.req("POST", "/rest/v1/rpc/increment_aside_view", json: ["p_aside_id": id]) }
        } catch { if post == nil { failed = error.localizedDescription } }
        return true
    }

    @MainActor func like(_ pid: String) async {
        let flip = { (p: inout NPost) in p.liked.toggle(); p.likes += p.liked ? 1 : -1 }
        var nowLiked = false
        if post?.id == pid { flip(&post!); nowLiked = post!.liked }
        if let k = parts.firstIndex(where: { $0.id == pid }) { flip(&parts[k]); nowLiked = parts[k].liked }
        if nowLiked { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if nowLiked { _ = try? await db.req("POST", "/rest/v1/aside_likes", json: ["aside_id": pid, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/aside_likes?aside_id=eq.\(pid)&user_id=eq.\(a.me)") }
        notifyWeb()
    }
    @MainActor func save(_ pid: String) async {
        var on = false
        if post?.id == pid { post!.saved.toggle(); on = post!.saved }
        if let k = parts.firstIndex(where: { $0.id == pid }) { parts[k].saved.toggle(); on = parts[k].saved }
        Haptic.tap()
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/saved_posts", json: ["aside_id": pid, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/saved_posts?aside_id=eq.\(pid)&user_id=eq.\(a.me)") }
        notifyWeb()
    }
    @MainActor func likeReply(_ r: NReply) async {
        guard let k = replies.firstIndex(where: { $0.id == r.id }) else { return }
        replies[k].liked.toggle(); replies[k].likes += replies[k].liked ? 1 : -1
        let on = replies[k].liked; if on { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/comment_likes", json: ["comment_id": r.id, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/comment_likes?comment_id=eq.\(r.id)&user_id=eq.\(a.me)") }
    }
    @MainActor func saveReply(_ r: NReply) async {
        guard let k = replies.firstIndex(where: { $0.id == r.id }) else { return }
        replies[k].saved.toggle(); let on = replies[k].saved; UIImpactFeedbackGenerator(style: .light).impactOccurred()
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/saved_comments", json: ["comment_id": r.id, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/saved_comments?comment_id=eq.\(r.id)&user_id=eq.\(a.me)") }
    }
    /// A report goes to the administrators, who review it within a day.
    @MainActor func reportReply(_ r: NReply, _ reason: String) async {
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/reports", json: ["reporter_id": a.me, "comment_id": r.id, "reason": reason])
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    /// Blocking a member hides everything of theirs from you.
    @MainActor func block(_ userId: String) async {
        ChatSession.shared.blocked.insert(userId); objectWillChange.send()
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/member_mutes", json: ["user_id": a.me, "muted_user_id": userId])
        notifyWeb()
    }
    @MainActor func delete(_ r: NReply) async {
        replies.removeAll { $0.id == r.id }; replyCount = replies.count
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("DELETE", "/rest/v1/comments?id=eq.\(r.id)"); notifyWeb()
    }
    @MainActor func hide(_ r: NReply) async {
        guard let k = replies.firstIndex(where: { $0.id == r.id }) else { return }
        replies[k].hidden.toggle(); let h = replies[k].hidden
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("PATCH", "/rest/v1/comments?id=eq.\(r.id)", json: ["hidden_by_author": h])
    }
    /// Publishes a reply (with a photo, and to a reply if one was chosen); returns an error message or nil.
    @MainActor func send(_ text: String, image: UIImage?) async -> String? {
        guard let a = await auth() else { return "You’re signed out." }; let db = Supa(a: a)
        sending = true; defer { sending = false }
        do {
            var att: String? = nil
            if let image { att = try await db.upload(image) }
            let row: [String: Any] = ["aside_id": id, "user_id": a.me, "body": text, "parent_comment_id": replyTo?.id ?? NSNull(),
                                      "attachment_url": att ?? NSNull(), "attachment_type": att == nil ? NSNull() : "image/jpeg", "attachment_name": att == nil ? NSNull() : "photo.jpg"]
            let d = try await db.req("POST", "/rest/v1/comments?select=id", json: row, prefer: "return=representation")
            let newId = (((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]])?.first?["id"] as? String) ?? ""
            let mentioned = people.filter { $0.key != a.me && text.contains("@" + ($0.value.name.split(separator: " ").first.map(String.init) ?? "")) }.map(\.key)
            if !mentioned.isEmpty, !newId.isEmpty { _ = try? await db.req("POST", "/rest/v1/comment_mentions", json: mentioned.map { ["comment_id": newId, "mentioned_user_id": $0] }) }
            replyTo = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            _ = await load(); scrollTo = newId; notifyWeb()
            return nil
        } catch { return error.localizedDescription }
    }
}

// MARK: - Screen (drawn as the web app's post page: .page with a Back bar, the post X-style, replies as cards,
// and the Threads-style reply pill floating at the bottom)

struct PostScreen: View {
    @ObservedObject var m: PostModel
    @State private var text = ""
    @State private var image: UIImage?
    @State private var pick: PhotosPickerItem?
    @State private var sendError: String?
    @State private var showHidden = false
    @FocusState private var typing: Bool
    private let z = T.z

    private var isAuthor: Bool { m.post?.userId == m.me }
    private var shown: [NReply] { m.replies.filter { (showHidden || !$0.hidden || isAuthor) && !ChatSession.shared.blocked.contains($0.userId) } }
    private var hiddenCount: Int { m.replies.filter(\.hidden).count }
    /// The replies as a thread: each answer under the one it answers, a step in.
    private var threaded: [(r: NReply, depth: Int)] {
        let all = shown, ids = Set(all.map(\.id))
        var kids: [String: [NReply]] = [:], out: [(r: NReply, depth: Int)] = []
        for r in all { if let p = r.parent, ids.contains(p) { kids[p, default: []].append(r) } }
        func walk(_ r: NReply, _ d: Int) { out.append((r, d)); for c in kids[r.id] ?? [] { walk(c, d + 1) } }
        for r in all where r.parent == nil || !ids.contains(r.parent!) { walk(r, 0) }
        return out
    }

    var body: some View {
        VStack(spacing: 0) {
            PageBar(title: m.parts.isEmpty ? "Post" : "Thread", back: "Feed") { m.close() }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if let p = m.post {
                            PostBody(p: p, m: m, first: true, onReply: { typing = true })
                            ForEach(m.parts) { PostBody(p: $0, m: m, first: false, onReply: { typing = true }) }
                            if !shown.isEmpty {
                                VStack(spacing: 8) {
                                    ForEach(threaded, id: \.r.id) { t in
                                        let r = t.r, step = CGFloat(min(t.depth, 3)) * 22
                                        // an orphaned answer (its parent hidden) still says whom it answers
                                        ReplyCard(r: r, m: m, parent: t.depth == 0 ? r.parent.flatMap { pid in m.replies.first { $0.id == pid } } : nil,
                                                  canHide: isAuthor && r.userId != m.me,
                                                  onReply: m.canReply ? ({ m.replyTo = r; typing = true } as () -> Void) : nil)
                                            .padding(.leading, step)
                                            .overlay(alignment: .topLeading) { if t.depth > 0 { Elbow().stroke(T.softBd, style: StrokeStyle(lineWidth: 1.5, lineCap: .round)).frame(width: 14, height: 34).offset(x: step - 17, y: -6) } }
                                            .id(r.id)
                                    }
                                }
                                .padding(.horizontal, 12).padding(.top, 12)
                            }
                            if hiddenCount > 0 && !isAuthor {
                                Button { withAnimation { showHidden.toggle() } } label: {
                                    Text("\(showHidden ? "Hide" : "Show") \(hiddenCount) hidden \(hiddenCount == 1 ? "reply" : "replies")").font(.sans(14)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(14)
                                }.overlay(alignment: .bottom) { T.rule.frame(height: 1) }
                            }
                            if m.replies.isEmpty {
                                Text(m.canReply ? "No replies yet." : "Replies are turned off for this post.").font(.sans(15)).foregroundStyle(T.muted).padding(.horizontal, 20).padding(.vertical, 16)
                            }
                            Color.clear.frame(height: 110)
                        } else if let f = m.failed {
                            Text(f).font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40)
                        } else {
                            Text("Loading…").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40)
                        }
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { _ = await m.load() }
                .onChange(of: m.scrollTo) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .center) }; m.scrollTo = nil } }
            }
        }
        .background(T.paper.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { if m.post != nil && m.canReply { replyBar } }
        .tint(T.ink)
        .preferredColorScheme(.dark)
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .alert("Couldn’t send", isPresented: Binding(get: { sendError != nil }, set: { if !$0 { sendError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(sendError ?? "") }
    }

    /// The web's ReplyBar: a floating pill with your face, the reply, a photo button, and send (or ↗ for the full composer).
    private var replyBar: some View {
        let to = m.replyTo.map { m.person($0.userId).name } ?? ""
        let first = to.split(separator: " ").first.map(String.init) ?? to
        let ok = !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && image == nil) && !m.sending
        return VStack(alignment: .leading, spacing: 8) {
            MentionBar(text: $text)
            if let r = m.replyTo {
                HStack(spacing: 6) {
                    (Text("Replying to ").foregroundColor(T.muted) + Text("@\(m.person(r.userId).name.split(separator: " ").first.map(String.init) ?? "")").foregroundColor(T.ticker)).font(.sans(13))
                    Button { m.replyTo = nil } label: { Text("×").font(.sans(15)).foregroundStyle(T.muted) }
                }
                .padding(.leading, 12)
            }
            if let image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 14)).shadow(color: .black.opacity(0.35), radius: 9, y: 6)
                    .overlay(alignment: .topTrailing) { Button { self.image = nil } label: { Text("×").font(.sans(15)).foregroundStyle(.white).frame(width: 24, height: 24).background(Circle().fill(.black.opacity(0.65))) }.padding(5) }
                    .padding(.leading, 8)
            }
            HStack(alignment: .bottom, spacing: 4) {
                Face(name: m.person(m.me).name, url: m.person(m.me).avatar, s: 36).padding(.bottom, 1)
                TextField("", text: $text, prompt: Text(first.isEmpty ? "Add a comment…" : "Reply to \(first)…").foregroundColor(T.muted), axis: .vertical)
                    .font(.serif(20)).foregroundStyle(T.ink).lineLimit(1...6).focused($typing)
                    .padding(.horizontal, 4).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 38)
                PhotosPicker(selection: $pick, matching: .images) { GlyphView(n: "image", s: 23, w: 1.9).foregroundStyle(T.ink).frame(width: 38, height: 38).contentShape(Rectangle()) }
                    .onChange(of: pick) { _, it in
                        guard let it else { return }
                        Task { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { await MainActor.run { image = img; pick = nil } } }
                    }
                if ok || typing {
                    Button {
                        let t = text.trimmingCharacters(in: .whitespacesAndNewlines), img = image
                        Task { if let e = await m.send(t, image: img) { sendError = e } else { text = ""; image = nil; typing = false } }
                    } label: {
                        GlyphView(n: "arrowup", s: 19, w: 2.4).foregroundStyle(ok ? T.paper : T.muted)
                            .frame(width: 36, height: 36).background(Circle().fill(ok ? T.ink : .white.opacity(0.12))).opacity(m.sending ? 0.5 : 1)
                    }
                    .disabled(!ok).padding(1)
                } else {
                    Button { if let p = m.post { m.close(); m.webGo("/reply/\(p.id)") } } label: { GlyphView(n: "expand", s: 21, w: 1.9).foregroundStyle(T.ink).frame(width: 38, height: 38).contentShape(Rectangle()) }
                }
            }
            .padding(.leading, 9).padding(.trailing, 8).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 30).fill(Color(rgb: 0x484c37, 0.96)))
            .overlay(RoundedRectangle(cornerRadius: 30).stroke(.white.opacity(0.12)))
            .shadow(color: Color(rgb: 0x0a0c06, 0.35), radius: 15, y: 10)
        }
        .padding(.horizontal, 12).padding(.bottom, 10)
    }
}

/// One focused post, as the web's: big header, the full writing, the time and views, the big action pills.
private struct PostBody: View {
    let p: NPost
    @ObservedObject var m: PostModel
    let first: Bool
    let onReply: () -> Void
    private let z = T.z
    private var link: URL { URL(string: "https://lotmstudy.org/next/#/post/\(p.id)")! }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if first {
                HStack(spacing: 10) {
                    Button { m.close(); m.webGo("/member/\(p.userId)") } label: { Face(name: m.person(p.userId).name, url: m.person(p.userId).avatar, s: 44 * z) }.buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.person(p.userId).name).font(.sans(14 * z, .semibold)).foregroundStyle(T.ink)
                        Text((["Reflection"] + p.tags).joined(separator: " · ")).font(.sans(13 * z)).foregroundStyle(T.muted)
                    }
                    Spacer()
                    ShareLink(item: link) { Text("···").font(.sans(15 * z, .bold)).tracking(1).foregroundStyle(T.muted) }
                }
                if p.showTitle { Text(p.title).font(.serif(19 * z, .bold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true).padding(.top, 12 * z) }
            }
            if !p.body.isEmpty { Paras(text: p.body, size: 18.5 * z, leading: 1.3, gap: 5 * z, weight: .medium).padding(.top, 8 * z) }
            if !p.photos.isEmpty { PhotoRow(urls: p.photos).padding(.top, 10 * z) }
            if let q = p.quoted {
                Button { m.id = q.id; m.post = nil; m.parts = []; m.replies = []; Task { _ = await m.load() } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) { Face(name: m.person(q.userId).name, url: m.person(q.userId).avatar, s: 20); Text(m.person(q.userId).name).font(.sans(14, .semibold)).foregroundStyle(T.ink) }
                        Text(q.text).font(.serif(16)).foregroundStyle(T.ink).lineLimit(3).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
                }
                .buttonStyle(.plain).padding(.top, 8)
            }
            if let l = p.link { LinkCard(url: l).padding(.top, 10) }
            if first {
                (Text("\(p.created.formatted(date: .omitted, time: .shortened)) · \(p.created.formatted(.dateTime.month(.abbreviated).day()))\(p.edited ? " · Edited" : "") · ").foregroundColor(T.muted)
                 + Text("\(p.views)").font(.sans(13 * z, .bold)).foregroundColor(T.ink) + Text(" views").foregroundColor(T.muted))
                    .font(.sans(13 * z)).padding(.top, 10 * z)
            }
            HStack(spacing: 8) {
                Button(action: onReply) { HStack(spacing: 6) { GlyphView(n: "reply", s: 20); if first && m.replyCount > 0 { Text("\(m.replyCount)") } } }
                    .buttonStyle(PillStyle(big: true)).disabled(!m.canReply).opacity(m.canReply ? 1 : 0.45)
                Button { Task { await m.like(p.id) } } label: { HStack(spacing: 6) { GlyphView(n: "heart", s: 20, fill: p.liked).symbolPop(p.liked); if p.likes > 0 { Text("\(p.likes)") } } }
                    .buttonStyle(PillStyle(liked: p.liked, big: true))
                Button { Task { await m.save(p.id) } } label: { GlyphView(n: "bookmark", s: 20, fill: p.saved).symbolPop(p.saved) }.buttonStyle(PillStyle(big: true))
                ShareLink(item: link) { GlyphView(n: "share", s: 20) }.buttonStyle(PillStyle(big: true))
            }
            .padding(.top, 12 * z).padding(.top, 12).overlay(alignment: .top) { Color(rgb: 0x4a4c35).frame(height: 1).padding(.top, 12 * z) }
        }
        .padding(.horizontal, 20 * z).padding(.top, 16 * z).padding(.bottom, 12 * z)
        .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
    }
}

/// A reply, as the web's ReplyRow: its own card; name and time, "Replying to @name", the writing, heart and reply.
/// The line from a reply down and round to its answer.
private struct Elbow: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY - 10))
        p.addQuadCurve(to: CGPoint(x: r.minX + 10, y: r.maxY), control: CGPoint(x: r.minX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        return p
    }
}

private struct ReplyCard: View {
    let r: NReply
    @ObservedObject var m: PostModel
    let parent: NReply?
    let canHide: Bool
    let onReply: (() -> Void)?
    @State private var confirmDelete = false
    @State private var reporting = false
    @State private var reported = false
    @State private var confirmBlock = false
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { m.close(); m.webGo("/member/\(r.userId)") } label: { Face(name: m.person(r.userId).name, url: m.person(r.userId).avatar, s: 36) }.buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(m.person(r.userId).name).font(.sans(15, .semibold)).foregroundStyle(T.ink).lineLimit(1)
                    Text(ago(r.created)).font(.sans(14)).foregroundStyle(T.muted)
                    if r.hidden { Text("· hidden").font(.sans(12)).foregroundStyle(T.muted) }
                    Spacer(minLength: 0)
                    Menu {
                        if canHide { Button(r.hidden ? "Unhide reply" : "Hide reply") { Task { await m.hide(r) } } }
                        if r.userId == m.me { Button("Delete reply", role: .destructive) { confirmDelete = true } }
                        else {
                            Button { reporting = true } label: { Label("Report", systemImage: "flag") }
                            Button(role: .destructive) { confirmBlock = true } label: { Label("Block \(m.person(r.userId).name.split(separator: " ").first.map(String.init) ?? "member")", systemImage: "hand.raised") }
                        }
                    } label: { Text("···").font(.sans(15, .bold)).tracking(1).foregroundStyle(T.muted).frame(width: 34, height: 22, alignment: .trailing).contentShape(Rectangle()) }
                    .accessibilityLabel("More")
                }
                .frame(minHeight: 20)
                if let parent {
                    (Text("Replying to ").foregroundColor(T.muted) + Text("@\(m.person(parent.userId).name.split(separator: " ").first.map(String.init) ?? "")").foregroundColor(T.ticker)).font(.sans(13)).padding(.top, 1)
                }
                if !r.body.isEmpty {
                    Text(linked(r.body)).font(.serif(18.5, .medium)).foregroundStyle(T.ink).lineSpacing(max(0, 18.5 * 1.36 - 18.5 * 1.305)).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 3)
                }
                if let u = r.attachment {
                    AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x2a2d1d) }.frame(maxWidth: .infinity, maxHeight: 300).clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule)).padding(.top, 8)
                }
                HStack(spacing: 22) {
                    Button { Task { await m.likeReply(r) } } label: {
                        HStack(spacing: 5) { GlyphView(n: "heart", s: 19, w: 1.9, fill: r.liked).symbolPop(r.liked); if r.likes > 0 { Text("\(r.likes)") } }
                            .foregroundStyle(r.liked ? T.like : T.muted).font(.sans(14)).padding(.vertical, 2)
                    }.buttonStyle(.plain)
                    if let onReply { Button(action: onReply) { GlyphView(n: "chat", s: 19, w: 1.9).foregroundStyle(T.muted).padding(.vertical, 6).padding(.horizontal, 6).contentShape(Rectangle()).padding(-6) }.buttonStyle(.plain).accessibilityLabel("Reply") }
                    Button { Task { await m.saveReply(r) } } label: { GlyphView(n: "bookmark", s: 19, w: 1.9, fill: r.saved).symbolPop(r.saved).foregroundStyle(r.saved ? T.ink : T.muted).padding(.vertical, 6).padding(.horizontal, 6).contentShape(Rectangle()).padding(-6) }
                        .buttonStyle(.plain).accessibilityLabel(r.saved ? "Remove from saved" : "Save")
                }
                .padding(.top, 8)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 18).fill(T.card))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(T.rule))
        .shadow(color: Color(rgb: 0x0c0e08, 0.12), radius: 5, y: 2)
        .opacity(r.hidden ? 0.55 : 1)
        .confirmationDialog("Delete this reply?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await m.delete(r) } }
        }
        .confirmationDialog("Why are you reporting this reply?", isPresented: $reporting, titleVisibility: .visible) {
            ForEach(["Harassment or abuse", "Hateful or offensive", "Spam", "Something else"], id: \.self) { why in Button(why) { Task { await m.reportReply(r, why); reported = true } } }
        }
        .alert("Thank you", isPresented: $reported) { Button("OK", role: .cancel) {} } message: { Text("The administrators will review this within 24 hours.") }
        .confirmationDialog("Block this member? You won’t see their posts or replies.", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await m.block(r.userId) } }
        }
    }
}

struct PhotoStrip: View {
    let urls: [URL]
    @State private var openAt: Int?
    var body: some View {
        ZStack {
            if urls.count == 1 {
                AsyncImage(url: urls[0]) { $0.resizable().scaledToFit() } placeholder: { P.soft.frame(height: 220) }
                    .frame(maxWidth: .infinity, maxHeight: 460, alignment: .leading).clipShape(RoundedRectangle(cornerRadius: 14))
                    .onTapGesture { openAt = 0 }.imageMenu(urls[0])
            } else if urls.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(urls.enumerated()), id: \.offset) { i, u in
                            AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { P.soft }
                                .frame(width: 220, height: 280).clipShape(RoundedRectangle(cornerRadius: 14)).onTapGesture { openAt = i }.imageMenu(u)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
        .fullScreenCover(item: Binding(get: { openAt.map { PhotoIndex(v: $0) } }, set: { openAt = $0?.v })) { b in Lightbox(urls: urls, start: b.v) }
    }
}
struct PhotoIndex: Identifiable { let v: Int; var id: Int { v } }

struct PersonFace: View {
    let p: Person, size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(P.tan)
            Text(p.name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()).font(.sans(size * 0.36, .semibold)).foregroundStyle(P.ink)
            if let u = p.avatar { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
        }
        .frame(width: size, height: size).clipShape(Circle())
    }
}

/// Text with its web addresses tappable.
func linked(_ s: String) -> AttributedString {
    var out = AttributedString(s)
    guard let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return out }
    for match in d.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
        guard let url = match.url, let r = Range(match.range, in: s),
              let lo = AttributedString.Index(r.lowerBound, within: out), let hi = AttributedString.Index(r.upperBound, within: out) else { continue }
        out[lo..<hi].link = url; out[lo..<hi].underlineStyle = .single
    }
    // a #topic stands out, as a member tagged with @ does
    if s.contains("#"), let re = try? NSRegularExpression(pattern: #"(?<![\p{L}\d_#])#[\p{L}\d_-]{2,40}"#) {
        for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) { if let r = Range(m.range, in: s), let lo = AttributedString.Index(r.lowerBound, within: out), let hi = AttributedString.Index(r.upperBound, within: out) { out[lo..<hi].foregroundColor = Color(rgb: 0xe2c37a) } }
    }
    // a member tagged with @ stands out
    if s.contains("@") {
        for name in Roster.names {
            var from = s.startIndex
            while let r = s.range(of: "@" + name, range: from..<s.endIndex) {
                if let lo = AttributedString.Index(r.lowerBound, within: out), let hi = AttributedString.Index(r.upperBound, within: out) { out[lo..<hi].foregroundColor = Color(rgb: 0xe2c37a); if let id = Roster.ids[name], let u = URL(string: "lotm-member://" + id) { out[lo..<hi].link = u } }
                from = r.upperBound
            }
        }
    }
    return out
}

/// Web pages and photos open in the in-app browser, as elsewhere in the app.
func openInApp(_ url: URL) {
    // a tagged member's name opens their profile
    if url.scheme == "lotm-member", let id = url.host { Task { @MainActor in if let w = Roster.web { openMember(id, w) } }; return }
    guard url.scheme == "http" || url.scheme == "https" else { UIApplication.shared.open(url); return }
    let vc = SFSafariViewController(url: url); vc.dismissButtonStyle = .done
    vc.preferredControlTintColor = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
    let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
    var top = root; while let p = top?.presentedViewController { top = p }
    top?.present(vc, animated: true)
}

// MARK: - Opening it (slides in from the right; swipe from the left edge to go back, as in any iPhone app)

final class SlideIn: NSObject, UIViewControllerTransitioningDelegate, UIViewControllerAnimatedTransitioning {
    private var presenting = true
    let interactor = UIPercentDrivenInteractiveTransition()
    var interactive = false
    func animationController(forPresented p: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? { self.presenting = true; return self }
    func animationController(forDismissed d: UIViewController) -> UIViewControllerAnimatedTransitioning? { presenting = false; return self }
    func interactionControllerForDismissal(using a: UIViewControllerAnimatedTransitioning) -> UIViewControllerInteractiveTransitioning? { interactive ? interactor : nil }
    func transitionDuration(using c: UIViewControllerContextTransitioning?) -> TimeInterval { 0.38 }
    func animateTransition(using c: UIViewControllerContextTransitioning) {
        let box = c.containerView, w = box.bounds.width
        if presenting {
            guard let to = c.view(forKey: .to) else { return c.completeTransition(false) }
            box.addSubview(to); to.frame = box.bounds.offsetBy(dx: w, dy: 0)
            to.layer.shadowColor = UIColor.black.cgColor; to.layer.shadowOpacity = 0.25; to.layer.shadowRadius = 16; to.layer.shadowOffset = CGSize(width: -6, height: 0)
            let under = c.viewController(forKey: .from)?.view
            UIView.animate(withDuration: transitionDuration(using: c), delay: 0, usingSpringWithDamping: 1, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
                to.frame = box.bounds; under?.transform = CGAffineTransform(translationX: -w * 0.22, y: 0)
            } completion: { _ in
                let done = !c.transitionWasCancelled
                if !done { under?.transform = .identity }
                c.completeTransition(done)
            }
        } else {
            guard let from = c.view(forKey: .from) else { return c.completeTransition(false) }
            let under = c.viewController(forKey: .to)?.view
            let move = { from.frame = box.bounds.offsetBy(dx: w, dy: 0); under?.transform = .identity }
            let end: (Bool) -> Void = { _ in
                let done = !c.transitionWasCancelled
                if !done { under?.transform = CGAffineTransform(translationX: -w * 0.22, y: 0) }
                c.completeTransition(done)
            }
            if interactive { UIView.animate(withDuration: transitionDuration(using: c), delay: 0, options: [.curveLinear], animations: move, completion: end) }
            else { UIView.animate(withDuration: 0.34, delay: 0, usingSpringWithDamping: 1, initialSpringVelocity: 0, options: [.allowUserInteraction], animations: move, completion: end) }
        }
    }
}

final class PostHost: UIHostingController<PostScreen> {
    let slide = SlideIn()
    @objc func edge(_ g: UIScreenEdgePanGestureRecognizer) {
        let w = max(view.bounds.width, 1), x = g.translation(in: view).x, p = max(0, min(1, x / w))
        switch g.state {
        case .began: slide.interactive = true; view.endEditing(true); dismiss(animated: true)
        case .changed: slide.interactor.update(p)
        case .ended, .cancelled:
            let fast = g.velocity(in: view).x > 600
            slide.interactor.completionSpeed = 0.9
            if (p > 0.35 || fast) && g.state == .ended { slide.interactor.finish() } else { slide.interactor.cancel() }
            slide.interactive = false
        default: break
        }
    }
}

/// window.webkit.messageHandlers.post.postMessage('{"id":…,"members":{…},"reply":false}') → the post screen slides in.
final class PostHandler: NSObject, WKScriptMessageHandler {
    weak var web: WKWebView?
    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let s = msg.body as? String, let d = s.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], let id = o["id"] as? String else { return }
        var people: [String: Person] = [:]
        for (k, v) in (o["members"] as? [String: [String: String]]) ?? [:] { people[k] = Person(name: v["name"] ?? "", avatar: (v["avatar"]).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
        let reply = o["reply"] as? Bool ?? false
        DispatchQueue.main.async { self.open(id: id, people: people, reply: reply) }
    }
    private func js(_ code: String) { web?.evaluateJavaScript(code) }
    func open(id: String, people: [String: Person], reply: Bool) {
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        var top = root; while let p = top?.presentedViewController { top = p }
        guard let top else { return }
        let m = PostModel(id: id, people: people, focusReply: reply)
        m.auth = { [weak self] in await webAuth(self?.web) }
        m.notifyWeb = { [weak self] in self?.js("window.dispatchEvent(new Event('lotm:replied'))"); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil) }
        let vc = PostHost(rootView: PostScreen(m: m))
        vc.overrideUserInterfaceStyle = .dark
        vc.view.backgroundColor = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
        vc.modalPresentationStyle = .overFullScreen
        vc.transitioningDelegate = vc.slide
        let pan = UIScreenEdgePanGestureRecognizer(target: vc, action: #selector(PostHost.edge(_:))); pan.edges = .left
        vc.view.addGestureRecognizer(pan)
        m.close = { [weak vc] in vc?.dismiss(animated: true) }
        m.webGo = { [weak self] route in self?.js("window.lotmNativeGo && window.lotmNativeGo('\(route.replacingOccurrences(of: "'", with: ""))')") }
        top.present(vc, animated: true)
        Task { @MainActor in
            // Posts this screen can't show yet (articles, polls, voice notes) open in the web view instead.
            if await m.load(countView: true) == false {
                vc.presentingViewController?.view.transform = .identity
                vc.dismiss(animated: false)
                self.js("window.lotmNativeGo && window.lotmNativeGo('/post/\(id)?web=1')")
            }
        }
    }
}
