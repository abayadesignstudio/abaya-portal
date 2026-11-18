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
    func req(_ method: String, _ path: String, json: Any? = nil, raw: Data? = nil, type: String = "application/json", prefer: String? = nil) async throws -> Data {
        guard let url = URL(string: a.url + path) else { throw err("Bad address") }
        var r = URLRequest(url: url); r.httpMethod = method; r.timeoutInterval = 30
        r.setValue(a.key, forHTTPHeaderField: "apikey"); r.setValue("Bearer \(a.token)", forHTTPHeaderField: "Authorization")
        r.setValue(type, forHTTPHeaderField: "Content-Type")
        if let prefer { r.setValue(prefer, forHTTPHeaderField: "Prefer") }
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
    func upload(_ img: UIImage) async throws -> String {
        let longSide = max(img.size.width, img.size.height), s = min(1, 2048 / max(longSide, 1))
        let size = CGSize(width: (img.size.width * s).rounded(), height: (img.size.height * s).rounded())
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        let data = UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.82) ?? Data()
        let path = "\(a.me)/\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6).lowercased()).jpg"
        try await req("POST", "/storage/v1/object/post-media/\(path)", raw: data, type: "image/jpeg")
        return "\(a.url)/storage/v1/object/public/post-media/\(path)"
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
    var allowReplies: Bool, likes = 0, liked = false, tags: [String] = [], quoted: NQuote? = nil, quoteId: String?
    var showTitle: Bool {
        let n = { (t: String) in t.lowercased().replacingOccurrences(of: #"[…\.\s"“”'‘’,:;!?-]+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
        let t = n(title); return !t.isEmpty && t != "voice note" && !n(body).hasPrefix(t)
    }
}
struct NQuote { let id: String, userId: String, text: String }
struct NReply: Identifiable, Equatable {
    let id: String, userId: String, body: String, created: Date, parent: String?
    var hidden: Bool, attachment: URL?, likes: Int, liked: Bool
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

    private static let cols = "id,user_id,title,body,link_url,thumbnail_url,image_urls,created_at,edited_at,allow_comments,reply_policy,view_count,post_format,quote_of_id,audio_url"
    private func makePost(_ r: [String: Any]) -> NPost {
        let photos = ((r["image_urls"] as? [String])?.isEmpty == false ? (r["image_urls"] as? [String] ?? []) : [r["thumbnail_url"] as? String].compactMap { $0 }).compactMap(URL.init(string:))
        let body = r["body"] as? String ?? ""
        let link = (r["link_url"] as? String).flatMap(URL.init(string:)) ?? firstLink(body)
        return NPost(id: r["id"] as? String ?? "", userId: r["user_id"] as? String ?? "", title: r["title"] as? String ?? "", body: body,
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
            async let cs = db.rows("/rest/v1/comments?aside_id=eq.\(id)&select=id,user_id,body,created_at,parent_comment_id,hidden_by_author,attachment_url&order=created_at")
            let (L, T, C) = try await (likes, tags, cs)
            let tally = { (pid: String) in (L.filter { $0["aside_id"] as? String == pid }.count, L.contains { $0["aside_id"] as? String == pid && $0["user_id"] as? String == a.me }) }
            (p.likes, p.liked) = tally(p.id); p.tags = T.compactMap { $0["tag"] as? String }
            for k in ps.indices { (ps[k].likes, ps[k].liked) = tally(ps[k].id) }
            if let q = p.quoteId, let qr = try? await db.rows("/rest/v1/asides?id=eq.\(q)&select=id,user_id,title,body").first {
                let t = (qr["body"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (qr["title"] as? String ?? "")
                p.quoted = NQuote(id: q, userId: qr["user_id"] as? String ?? "", text: t)
            }
            let cids = C.compactMap { $0["id"] as? String }
            var CL: [[String: Any]] = []
            if !cids.isEmpty { CL = try await db.rows("/rest/v1/comment_likes?comment_id=in.(\(cids.joined(separator: ",")))&select=comment_id,user_id") }
            replies = C.map { c in
                let cid = c["id"] as? String ?? ""
                return NReply(id: cid, userId: c["user_id"] as? String ?? "", body: c["body"] as? String ?? "", created: parseDate(c["created_at"]),
                              parent: c["parent_comment_id"] as? String, hidden: c["hidden_by_author"] as? Bool ?? false,
                              attachment: (c["attachment_url"] as? String).flatMap(URL.init(string:)),
                              likes: CL.filter { $0["comment_id"] as? String == cid }.count,
                              liked: CL.contains { $0["comment_id"] as? String == cid && $0["user_id"] as? String == a.me })
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
    @MainActor func likeReply(_ r: NReply) async {
        guard let k = replies.firstIndex(where: { $0.id == r.id }) else { return }
        replies[k].liked.toggle(); replies[k].likes += replies[k].liked ? 1 : -1
        let on = replies[k].liked; if on { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/comment_likes", json: ["comment_id": r.id, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/comment_likes?comment_id=eq.\(r.id)&user_id=eq.\(a.me)") }
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

// MARK: - Screen

struct PostScreen: View {
    @ObservedObject var m: PostModel
    @State private var text = ""
    @State private var image: UIImage?
    @State private var pick: PhotosPickerItem?
    @State private var sendError: String?
    @State private var showHidden = false
    @FocusState private var typing: Bool

    private var isAuthor: Bool { m.post?.userId == m.me }
    private var shown: [NReply] { m.replies.filter { showHidden || !$0.hidden || isAuthor } }
    private var hiddenCount: Int { m.replies.filter(\.hidden).count }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text(m.parts.isEmpty ? "Post" : "Thread").font(.system(size: 17, weight: .semibold)).foregroundStyle(P.ink)
                HStack {
                    Button { m.close() } label: {
                        HStack(spacing: 3) { Image(systemName: "chevron.left").font(.system(size: 20, weight: .semibold)); Text("Feed").font(.system(size: 17)) }
                            .foregroundStyle(P.ink).padding(.vertical, 8).contentShape(Rectangle())
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 12).frame(height: 48)
            .background(P.tan)
            .overlay(alignment: .bottom) { P.rule.frame(height: 0.5) }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if let p = m.post {
                            PostBody(p: p, m: m, first: true, onReply: { typing = true })
                            ForEach(m.parts) { PostBody(p: $0, m: m, first: false, onReply: { typing = true }) }
                            if !shown.isEmpty {
                                VStack(spacing: 10) {
                                    ForEach(shown) { r in
                                        ReplyCard(r: r, m: m, parent: r.parent.flatMap { pid in m.replies.first { $0.id == pid } },
                                                  canHide: isAuthor && r.userId != m.me,
                                                  onReply: m.canReply ? ({ m.replyTo = r; typing = true } as () -> Void) : nil)
                                            .id(r.id)
                                    }
                                }
                                .padding(.horizontal, 12).padding(.top, 12)
                            }
                            if hiddenCount > 0 && !isAuthor {
                                Button(showHidden ? "Hide \(hiddenCount) hidden" : "Show \(hiddenCount) hidden \(hiddenCount == 1 ? "reply" : "replies")") { withAnimation { showHidden.toggle() } }
                                    .font(.system(size: 14)).foregroundStyle(P.muted).frame(maxWidth: .infinity).padding(14)
                            }
                            if m.replies.isEmpty {
                                Text(m.canReply ? "No replies yet." : "Replies are turned off for this post.")
                                    .font(.system(size: 15)).foregroundStyle(P.muted).padding(20)
                            }
                            Color.clear.frame(height: 24)
                        } else if let f = m.failed {
                            Text(f).font(.system(size: 16)).foregroundStyle(P.muted).frame(maxWidth: .infinity).padding(.top, 80)
                        } else {
                            ProgressView().tint(P.muted).frame(maxWidth: .infinity).padding(.top, 80)
                        }
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .refreshable { _ = await m.load() }
                .onChange(of: m.scrollTo) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .center) }; m.scrollTo = nil } }
            }
        }
        .background(P.paper.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { if m.post != nil && m.canReply { replyBox } }
        .tint(P.ink)
        .preferredColorScheme(.dark)
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .task { if m.focusReply { try? await Task.sleep(nanoseconds: 450_000_000); typing = true } }
        .alert("Couldn’t send", isPresented: Binding(get: { sendError != nil }, set: { if !$0 { sendError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(sendError ?? "") }
    }

    private var replyBox: some View {
        let to = m.replyTo.map { m.person($0.userId).name } ?? m.post.map { m.person($0.userId).name } ?? ""
        let first = to.split(separator: " ").first.map(String.init) ?? to
        let ok = !(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && image == nil) && !m.sending
        return VStack(alignment: .leading, spacing: 8) {
            if let r = m.replyTo {
                HStack(spacing: 6) {
                    Text("Replying to \(m.person(r.userId).name.split(separator: " ").first.map(String.init) ?? "")").font(.system(size: 13)).foregroundStyle(P.muted)
                    Button { m.replyTo = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(P.muted) }
                }
            }
            if let image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 120, height: 90).clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(alignment: .topTrailing) {
                        Button { self.image = nil } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white).frame(width: 22, height: 22).background(Circle().fill(.black.opacity(0.65))) }.padding(4)
                    }
            }
            HStack(alignment: .bottom, spacing: 10) {
                PhotosPicker(selection: $pick, matching: .images) { Image(systemName: "photo").font(.system(size: 19)).foregroundStyle(P.muted).frame(width: 34, height: 38) }
                    .onChange(of: pick) { _, it in
                        guard let it else { return }
                        Task { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { await MainActor.run { image = img; pick = nil } } }
                    }
                TextField("Reply to \(first)…", text: $text, axis: .vertical)
                    .font(.system(size: 17)).foregroundStyle(P.ink).lineLimit(1...6).focused($typing)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 20).fill(P.soft))
                Button {
                    let t = text.trimmingCharacters(in: .whitespacesAndNewlines), img = image
                    Task {
                        if let e = await m.send(t, image: img) { sendError = e } else { text = ""; image = nil; typing = false }
                    }
                } label: {
                    Group { if m.sending { ProgressView().tint(P.paper) } else { Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)) } }
                        .foregroundStyle(P.paper).frame(width: 36, height: 36).background(Circle().fill(ok ? P.ink : P.muted.opacity(0.35)))
                }
                .disabled(!ok)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(P.card)
        .overlay(alignment: .top) { P.rule.frame(height: 0.5) }
    }
}

private struct PostBody: View {
    let p: NPost
    @ObservedObject var m: PostModel
    let first: Bool
    let onReply: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if first {
                HStack(spacing: 10) {
                    Button { m.close(); m.webGo("/member/\(p.userId)") } label: { PersonFace(p: m.person(p.userId), size: 44) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.person(p.userId).name).font(.system(size: 15, weight: .semibold)).foregroundStyle(P.ink)
                        Text((["Reflection"] + p.tags).joined(separator: " · ")).font(.system(size: 13)).foregroundStyle(P.muted)
                    }
                    Spacer()
                    ShareLink(item: URL(string: "https://lotmstudy.org/next/#/post/\(p.id)")!) { Image(systemName: "ellipsis").font(.system(size: 17, weight: .bold)).foregroundStyle(P.muted).frame(width: 36, height: 36) }
                }
                if p.showTitle { Text(p.title).font(.system(size: 26, weight: .semibold, design: .serif)).foregroundStyle(P.ink).fixedSize(horizontal: false, vertical: true) }
            }
            if !p.body.isEmpty {
                Text(linked(p.body)).font(.system(size: 18, design: .serif)).foregroundStyle(P.ink).lineSpacing(4)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            PhotoStrip(urls: p.photos)
            if let link = p.link {
                Button { openInApp(link) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text((link.host ?? "").replacingOccurrences(of: "www.", with: "").uppercased()).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(P.muted)
                        Text(link.absoluteString).font(.system(size: 15, design: .serif)).foregroundStyle(P.ink).lineLimit(2).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(RoundedRectangle(cornerRadius: 14).fill(P.paper)).overlay(RoundedRectangle(cornerRadius: 14).stroke(P.rule))
                }
            }
            if let q = p.quoted {
                Button { m.id = q.id; m.post = nil; m.parts = []; m.replies = []; Task { _ = await m.load() } } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) { PersonFace(p: m.person(q.userId), size: 20); Text(m.person(q.userId).name).font(.system(size: 14, weight: .semibold)).foregroundStyle(P.ink) }
                        Text(q.text).font(.system(size: 16, design: .serif)).foregroundStyle(P.ink).lineLimit(5).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(P.rule))
                }
            }
            if first {
                Text("\(p.created.formatted(date: .omitted, time: .shortened)) · \(p.created.formatted(.dateTime.month(.abbreviated).day()))\(p.edited ? " · Edited" : "") · \(p.views) views")
                    .font(.system(size: 13)).foregroundStyle(P.muted)
            }
            HStack(spacing: 26) {
                Button { Task { await m.like(p.id) } } label: {
                    HStack(spacing: 6) { Image(systemName: p.liked ? "heart.fill" : "heart").foregroundStyle(p.liked ? P.like : P.muted).symbolEffect(.bounce, value: p.liked); if p.likes > 0 { Text("\(p.likes)") } }
                }
                if first && m.canReply {
                    Button(action: onReply) { HStack(spacing: 6) { Image(systemName: "bubble.right"); if m.replyCount > 0 { Text("\(m.replyCount)") } } }
                }
                ShareLink(item: URL(string: "https://lotmstudy.org/next/#/post/\(p.id)")!) { Image(systemName: "paperplane") }
                Spacer()
            }
            .font(.system(size: 17)).foregroundStyle(P.muted).padding(.top, 2)
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .overlay(alignment: .bottom) { P.rule.frame(height: 0.5) }
    }
}

private struct ReplyCard: View {
    let r: NReply
    @ObservedObject var m: PostModel
    let parent: NReply?
    let canHide: Bool
    let onReply: (() -> Void)?
    @State private var confirmDelete = false
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { m.close(); m.webGo("/member/\(r.userId)") } label: { PersonFace(p: m.person(r.userId), size: 36) }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(m.person(r.userId).name).font(.system(size: 15, weight: .semibold)).foregroundStyle(P.ink)
                    Text(ago(r.created)).font(.system(size: 14)).foregroundStyle(P.muted)
                    Spacer()
                    if r.userId == m.me || canHide {
                        Menu {
                            if canHide { Button(r.hidden ? "Unhide reply" : "Hide reply", systemImage: r.hidden ? "eye" : "eye.slash") { Task { await m.hide(r) } } }
                            if r.userId == m.me { Button("Delete reply", systemImage: "trash", role: .destructive) { confirmDelete = true } }
                        } label: { Image(systemName: "ellipsis").foregroundStyle(P.muted).frame(width: 30, height: 22) }
                    }
                }
                if let parent { Text("Replying to \(m.person(parent.userId).name.split(separator: " ").first.map(String.init) ?? "")").font(.system(size: 13)).foregroundStyle(P.muted) }
                if !r.body.isEmpty { Text(linked(r.body)).font(.system(size: 17, design: .serif)).foregroundStyle(P.ink).lineSpacing(2).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
                if let u = r.attachment { PhotoStrip(urls: [u]) }
                HStack(spacing: 22) {
                    Button { Task { await m.likeReply(r) } } label: {
                        HStack(spacing: 5) { Image(systemName: r.liked ? "heart.fill" : "heart").foregroundStyle(r.liked ? P.like : P.muted).symbolEffect(.bounce, value: r.liked); if r.likes > 0 { Text("\(r.likes)") } }
                    }
                    if let onReply { Button(action: onReply) { Image(systemName: "arrowshape.turn.up.left") } }
                }
                .font(.system(size: 15)).foregroundStyle(P.muted).padding(.top, 4)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 18).fill(P.card))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(P.rule))
        .opacity(r.hidden ? 0.55 : 1)
        .confirmationDialog("Delete this reply?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await m.delete(r) } }
        }
    }
}

struct PhotoStrip: View {
    let urls: [URL]
    var body: some View {
        if urls.count == 1 {
            AsyncImage(url: urls[0]) { $0.resizable().scaledToFit() } placeholder: { P.soft.frame(height: 220) }
                .frame(maxWidth: .infinity, maxHeight: 460, alignment: .leading).clipShape(RoundedRectangle(cornerRadius: 14))
                .onTapGesture { openInApp(urls[0]) }
        } else if urls.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(urls, id: \.self) { u in
                        AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { P.soft }
                            .frame(width: 220, height: 280).clipShape(RoundedRectangle(cornerRadius: 14)).onTapGesture { openInApp(u) }
                    }
                }
            }
        }
    }
}

struct PersonFace: View {
    let p: Person, size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(P.tan)
            Text(p.name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()).font(.system(size: size * 0.36, weight: .semibold)).foregroundStyle(P.ink)
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
    return out
}

/// Web pages and photos open in the in-app browser, as elsewhere in the app.
func openInApp(_ url: URL) {
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
            UIView.animate(withDuration: transitionDuration(using: c), delay: 0, usingSpringWithDamping: 1, initialSpringVelocity: 0, options: [.allowUserInteraction]) { to.frame = box.bounds }
                completion: { _ in c.completeTransition(!c.transitionWasCancelled) }
        } else {
            guard let from = c.view(forKey: .from) else { return c.completeTransition(false) }
            UIView.animate(withDuration: transitionDuration(using: c), delay: 0, options: interactive ? [.curveLinear] : [.curveEaseIn]) { from.frame = box.bounds.offsetBy(dx: w, dy: 0) }
                completion: { _ in c.completeTransition(!c.transitionWasCancelled) }
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
                vc.dismiss(animated: false)
                self.js("window.lotmNativeGo && window.lotmNativeGo('/post/\(id)?web=1')")
            }
        }
    }
}
