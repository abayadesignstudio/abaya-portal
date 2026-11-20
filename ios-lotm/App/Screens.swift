import SwiftUI
import WebKit

// Native screens that slide in over the app (Notifications, Search, Saved posts), in the app's own design.

// MARK: - Sliding screens

/// Closes the screen it is in; `then` runs once it has slid away (to open a web page or switch tab behind it).
struct CloseAction { var run: ((() -> Void)?) -> Void = { _ in }; func callAsFunction(_ then: (() -> Void)? = nil) { run(then) } }
private struct CloseKey: EnvironmentKey { static let defaultValue = CloseAction() }
extension EnvironmentValues { var closeScreen: CloseAction { get { self[CloseKey.self] } set { self[CloseKey.self] = newValue } } }

final class SlideHost: UIHostingController<AnyView> {
    let slide = SlideIn()
    @objc func edge(_ g: UIScreenEdgePanGestureRecognizer) {
        let w = max(view.bounds.width, 1), p = max(0, min(1, g.translation(in: view).x / w))
        switch g.state {
        case .began: slide.interactive = true; view.endEditing(true); dismiss(animated: true)
        case .changed: slide.interactor.update(p)
        case .ended, .cancelled:
            slide.interactor.completionSpeed = 0.9
            if (p > 0.35 || g.velocity(in: view).x > 600) && g.state == .ended { slide.interactor.finish() } else { slide.interactor.cancel() }
            slide.interactive = false
        default: break
        }
    }
}

/// Slides a native screen in from the right, over whatever is showing; swipe from the left edge (or Back) to return.
func presentSlide<V: View>(_ screen: V) {
    let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
    var top = root; while let p = top?.presentedViewController { top = p }
    guard let top else { return }
    let vc = SlideHost(rootView: AnyView(EmptyView()))
    vc.rootView = AnyView(screen.environment(\.closeScreen, CloseAction { [weak vc] then in vc?.dismiss(animated: true) { then?() } }))
    vc.overrideUserInterfaceStyle = .dark
    vc.view.backgroundColor = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
    vc.modalPresentationStyle = .overFullScreen
    vc.transitioningDelegate = vc.slide
    let pan = UIScreenEdgePanGestureRecognizer(target: vc, action: #selector(SlideHost.edge(_:))); pan.edges = .left
    vc.view.addGestureRecognizer(pan)
    top.present(vc, animated: true)
}

// MARK: - Notifications

private struct NItem: Identifiable {
    let id: String, kind: String, title: String, message: String, ref: String?, created: Date, by: String?
    var read: Bool
    var mention: Bool { kind == "mention" || title.range(of: "mention|tagged", options: [.regularExpression, .caseInsensitive]) != nil }
}
private let clubKinds: Set<String> = ["book", "event", "membership_request", "membership_approved", "membership_rejected", "report"]
private let unreadBg = Color(rgb: 0x424530), blue = Color(rgb: 0x2f6fb0)

struct NotificationsScreen: View {
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @Environment(\.closeScreen) private var close
    @State private var items: [NItem] = []
    @State private var loaded = false
    @State private var tab = "All"

    private var shown: [NItem] { items.filter { tab == "All" || (tab == "Mentions" ? $0.mention : clubKinds.contains($0.kind)) } }
    var body: some View {
        VStack(spacing: 0) {
            PageBar(title: "Notifications", onBack: { close() }) {
                Button("Read all") { Task { await readAll() } }.font(.sans(14, .semibold)).foregroundStyle(T.ticker).padding(8)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Seg(options: ["All", "Mentions", "Club"], value: $tab).padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 6)
                    let today = shown.filter { Calendar.current.isDateInToday($0.created) }, earlier = shown.filter { !Calendar.current.isDateInToday($0.created) }
                    group("Today", today)
                    group("Earlier", earlier)
                    if loaded && shown.isEmpty { Text("You're all caught up.").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
                    if !loaded { Text("Loading…").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
                }
                .padding(.bottom, 40)
            }
            .refreshable { await load() }
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await load() }
    }
    @ViewBuilder private func group(_ label: String, _ list: [NItem]) -> some View {
        if !list.isEmpty {
            Eyebrow(t: label).padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 6)
            ForEach(list) { n in row(n) }
        }
    }
    private func badge(_ n: NItem) -> (String, Color, Bool)? {
        if n.mention { return nil }
        switch n.kind {
        case "like": return ("heart", Color(rgb: 0xe08a98), true)
        case "comment", "reply", "message": return ("reply", blue, false)
        case "book": return ("book", Color(rgb: 0x2f6b45), false)
        case "event": return ("calendar", Color(rgb: 0x2f6b45), false)
        default: return nil
        }
    }
    private func row(_ n: NItem) -> some View {
        Button { Task { await open(n) } } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    if let by = n.by, let p = feed.people[by] { Face(p, s: 42) }
                    else { Text("LM").font(.serif(15)).foregroundStyle(T.paper).frame(width: 42, height: 42).background(Circle().fill(T.ink)) }
                    ZStack {
                        Circle().fill(badge(n)?.1 ?? T.sub)
                        if let b = badge(n) { GlyphView(n: b.0, s: 11, w: 3, fill: b.2).foregroundStyle(.white) } else { Text("@").font(.sans(11, .bold)).foregroundStyle(.white) }
                    }
                    .frame(width: 20, height: 20).overlay(Circle().stroke(n.read ? T.paper : unreadBg, lineWidth: 2)).offset(x: 3, y: 3)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(n.title).font(.sans(14, .semibold)).foregroundStyle(T.ink).lineSpacing(2).multilineTextAlignment(.leading)
                    if !n.message.isEmpty { Text(n.message).font(.serif(16)).foregroundStyle(T.sub).lineLimit(1) }
                    Text(ago(n.created)).font(.sans(12)).foregroundStyle(T.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !n.read { Circle().fill(blue).frame(width: 10, height: 10).frame(maxHeight: .infinity) }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(n.read ? Color.clear : unreadBg)
            .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @MainActor private func load() async {
        guard let a = await feed.auth() else { loaded = true; return }
        let rows = (try? await Supa(a: a).rows("/rest/v1/notifications?user_id=eq.\(a.me)&select=id,kind,title,message,reference_id,read_at,created_at,created_by&order=created_at.desc&limit=100")) ?? []
        items = rows.map { r in NItem(id: r["id"] as? String ?? "", kind: r["kind"] as? String ?? "", title: r["title"] as? String ?? "", message: r["message"] as? String ?? "",
                                      ref: r["reference_id"] as? String, created: parseDate(r["created_at"]), by: r["created_by"] as? String, read: r["read_at"] as? String != nil) }
        loaded = true
    }
    @MainActor private func readAll() async {
        Haptic.tap()
        for k in items.indices { items[k].read = true }; feed.unread = 0
        guard let a = await feed.auth() else { return }
        _ = try? await Supa(a: a).req("PATCH", "/rest/v1/notifications?user_id=eq.\(a.me)&read_at=is.null", json: ["read_at": ISO8601DateFormatter().string(from: Date())])
    }
    @MainActor private func open(_ n: NItem) async {
        Haptic.tap()
        guard let a = await feed.auth() else { return }; let db = Supa(a: a)
        if !n.read, let k = items.firstIndex(where: { $0.id == n.id }) {
            items[k].read = true; feed.unread = max(0, feed.unread - 1)
            _ = try? await db.req("PATCH", "/rest/v1/notifications?id=eq.\(n.id)", json: ["read_at": ISO8601DateFormatter().string(from: Date())])
        }
        guard let ref = n.ref else { return }
        if ["comment", "like", "mention", "reply"].contains(n.kind) {
            if let p = try? await db.rows("/rest/v1/asides?id=eq.\(ref)&select=id").first, let id = p["id"] as? String { return feed.open(id, false) }
            if let c = try? await db.rows("/rest/v1/comments?id=eq.\(ref)&select=aside_id").first, let id = c["aside_id"] as? String { return feed.open(id, false) }
        }
        if n.kind == "message" { return close { web.go("/chat/\(ref)") } }
        if n.kind == "book" || n.kind == "event" { return close { web.select(.library) } }
        if n.kind.hasPrefix("membership") || n.kind == "report" { return close { web.select(.settings) } }
    }
}

// MARK: - Search

private struct Hit: Identifiable { let id: String, userId: String, title: String, text: String, created: Date, post: String }
private struct NoteHit: Identifiable { let id: String, text: String, book: String }

struct SearchScreen: View {
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    var start = ""
    @Environment(\.closeScreen) private var close
    @State private var q = ""
    @State private var scope = "Top"
    @State private var topics: [(String, Int)] = []
    @State private var posts: [Hit] = []
    @State private var replies: [Hit] = []
    @State private var notes: [NoteHit] = []
    @State private var searched = false
    @FocusState private var typing: Bool

    private var term: String { q.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "") }
    private var people: [(String, Person)] {
        guard !term.isEmpty, !q.hasPrefix("#") else { return [] }
        return feed.people.filter { $0.value.name.localizedCaseInsensitiveContains(term) }.sorted { $0.value.name < $1.value.name }.map { ($0.key, $0.value) }
    }
    private func show(_ s: String) -> Bool { scope == "Top" || scope == s }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    GlyphView(n: "search", s: 18).foregroundStyle(T.muted)
                    TextField("", text: $q, prompt: Text("Posts, #topics, members, quotes").foregroundColor(T.muted)).focused($typing).submitLabel(.search)
                        .font(.sans(16)).foregroundStyle(T.ink).autocorrectionDisabled().textInputAutocapitalization(.never)
                    if !q.isEmpty { Button { q = "" } label: { Text("×").font(.sans(12)).foregroundStyle(.white).frame(width: 18, height: 18).background(Circle().fill(Color(rgb: 0x5e6043))) } }
                }
                .padding(.horizontal, 12).frame(height: 40).background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x0c0e08, 0.07)))
                Button("Cancel") { typing = false; close() }.font(.sans(15)).foregroundStyle(T.ink)
            }
            .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 10).background(Color(rgb: 0x3a3d2b, 0.96))
            .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(["Top", "Posts", "Members", "Commonplace"], id: \.self) { s in
                                Button { Haptic.tap(); scope = s } label: {
                                    Text(s).font(.sans(14, .semibold)).foregroundStyle(scope == s ? T.paper : T.ink)
                                        .padding(.horizontal, 14).frame(height: 32).background(Capsule().fill(scope == s ? T.ink : Color(rgb: 0x0c0e08, 0.07)))
                                }.buttonStyle(Press())
                            }
                        }.padding(.horizontal, 16).padding(.top, 10)
                    }
                    if show("Posts") && !topics.isEmpty {
                        label("Topics")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) { ForEach(topics, id: \.0) { t in
                                Button { q = "#" + t.0 } label: { Text("#\(t.0)  \(t.1)").font(.sans(14, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(T.soft)) }.buttonStyle(Press())
                            } }.padding(.horizontal, 20)
                        }
                    }
                    if show("Members") && !people.isEmpty {
                        label("Members")
                        ForEach(people, id: \.0) { item in
                            Button { close { web.go("/member/\(item.0)") } } label: {
                                HStack(spacing: 12) { Face(item.1, s: 40); Text(item.1.name).font(.sans(15, .semibold)).foregroundStyle(T.ink); Spacer() }
                                    .padding(.horizontal, 20).padding(.vertical, 8).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                    if show("Posts") && !posts.isEmpty {
                        label("Posts")
                        ForEach(scope == "Top" ? Array(posts.prefix(6)) : posts) { h in HitRow(person: feed.people[h.userId], title: h.title, text: h.text, created: h.created) { typing = false; feed.open(h.post, false) } }
                    }
                    if show("Posts") && !replies.isEmpty {
                        label("Replies")
                        ForEach(scope == "Top" ? Array(replies.prefix(4)) : replies) { h in HitRow(person: feed.people[h.userId], title: "", text: h.text, created: h.created) { typing = false; feed.open(h.post, false) } }
                    }
                    if show("Commonplace") && !notes.isEmpty {
                        label("From your commonplace")
                        ForEach(scope == "Top" ? Array(notes.prefix(3)) : notes) { n in
                            Button { close { openNote(web, id: n.id) } } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(n.text).font(.serif(16)).foregroundStyle(T.ink).lineLimit(3).multilineTextAlignment(.leading)
                                    if !n.book.isEmpty { Text(n.book).font(.serif(14, italic: true)).foregroundStyle(T.muted) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: 14).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule))
                                .padding(.horizontal, 16).padding(.bottom, 8)
                            }.buttonStyle(.plain)
                        }
                    }
                    if searched && !q.isEmpty && topics.isEmpty && people.isEmpty && posts.isEmpty && replies.isEmpty && notes.isEmpty {
                        Text("Nothing matches “\(q)”.").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40)
                    }
                }
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear { if !start.isEmpty && q.isEmpty { q = start } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { typing = true } } }
        .task(id: q) {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            await run()
        }
    }
    private func label(_ t: String) -> some View { Eyebrow(t: t).padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 6) }
    @MainActor private func run() async {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { topics = []; posts = []; replies = []; notes = []; searched = false; return }
        guard let a = await feed.auth() else { return }; let db = Supa(a: a)
        let clean = t.replacingOccurrences(of: "#", with: "").replacingOccurrences(of: #"[%,()*]"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let enc = clean.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        guard !enc.isEmpty else { return }
        let tagRows = (try? await db.rows("/rest/v1/aside_tags?tag=ilike.*\(enc)*&select=aside_id,tag")) ?? []
        var counts: [String: Int] = [:]; for r in tagRows { if let g = r["tag"] as? String { counts[g, default: 0] += 1 } }
        let tps = counts.sorted { $0.value > $1.value }.prefix(8).map { ($0.key, $0.value) }
        var ids: [String] = []
        var rs: [Hit] = []
        if t.hasPrefix("#") {
            ids = tagRows.filter { ($0["tag"] as? String)?.lowercased() == clean.lowercased() }.compactMap { $0["aside_id"] as? String }
        } else {
            ids = ((try? await db.rows("/rest/v1/asides?or=(title.ilike.*\(enc)*,body.ilike.*\(enc)*,subtitle.ilike.*\(enc)*)&select=id&limit=40")) ?? []).compactMap { $0["id"] as? String }
            let cr = (try? await db.rows("/rest/v1/comments?body=ilike.*\(enc)*&select=id,aside_id,user_id,body,created_at&order=created_at.desc&limit=20")) ?? []
            rs = cr.map { Hit(id: $0["id"] as? String ?? "", userId: $0["user_id"] as? String ?? "", title: "", text: $0["body"] as? String ?? "", created: parseDate($0["created_at"]), post: $0["aside_id"] as? String ?? "") }
        }
        var ps: [Hit] = []
        if !ids.isEmpty {
            let pr = (try? await db.rows("/rest/v1/asides?id=in.(\(ids.joined(separator: ",")))&or=(visibility.eq.public,visibility.is.null)&select=id,user_id,title,body,created_at&order=created_at.desc")) ?? []
            ps = pr.map { Hit(id: $0["id"] as? String ?? "", userId: $0["user_id"] as? String ?? "", title: $0["title"] as? String ?? "", text: $0["body"] as? String ?? "", created: parseDate($0["created_at"]), post: $0["id"] as? String ?? "") }
            ps = ps.map { var h = $0; if !h.title.isEmpty && h.text.lowercased().hasPrefix(h.title.lowercased().prefix(20)) { h = Hit(id: h.id, userId: h.userId, title: "", text: h.text, created: h.created, post: h.post) }; return h }
        }
        let nr = (try? await db.rows("/rest/v1/private_notes?user_id=eq.\(a.me)&or=(quotation.ilike.*\(enc)*,body.ilike.*\(enc)*,title.ilike.*\(enc)*,book_title.ilike.*\(enc)*)&select=id,quotation,body,title,book_title&order=created_at.desc&limit=30")) ?? []
        let ns = nr.map { r -> NoteHit in
            let quote = (r["quotation"] as? String).flatMap { $0.isEmpty ? nil : "“\($0)”" }
            let text = quote ?? (r["body"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (r["title"] as? String ?? "")
            return NoteHit(id: r["id"] as? String ?? "", text: text, book: r["book_title"] as? String ?? "")
        }
        guard t == q.trimmingCharacters(in: .whitespaces) else { return }   // a newer search is under way
        topics = tps; posts = ps; replies = rs; notes = ns; searched = true
    }
}
