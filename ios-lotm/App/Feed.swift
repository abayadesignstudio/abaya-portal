import SwiftUI
import WebKit

// The native Feed and the app's own tab bar. Screens not yet native (Library, Directory, Settings, profiles, the
// devotion…) are the web app, shown in place; the web tells the app which screen it is on.

private extension Color {
    init(hex: UInt32, a: Double = 1) { self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: a) }
}
private enum F {
    static let paper = Color(hex: 0x3b3e2a), card = Color(hex: 0x414530), ink = Color(hex: 0xf1eedd), muted = Color(hex: 0xc3c3a6)
    static let rule = Color(hex: 0x4d4f37), like = Color(hex: 0xe08a98), tan = Color(hex: 0x2d301f), soft = Color(hex: 0x454832), cream = Color(hex: 0xf4f1e2)
    static let green = Color(hex: 0x2f6b45), gold = Color(hex: 0xa8863f), wine = Color(hex: 0x8f4a4f)
}

// MARK: - Shell

enum Tab: String { case feed, library, people, settings
    var route: String { switch self { case .feed: "/native"; case .library: "/reading"; case .people: "/people"; case .settings: "/settings" } }
}

struct Shell: View {
    @ObservedObject var web: WebModel
    @StateObject private var feed = FeedModel()
    /// The web's own tab screens; anything else it shows (a profile, the devotion, a web form) is a page over the app.
    private static let webTabs: Set<String> = ["/native", "/reading", "/people", "/settings", "/notebook/index", "/chat", ""]
    private var path: String { String(web.route.split(separator: "?", maxSplits: 1).first ?? "") }
    private var overlay: Bool { !Self.webTabs.contains(path) && !path.hasPrefix("/post/") }
    private var showWeb: Bool { web.tab != .feed || overlay }

    var body: some View {
        ZStack(alignment: .bottom) {
            FeedScreen(m: feed, web: web).opacity(web.tab == .feed ? 1 : 0).allowsHitTesting(web.tab == .feed && !overlay)
            WebView(model: web).ignoresSafeArea()
                .opacity(showWeb ? 1 : 0).allowsHitTesting(showWeb)
            if !overlay { TabBar(web: web, feed: feed).transition(.opacity) }
        }
        .animation(.easeOut(duration: 0.18), value: showWeb)
        .animation(.easeOut(duration: 0.18), value: overlay)
        .background(F.paper.ignoresSafeArea())
        .onAppear { feed.web = web.view; feed.open = { id, reply in web.openPost(id, people: feed.people, reply: reply) } }
        // Back from a web page (an edit, a profile) to the Feed: catch up quietly.
        .onChange(of: path) { old, new in if new == "/native" && old != "/native" { Task { await feed.load(quiet: true) } } }
    }
}

private struct TabBar: View {
    @ObservedObject var web: WebModel
    @ObservedObject var feed: FeedModel
    var body: some View {
        HStack(spacing: 0) {
            item(.feed, "house.fill", "Feed")
            item(.library, "book", "Library")
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                web.composer.present(name: feed.myName, avatar: feed.myAvatar)
            } label: {
                Image(systemName: "pencil").font(.system(size: 20, weight: .semibold)).foregroundStyle(F.paper)
                    .frame(width: 46, height: 46).background(Circle().fill(F.ink)).shadow(color: .black.opacity(0.3), radius: 6, y: 3)
                    .frame(maxWidth: .infinity)
            }
            .accessibilityLabel("Write a post")
            item(.people, "person.2", "Directory")
            item(.settings, "gearshape", "Settings")
        }
        .padding(.horizontal, 8)
        .frame(width: min(362, UIScreen.main.bounds.width - 28), height: 68)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Capsule().fill(Color(hex: 0x454934, a: 0.8)))
        .overlay(Capsule().stroke(.white.opacity(0.16), lineWidth: 1))
        .shadow(color: Color(hex: 0x0c0e08, a: 0.25), radius: 15, y: 10)
        .padding(.bottom, 4)
        .environment(\.colorScheme, .dark)
    }
    private func item(_ t: Tab, _ icon: String, _ label: String) -> some View {
        let on = web.tab == t
        return Button {
            if on && t == .feed { feed.scrollTop += 1; return }
            UISelectionFeedbackGenerator().selectionChanged()
            web.select(t)
        } label: {
            Image(systemName: icon).font(.system(size: 23, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? F.ink : F.muted)
                .frame(width: 60, height: 52).background(Capsule().fill(on ? Color.black.opacity(0.12) : .clear))
                .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(label)
    }
}

// MARK: - Feed data

struct FPoll: Codable { let id: String; let options: [String]; let closes: Date?; var votes: [String: Int] }   // member → choice
struct FBook: Codable { let title: String; let author: String?; let cover: URL? }
struct FPost: Identifiable, Codable {
    let id: String, userId: String
    var title: String, subtitle: String, body: String, kind: String, created: Date, edited: Bool, publishAt: Date?
    var photos: [URL], link: URL?, article: Bool, audio: Bool
    var likes: Int, liked: Bool, replies: Int, saved: Bool, canReply: Bool, continuations: Int
    var quoteId: String?, quoteUser: String?, quoteText: String?
    var poll: FPoll?, book: FBook?
    var showTitle: Bool {
        if article { return !title.isEmpty }
        let n = { (t: String) in t.lowercased().replacingOccurrences(of: #"[…\.\s"“”'‘’,:;!?-]+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
        let t = n(title); return !t.isEmpty && t != "voice note" && !n(body).hasPrefix(t)
    }
}
struct FPin: Identifiable {
    enum Kind { case read, study, event, pin }
    let id: String, kind: Kind, title: String, text: String
    var detail: String? = nil, when: Date? = nil, place: String? = nil, placeURL: URL? = nil, link: URL? = nil
    var slug: String? = nil, cover: URL? = nil, sourcePost: String? = nil, rsvp = false, by: String? = nil
    var rsvpType: String { switch kind { case .study: "study"; case .event: "event"; case .pin: "pin"; case .read: "read" } }
}

final class FeedModel: ObservableObject {
    @Published var posts: [FPost] = []
    @Published var pins: [FPin] = []
    @Published var people: [String: Person] = [:]
    @Published var unread = 0
    @Published var loaded = false
    @Published var failed: String?
    @Published var scrollTop = 0
    @Published var detail: FPin?
    weak var web: WKWebView?
    var open: (String, Bool) -> Void = { _, _ in }
    private(set) var me = ""
    private var cacheKey: String { "lotm.feed." + me }
    var myName: String { people[me]?.name ?? "" }
    var myAvatar: URL? { people[me]?.avatar }
    private var watching: NSObjectProtocol?

    init() {
        // The last Feed shows at once; the fresh one replaces it a moment later.
        if let me = UserDefaults.standard.string(forKey: "lotm.me") {
            self.me = me
            if let d = UserDefaults.standard.data(forKey: "lotm.feed." + me), let p = try? JSONDecoder().decode([FPost].self, from: d) { posts = p; loaded = true }
            if let d = UserDefaults.standard.dictionary(forKey: "lotm.people") as? [String: [String: String]] { people = Self.people(d) }
        }
        watching = NotificationCenter.default.addObserver(forName: .lotmFeedChanged, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in await self?.load(quiet: true) } }
    }
    private static func people(_ d: [String: [String: String]]) -> [String: Person] {
        d.mapValues { Person(name: $0["name"] ?? "", avatar: ($0["avatar"]).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
    }

    @MainActor func auth() async -> SupaAuth? {
        // The web app may still be starting: wait a little for its session.
        for _ in 0..<20 { if let a = await webAuth(web) { return a }; try? await Task.sleep(nanoseconds: 300_000_000) }
        return nil
    }

    @MainActor func load(quiet: Bool = false) async {
        guard let a = await auth() else { if posts.isEmpty { failed = "Couldn’t reach the club. Pull to try again." }; return }
        me = a.me; UserDefaults.standard.set(a.me, forKey: "lotm.me")
        let db = Supa(a: a)
        do {
            async let profiles = db.rows("/rest/v1/profiles?select=id,display_name,avatar_url,status")
            async let feed = loadPosts(db)
            async let pinList = loadPins(db)
            async let notes = db.rows("/rest/v1/notifications?user_id=eq.\(a.me)&read_at=is.null&select=id&limit=99")
            let (Pr, Fe, Pi, Nn) = try await (profiles, feed, pinList, notes)
            var map: [String: [String: String]] = [:]
            for p in Pr { if let id = p["id"] as? String { map[id] = ["name": p["display_name"] as? String ?? "", "avatar": p["avatar_url"] as? String ?? ""] } }
            people = Self.people(map); UserDefaults.standard.set(map, forKey: "lotm.people")
            posts = Fe; pins = Pi; unread = Nn.count; loaded = true; failed = nil
            if let d = try? JSONEncoder().encode(Array(Fe.prefix(25))) { UserDefaults.standard.set(d, forKey: cacheKey) }
        } catch { if posts.isEmpty { failed = error.localizedDescription } }
    }

    private static let cols = "id,user_id,title,subtitle,body,aside_type,link_url,thumbnail_url,image_urls,created_at,edited_at,allow_comments,reply_policy,thread_parent_id,quote_of_id,post_format,selected_edition_id,related_edition_id,audio_url,publish_at"
    private func loadPosts(_ db: Supa) async throws -> [FPost] {
        let me = db.a.me
        let rows = try await db.rows("/rest/v1/asides?select=\(Self.cols)&or=(visibility.eq.public,visibility.is.null,and(user_id.eq.\(me),publish_at.not.is.null))&order=created_at.desc&limit=60")
        let muted = Set(try await db.rows("/rest/v1/member_mutes?user_id=eq.\(me)&select=muted_user_id").compactMap { $0["muted_user_id"] as? String })
        let top = rows.filter { ($0["thread_parent_id"] as? String) == nil && !muted.contains($0["user_id"] as? String ?? "") }
        let ids = top.compactMap { $0["id"] as? String }
        guard !ids.isEmpty else { return [] }
        let list = ids.joined(separator: ",")
        let qids = top.compactMap { $0["quote_of_id"] as? String }, eids = Set(top.compactMap { ($0["selected_edition_id"] as? String) ?? ($0["related_edition_id"] as? String) })
        async let L = db.rows("/rest/v1/aside_likes?aside_id=in.(\(list))&select=aside_id,user_id")
        async let C = db.rows("/rest/v1/comments?aside_id=in.(\(list))&select=aside_id")
        async let S = db.rows("/rest/v1/saved_posts?user_id=eq.\(me)&aside_id=in.(\(list))&select=aside_id")
        async let PO = db.rows("/rest/v1/polls?aside_id=in.(\(list))&select=id,aside_id,options,closes_at,poll_votes(user_id,option_index)")
        async let T = db.rows("/rest/v1/asides?thread_root_id=in.(\(list))&select=thread_root_id")
        async let Q = db.rowsIf(!qids.isEmpty, "/rest/v1/asides?id=in.(\(qids.joined(separator: ",")))&select=id,user_id,title,body")
        async let E = db.rowsIf(!eids.isEmpty, "/rest/v1/editions?id=in.(\(eids.joined(separator: ",")))&select=id,title,author,cover_url")
        let (likes, cs, saved, polls, conts, quotes, eds) = try await (L, C, S, PO, T, Q, E)
        func count(_ a: [[String: Any]], _ k: String, _ id: String) -> Int { a.filter { $0[k] as? String == id }.count }
        return top.map { r in
            let id = r["id"] as? String ?? "", body = r["body"] as? String ?? ""
            let photos = ((r["image_urls"] as? [String])?.isEmpty == false ? (r["image_urls"] as? [String] ?? []) : [r["thumbnail_url"] as? String].compactMap { $0 }).compactMap(URL.init(string:))
            let fmt = r["post_format"] as? String
            let article = fmt == "article" || (fmt == nil && body.split(whereSeparator: \.isWhitespace).count > 250)
            let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
            let link = (r["link_url"] as? String).flatMap(URL.init(string:)) ?? detector?.firstMatch(in: body, range: NSRange(body.startIndex..., in: body))?.url
            let q = (r["quote_of_id"] as? String).flatMap { qid in quotes.first { $0["id"] as? String == qid } }
            let pr = polls.first { $0["aside_id"] as? String == id }
            let poll = pr.map { p -> FPoll in
                var v: [String: Int] = [:]; for x in (p["poll_votes"] as? [[String: Any]]) ?? [] { if let u = x["user_id"] as? String { v[u] = x["option_index"] as? Int ?? 0 } }
                return FPoll(id: p["id"] as? String ?? "", options: p["options"] as? [String] ?? [], closes: (p["closes_at"] as? String).map { parseDate($0) }, votes: v)
            }
            let eid = (r["selected_edition_id"] as? String) ?? (r["related_edition_id"] as? String)
            let book = eid.flatMap { e in eds.first { $0["id"] as? String == e } }.map { FBook(title: $0["title"] as? String ?? "", author: $0["author"] as? String, cover: ($0["cover_url"] as? String).flatMap(URL.init(string:))) }
            let audio = (r["audio_url"] as? String) != nil
            let kind = (r["publish_at"] as? String) != nil ? "Scheduled" : article ? "Article" : (r["quote_of_id"] as? String) != nil ? "Quote" : poll != nil ? "Poll" : audio ? "Voice note" : (r["aside_type"] as? String ?? "Reflection")
            return FPost(id: id, userId: r["user_id"] as? String ?? "", title: r["title"] as? String ?? "", subtitle: r["subtitle"] as? String ?? "", body: body, kind: kind,
                         created: parseDate(r["created_at"]), edited: (r["edited_at"] as? String) != nil, publishAt: (r["publish_at"] as? String).map { parseDate($0) },
                         photos: article ? [] : photos, link: photos.isEmpty && !audio ? link : nil, article: article, audio: audio,
                         likes: count(likes, "aside_id", id), liked: likes.contains { $0["aside_id"] as? String == id && $0["user_id"] as? String == me },
                         replies: count(cs, "aside_id", id), saved: saved.contains { $0["aside_id"] as? String == id },
                         canReply: (r["allow_comments"] as? Bool ?? true) && (r["reply_policy"] as? String) != "none",
                         continuations: count(conts, "thread_root_id", id),
                         quoteId: q?["id"] as? String, quoteUser: q?["user_id"] as? String,
                         quoteText: q.map { (($0["body"] as? String).flatMap { $0.isEmpty ? nil : $0 }) ?? ($0["title"] as? String ?? "") },
                         poll: poll, book: book)
        }
    }

    private func loadPins(_ db: Supa) async throws -> [FPin] {
        let now = ISO8601DateFormatter().string(from: Date()), soon = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3 * 3600))
        let today = String(now.prefix(10))
        async let P = db.rows("/rest/v1/weekly_pins?expires_at=gt.\(now)&select=id,user_id,body,source_aside_id,link_url,rsvp_enabled&order=created_at.desc")
        async let S = db.rows("/rest/v1/club_updates?study_at=gte.\(soon)&select=id,book_title,book_author,cover_url,cover_image_url,reading_position,study_at,study_location,study_location_url&order=study_at.asc,created_at.desc&limit=1")
        async let R = db.rows("/rest/v1/devotionals?show_from=lte.\(today)&show_until=gte.\(today)&select=slug,title,subtitle")
        async let E = db.rows("/rest/v1/club_events?starts_at=gte.\(soon)&select=id,title,description,location,location_url,starts_at,external_url&order=starts_at&limit=8")
        let (pins, study, reads, events) = try await (P, S, R, E)
        var out: [FPin] = []
        for r in reads { out.append(FPin(id: "read" + (r["slug"] as? String ?? ""), kind: .read, title: r["title"] as? String ?? "", text: (r["subtitle"] as? String) ?? (r["title"] as? String ?? ""), slug: r["slug"] as? String)) }
        if let s = study.first, let at = s["study_at"] as? String {
            let book = (s["book_title"] as? String ?? "").replacingOccurrences(of: #"^Amazon\.com:\s*"#, with: "", options: .regularExpression).components(separatedBy: ":").first ?? ""
            let pos = (s["reading_position"] as? String).flatMap { $0 == "TBD" || $0.isEmpty ? nil : $0 }
            out.append(FPin(id: s["id"] as? String ?? "", kind: .study, title: book, text: [book, pos].compactMap { $0 }.joined(separator: ", "),
                            detail: pos.map { "Read \($0)" }, when: parseDate(at), place: s["study_location"] as? String,
                            placeURL: (s["study_location_url"] as? String).flatMap(URL.init(string:)),
                            cover: ((s["cover_url"] as? String) ?? (s["cover_image_url"] as? String)).flatMap(URL.init(string:)), rsvp: true))
        }
        for e in events {
            out.append(FPin(id: e["id"] as? String ?? "", kind: .event, title: e["title"] as? String ?? "", text: e["title"] as? String ?? "",
                            detail: e["description"] as? String, when: parseDate(e["starts_at"]), place: e["location"] as? String,
                            placeURL: (e["location_url"] as? String).flatMap(URL.init(string:)), link: (e["external_url"] as? String).flatMap(URL.init(string:)), rsvp: true))
        }
        for p in pins {
            out.append(FPin(id: p["id"] as? String ?? "", kind: .pin, title: "Pinned", text: p["body"] as? String ?? "",
                            link: (p["link_url"] as? String).flatMap(URL.init(string:)), sourcePost: p["source_aside_id"] as? String,
                            rsvp: p["rsvp_enabled"] as? Bool ?? false, by: p["user_id"] as? String))
        }
        return out
    }

    // MARK: actions (each flips at once; the server catches up)
    @MainActor func like(_ p: FPost) async {
        guard let k = posts.firstIndex(where: { $0.id == p.id }) else { return }
        posts[k].liked.toggle(); posts[k].likes += posts[k].liked ? 1 : -1
        let on = posts[k].liked; if on { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/aside_likes", json: ["aside_id": p.id, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/aside_likes?aside_id=eq.\(p.id)&user_id=eq.\(a.me)") }
    }
    @MainActor func save(_ p: FPost) async {
        guard let k = posts.firstIndex(where: { $0.id == p.id }) else { return }
        posts[k].saved.toggle(); let on = posts[k].saved; UIImpactFeedbackGenerator(style: .light).impactOccurred()
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if on { _ = try? await db.req("POST", "/rest/v1/saved_posts", json: ["aside_id": p.id, "user_id": a.me]) }
        else { _ = try? await db.req("DELETE", "/rest/v1/saved_posts?aside_id=eq.\(p.id)&user_id=eq.\(a.me)") }
    }
    @MainActor func vote(_ p: FPost, _ i: Int) async {
        guard let k = posts.firstIndex(where: { $0.id == p.id }), var poll = posts[k].poll else { return }
        if let c = poll.closes, c < Date() { return }
        let mine = poll.votes[me]
        if mine == i { poll.votes[me] = nil } else { poll.votes[me] = i }
        posts[k].poll = poll; UISelectionFeedbackGenerator().selectionChanged()
        guard let a = await auth() else { return }; let db = Supa(a: a)
        if mine != nil { _ = try? await db.req("DELETE", "/rest/v1/poll_votes?poll_id=eq.\(poll.id)&user_id=eq.\(a.me)") }
        if mine != i { _ = try? await db.req("POST", "/rest/v1/poll_votes", json: ["poll_id": poll.id, "user_id": a.me, "option_index": i]) }
    }
    @MainActor func delete(_ p: FPost) async {
        posts.removeAll { $0.id == p.id }
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("DELETE", "/rest/v1/asides?id=eq.\(p.id)")
    }
    @MainActor func mute(_ p: FPost) async {
        posts.removeAll { $0.userId == p.userId }
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/member_mutes", json: ["user_id": a.me, "muted_user_id": p.userId])
    }
    @MainActor func report(_ p: FPost, _ reason: String) async {
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/reports", json: ["reporter_id": a.me, "aside_id": p.id, "reason": reason])
    }
    @MainActor func setReplies(_ p: FPost, on: Bool) async {
        guard let k = posts.firstIndex(where: { $0.id == p.id }) else { return }
        posts[k].canReply = on
        guard let a = await auth() else { return }
        _ = try? await Supa(a: a).req("PATCH", "/rest/v1/asides?id=eq.\(p.id)", json: ["reply_policy": on ? "everyone" : "none", "allow_comments": on])
    }
}

// MARK: - Feed screen

struct FeedScreen: View {
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    @State private var reporting: FPost?
    @State private var reason = ""
    @State private var deleting: FPost?

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        Color.clear.frame(height: 0).id("top")
                        if !m.pins.isEmpty { pinRow }
                        if !m.loaded {
                            ProgressView().tint(F.muted).padding(.top, 80)
                        } else if let f = m.failed, m.posts.isEmpty {
                            Text(f).font(.system(size: 16)).foregroundStyle(F.muted).multilineTextAlignment(.center).padding(40)
                        } else if m.posts.isEmpty {
                            Text("Nothing here yet.").font(.system(size: 17, design: .serif)).foregroundStyle(F.muted).padding(.top, 60)
                        }
                        ForEach(m.posts) { p in
                            PostCard(p: p, m: m, web: web, report: { reporting = p; reason = "" }, delete: { deleting = p })
                        }
                        Color.clear.frame(height: 110)
                    }
                }
                .refreshable { await m.load() }
                .onChange(of: m.scrollTop) { _, _ in withAnimation(.snappy) { proxy.scrollTo("top", anchor: .top) } }
            }
        }
        .background(F.paper.ignoresSafeArea())
        .task { await m.load() }
        .sheet(item: $m.detail) { PinSheet(it: $0, m: m, web: web).presentationDetents([.medium, .large]).presentationDragIndicator(.visible) }
        .alert("Report this post", isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } })) {
            TextField("What is wrong with it?", text: $reason)
            Button("Cancel", role: .cancel) {}
            Button("Send to an admin") { if let p = reporting { Task { await m.report(p, reason) } } }
        } message: { Text("It goes to the administrators.") }
        .confirmationDialog("Delete this post? This cannot be undone.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let p = deleting { Task { await m.delete(p) } } }
        }
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack {
            circleButton("magnifyingglass") { web.go("/search") }
            Spacer()
            HStack(alignment: .center, spacing: 6) {
                Text("Life")
                VStack(spacing: -3) { Text("of"); Text("the") }.font(.system(size: 11, weight: .semibold, design: .serif).smallCaps()).padding(.bottom, 6)
                Text("Mind")
            }
            .font(.system(size: 32, weight: .semibold, design: .serif).smallCaps())
            .foregroundStyle(F.cream)
            .onTapGesture { m.scrollTop += 1 }
            Spacer()
            circleButton("bell") { web.go("/notifications") }
                .overlay(alignment: .topTrailing) {
                    if m.unread > 0 {
                        Text(m.unread > 9 ? "9+" : "\(m.unread)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18).background(Capsule().fill(Color(hex: 0xc9382f))).offset(x: 4, y: -4)
                    }
                }
        }
        .padding(.horizontal, 14).padding(.top, 6).padding(.bottom, 12)
        .background(LinearGradient(colors: [F.tan, F.tan, F.paper], startPoint: .top, endPoint: .bottom).ignoresSafeArea(edges: .top))
    }
    private func circleButton(_ icon: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) { Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(F.cream).frame(width: 36, height: 36).background(Circle().fill(Color.white.opacity(0.12))) }
    }

    private var pinRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(m.pins) { it in
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        if it.kind == .read, let s = it.slug { web.go("/read/\(s)") } else { m.detail = it }
                    } label: { PinCard(it: it, m: m) }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
    }
}

private func kicker(_ it: FPin) -> String {
    switch it.kind { case .read: "Pray"; case .study: "Next study"; case .event: "Coming up"; case .pin: "Pinned" }
}
private func when(_ d: Date?) -> String {
    guard let d else { return "" }
    return d.formatted(.dateTime.weekday(.wide).hour().minute()).replacingOccurrences(of: ":00", with: "")
}

private struct PinCard: View {
    let it: FPin
    @ObservedObject var m: FeedModel
    var body: some View {
        HStack(spacing: 10) {
            if let c = it.cover {
                AsyncImage(url: c) { $0.resizable().scaledToFill() } placeholder: { F.soft }.frame(width: 38, height: 56).clipShape(RoundedRectangle(cornerRadius: 3))
            } else if it.kind == .read {
                Image(systemName: "sun.and.horizon").font(.system(size: 22)).foregroundStyle(F.cream).frame(width: 38)
            } else if let w = it.when {
                VStack(spacing: 0) {
                    Text(w.formatted(.dateTime.weekday(.abbreviated)).uppercased()).font(.system(size: 9, weight: .bold)).foregroundStyle(F.muted)
                    Text(w.formatted(.dateTime.day())).font(.system(size: 19, weight: .semibold)).foregroundStyle(F.ink)
                }
                .frame(width: 44, height: 44).background(Circle().fill(F.card))
            } else if let by = it.by {
                PersonFace(p: m.people[by] ?? Person(name: "", avatar: nil), size: 40)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(kicker(it).uppercased()).font(.system(size: 10.5, weight: .bold)).tracking(0.8).foregroundStyle(F.muted)
                Text(it.kind == .pin ? it.text : it.title).font(.system(size: 16, weight: .semibold, design: .serif)).foregroundStyle(F.ink).lineLimit(2).multilineTextAlignment(.leading)
                if it.kind == .read { Text(it.text).font(.system(size: 13)).foregroundStyle(F.muted).lineLimit(1) }
                else if it.when != nil { Text(when(it.when) + (it.place.map { " · " + $0 } ?? "")).font(.system(size: 13)).foregroundStyle(F.muted).lineLimit(1) }
            }
            Spacer(minLength: 0)
        }
        .padding(12).frame(width: 268, height: 84, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(F.card))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(F.rule))
    }
}

private struct PinSheet: View {
    let it: FPin
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    @State private var rsvps: [String: String] = [:]     // member → yes | maybe | no
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(kicker(it).uppercased()).font(.system(size: 12, weight: .bold)).tracking(0.8).foregroundStyle(F.muted)
                Text(it.kind == .pin ? "Pinned" : it.title).font(.system(size: 28, weight: .semibold, design: .serif)).foregroundStyle(F.ink)
                if let w = it.when {
                    Label(w.formatted(.dateTime.weekday(.wide).month(.wide).day().hour().minute()), systemImage: "calendar").font(.system(size: 16)).foregroundStyle(F.ink)
                }
                if let place = it.place {
                    Button { openInApp(it.placeURL ?? URL(string: "https://maps.apple.com/?q=" + (place.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""))!) } label: {
                        Label(place, systemImage: "mappin.and.ellipse").font(.system(size: 16)).foregroundStyle(F.ink).underline()
                    }
                }
                if let d = (it.kind == .pin ? Optional(it.text) : it.detail), !d.isEmpty {
                    Text(linked(d)).font(.system(size: 18, design: .serif)).foregroundStyle(F.ink).lineSpacing(3).textSelection(.enabled)
                }
                HStack(spacing: 10) {
                    if let w = it.when { calendarButton(w) }
                    if let l = it.link { pill("Open link", "safari") { openInApp(l) } }
                    if let s = it.sourcePost { pill("Open post", "text.bubble") { m.detail = nil; m.open(s, false) } }
                }
                if it.rsvp { rsvpRow }
            }
            .padding(24)
        }
        .background(F.card.ignoresSafeArea())
        .task { await loadRsvps() }
        .preferredColorScheme(.dark)
    }
    private func pill(_ t: String, _ icon: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) { Label(t, systemImage: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(F.ink).padding(.horizontal, 14).frame(height: 38).background(Capsule().fill(F.soft)) }
    }
    private func calendarButton(_ w: Date) -> some View {
        pill("Add to Calendar", "calendar.badge.plus") {
            let f = ISO8601DateFormatter()
            var c = URLComponents(string: "https://lotmstudy.org/ics")!
            c.queryItems = [URLQueryItem(name: "title", value: it.kind == .study ? "Life of the Mind — \(it.title)" : it.title),
                            URLQueryItem(name: "start", value: f.string(from: w)), URLQueryItem(name: "end", value: f.string(from: w.addingTimeInterval(7200))),
                            URLQueryItem(name: "uid", value: "\(it.rsvpType)-\(it.id)")] + (it.place.map { [URLQueryItem(name: "location", value: $0)] } ?? [])
            if let u = c.url { UIApplication.shared.open(u) }
        }
    }
    private var rsvpRow: some View {
        let going = rsvps.filter { $0.value == "yes" }.map(\.key), maybe = rsvps.filter { $0.value == "maybe" }.count, no = rsvps.filter { $0.value == "no" }.count
        let mine = rsvps[m.me]
        return HStack(spacing: 8) {
            HStack(spacing: -7) { ForEach(going.prefix(3), id: \.self) { PersonFace(p: m.people[$0] ?? Person(name: "", avatar: nil), size: 24).overlay(Circle().stroke(F.card, lineWidth: 2)) } }
            Text([going.isEmpty ? "No one yet" : "\(going.count) going", maybe > 0 ? "\(maybe) maybe" : nil, no > 0 ? "\(no) can’t" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 13)).foregroundStyle(F.muted)
            Spacer()
            ForEach([("yes", "hand.thumbsup", F.green), ("maybe", "questionmark", F.gold), ("no", "hand.thumbsdown", F.wine)], id: \.0) { v, icon, tone in
                Button { Task { await set(v) } } label: {
                    Image(systemName: icon).font(.system(size: 17)).foregroundStyle(mine == v ? .white : F.ink)
                        .frame(width: 40, height: 40).background(Circle().fill(mine == v ? tone : .clear)).overlay(Circle().stroke(mine == v ? .clear : Color(hex: 0x50533a)))
                }
            }
        }
        .padding(.top, 14).overlay(alignment: .top) { F.rule.frame(height: 0.5) }
    }
    @MainActor private func loadRsvps() async {
        guard it.rsvp, let a = await m.auth() else { return }
        let rows = (try? await Supa(a: a).rows("/rest/v1/rsvps?target_type=eq.\(it.rsvpType)&target_id=eq.\(it.id)&select=user_id,going,maybe")) ?? []
        var out: [String: String] = [:]
        for r in rows { if let u = r["user_id"] as? String { out[u] = (r["going"] as? Bool ?? false) ? "yes" : (r["maybe"] as? Bool ?? false) ? "maybe" : "no" } }
        rsvps = out
    }
    @MainActor private func set(_ v: String) async {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        rsvps[m.me] = v
        guard let a = await m.auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/rsvps?on_conflict=target_type,target_id,user_id",
                                      json: ["target_type": it.rsvpType, "target_id": it.id, "user_id": a.me, "going": v == "yes", "maybe": v == "maybe", "updated_at": ISO8601DateFormatter().string(from: Date())],
                                      prefer: "resolution=merge-duplicates")
        await loadRsvps()
    }
}

// MARK: - A post in the Feed

private struct PostCard: View {
    let p: FPost
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    let report: () -> Void
    let delete: () -> Void
    private var person: Person { m.people[p.userId] ?? Person(name: "Member", avatar: nil) }
    private var mine: Bool { p.userId == m.me }
    private var shareURL: URL { URL(string: "https://lotmstudy.org/next/#/post/\(p.id)")! }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button { web.go("/member/\(p.userId)") } label: { PersonFace(p: person, size: 36) }
                HStack(spacing: 4) {
                    Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(F.ink).lineLimit(1)
                    Text("· \(p.publishAt.map { "Scheduled · " + $0.formatted(.dateTime.weekday(.abbreviated).hour().minute()) } ?? "\(p.kind) · \(ago(p.created))")\(p.edited ? " · Edited" : "")")
                        .font(.system(size: 14)).foregroundStyle(F.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                menu
            }
            if p.showTitle {
                Text(p.title).font(.system(size: p.article ? 24 : 20, weight: .semibold, design: .serif)).foregroundStyle(F.ink).fixedSize(horizontal: false, vertical: true)
            }
            if p.article && !p.subtitle.isEmpty { Text(p.subtitle).font(.system(size: 16, design: .serif)).foregroundStyle(Color(hex: 0xcdcbb4)) }
            if !p.body.isEmpty {
                Text(linked(p.body)).font(.system(size: 18, design: .serif)).foregroundStyle(F.ink).lineSpacing(3)
                    .lineLimit(p.article ? 4 : 9).fixedSize(horizontal: false, vertical: true)
            }
            if p.audio { Label("Voice note", systemImage: "waveform").font(.system(size: 15, weight: .semibold)).foregroundStyle(F.ink).padding(.horizontal, 14).frame(height: 38).background(Capsule().fill(F.soft)) }
            PhotoStrip(urls: p.photos)
            if let b = p.book {
                HStack(spacing: 10) {
                    AsyncImage(url: b.cover) { $0.resizable().scaledToFill() } placeholder: { Color(hex: 0xc9c7af) }.frame(width: 28, height: 40).clipShape(RoundedRectangle(cornerRadius: 3))
                    VStack(alignment: .leading, spacing: 1) { Text(b.title).font(.system(size: 14, design: .serif).italic()).foregroundStyle(F.ink); if let a = b.author { Text(a).font(.system(size: 12)).foregroundStyle(F.muted) } }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12).fill(F.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x54563c)))
            }
            if let qid = p.quoteId {
                Button { m.open(qid, false) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) { PersonFace(p: m.people[p.quoteUser ?? ""] ?? Person(name: "", avatar: nil), size: 20); Text(m.people[p.quoteUser ?? ""]?.name ?? "").font(.system(size: 14, weight: .semibold)).foregroundStyle(F.ink) }
                        Text(p.quoteText ?? "").font(.system(size: 16, design: .serif)).foregroundStyle(F.ink).lineLimit(3).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(RoundedRectangle(cornerRadius: 12).fill(F.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x54563c)))
                }
                .buttonStyle(.plain)
            }
            if let poll = p.poll { PollBox(poll: poll, me: m.me) { i in Task { await m.vote(p, i) } } }
            if let l = p.link {
                Button { openInApp(l) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text((l.host ?? "").replacingOccurrences(of: "www.", with: "").uppercased()).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(F.muted)
                        Text(l.absoluteString).font(.system(size: 15, design: .serif)).foregroundStyle(F.ink).lineLimit(2).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(RoundedRectangle(cornerRadius: 14).fill(F.paper)).overlay(RoundedRectangle(cornerRadius: 14).stroke(F.rule))
                }
                .buttonStyle(.plain)
            }
            if p.continuations > 0 {
                Text("Show this thread · \(p.continuations + 1) posts").font(.system(size: 14, weight: .semibold)).foregroundStyle(F.muted)
            }
            actions
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 10)
        .contentShape(Rectangle())
        .onTapGesture { m.open(p.id, false) }
        .overlay(alignment: .bottom) { F.rule.frame(height: 0.5) }
    }

    private var actions: some View {
        HStack(spacing: 6) {
            pill { m.open(p.id, true) } content: { Image(systemName: "bubble.right"); if p.replies > 0 { Text("\(p.replies)") } }
                .disabled(!p.canReply).opacity(p.canReply ? 1 : 0.45)
            pill { Task { await m.like(p) } } content: {
                Image(systemName: p.liked ? "heart.fill" : "heart").foregroundStyle(p.liked ? F.like : F.muted).symbolEffect(.bounce, value: p.liked)
                if p.likes > 0 { Text("\(p.likes)").foregroundStyle(p.liked ? F.like : F.muted) }
            }
            pill { Task { await m.save(p) } } content: { Image(systemName: p.saved ? "bookmark.fill" : "bookmark").symbolEffect(.bounce, value: p.saved) }
            ShareLink(item: shareURL) { Image(systemName: "square.and.arrow.up").frame(height: 34).padding(.horizontal, 12) }
            Spacer()
        }
        .font(.system(size: 16)).foregroundStyle(F.muted)
    }
    private func pill<C: View>(_ run: @escaping () -> Void, @ViewBuilder content: () -> C) -> some View {
        Button(action: run) { HStack(spacing: 5) { content() }.frame(height: 34).padding(.horizontal, 12).contentShape(Capsule()) }
            .buttonStyle(.plain)
    }
    private var menu: some View {
        Menu {
            Button("Copy link", systemImage: "link") { UIPasteboard.general.url = shareURL }
            Button("Quote in a post", systemImage: "quote.opening") { web.go("/write?quote=\(p.id)") }
            if mine {
                Section("Your post") {
                    Button("Edit", systemImage: "pencil") { web.go("/write/\(p.id)") }
                    Button("Continue this thread", systemImage: "plus") { web.go("/write?continue=\(p.id)") }
                    Button(p.canReply ? "Turn replies off" : "Turn replies on", systemImage: "bubble.left.and.bubble.right") { Task { await m.setReplies(p, on: !p.canReply) } }
                    Button("Delete", systemImage: "trash", role: .destructive, action: delete)
                }
            } else {
                Button("Mute \(person.name.split(separator: " ").first.map(String.init) ?? "")", systemImage: "speaker.slash") { Task { await m.mute(p) } }
                Button("Report to an admin", systemImage: "flag", role: .destructive, action: report)
            }
        } label: { Image(systemName: "ellipsis").font(.system(size: 16, weight: .bold)).foregroundStyle(F.muted).frame(width: 34, height: 28) }
    }
}

private struct PollBox: View {
    let poll: FPoll, me: String
    let vote: (Int) -> Void
    var body: some View {
        let mine = poll.votes[me], closed = poll.closes.map { $0 < Date() } ?? false, total = poll.votes.count, show = mine != nil || closed
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(poll.options.enumerated()), id: \.offset) { i, o in
                let n = poll.votes.values.filter { $0 == i }.count, pct = total > 0 ? Double(n) / Double(total) : 0
                Button { vote(i) } label: {
                    HStack { Text(o + (mine == i ? " ✓" : "")); Spacer(); if show { Text("\(Int((pct * 100).rounded()))%") } }
                        .font(.system(size: 15)).foregroundStyle(F.ink).padding(.horizontal, 12).frame(height: 38)
                        .background(alignment: .leading) { GeometryReader { g in Rectangle().fill(mine == i ? Color(hex: 0x4d5038) : Color(hex: 0x434530)).frame(width: show ? g.size.width * pct : 0) } }
                        .background(F.card).clipShape(RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x54563c)))
                }
                .buttonStyle(.plain).disabled(closed)
            }
            Text("\(total) vote\(total == 1 ? "" : "s")\(poll.closes.map { $0 < Date() ? " · Final results" : " · Closes " + $0.formatted(.relative(presentation: .named)) } ?? "")")
                .font(.system(size: 13)).foregroundStyle(F.muted)
        }
    }
}

extension Supa {
    func rowsIf(_ c: Bool, _ path: String) async throws -> [[String: Any]] { c ? try await rows(path) : [] }
}
