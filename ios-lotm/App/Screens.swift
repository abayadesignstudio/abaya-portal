import SwiftUI
import WebKit

// Native screens that slide in over the app (Notifications, Search…), and the pieces they share.

private extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255) }
}
enum S {
    static let paper = Color(hex: 0x3b3e2a), card = Color(hex: 0x414530), ink = Color(hex: 0xf1eedd), muted = Color(hex: 0xc3c3a6)
    static let rule = Color(hex: 0x4d4f37), tan = Color(hex: 0x2d301f), soft = Color(hex: 0x454832), unread = Color(hex: 0x424530), blue = Color(hex: 0x2f6fb0)
    static let sub = Color(hex: 0xcdcbb4)
}

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

/// The bar at the top of a sliding screen: Back on the left, the title, an optional button on the right.
struct ScreenBar<Trailing: View>: View {
    let title: String
    var back = "Back"
    @ViewBuilder var trailing: () -> Trailing
    @Environment(\.closeScreen) private var close
    var body: some View {
        ZStack {
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(S.ink)
            HStack {
                Button { close() } label: {
                    HStack(spacing: 3) { Image(systemName: "chevron.left").font(.system(size: 20, weight: .semibold)); Text(back).font(.system(size: 17)) }
                        .foregroundStyle(S.ink).padding(.vertical, 8).contentShape(Rectangle())
                }
                Spacer()
                trailing()
            }
        }
        .padding(.horizontal, 12).frame(height: 48)
        .background(S.tan)
        .overlay(alignment: .bottom) { S.rule.frame(height: 0.5) }
    }
}
extension ScreenBar where Trailing == EmptyView {
    init(title: String, back: String = "Back") { self.init(title: title, back: back, trailing: { EmptyView() }) }
}

/// A row of choices, like the segmented control in Apple's apps but in the club's colours.
struct Chips: View {
    let options: [String]
    @Binding var value: String
    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { o in
                Button { Haptic.tap(); withAnimation(.snappy) { value = o } } label: {
                    Text(o).font(.system(size: 14, weight: value == o ? .semibold : .regular)).foregroundStyle(S.ink)
                        .frame(maxWidth: .infinity).frame(height: 32)
                        .background(RoundedRectangle(cornerRadius: 8).fill(value == o ? S.card : .clear).shadow(color: .black.opacity(value == o ? 0.15 : 0), radius: 2, y: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2).background(RoundedRectangle(cornerRadius: 10).fill(Color.black.opacity(0.12)))
    }
}

// MARK: - Notifications

private struct NItem: Identifiable {
    let id: String, kind: String, title: String, message: String, ref: String?, created: Date, by: String?
    var read: Bool
    var mention: Bool { kind == "mention" || title.range(of: "mention|tagged", options: [.regularExpression, .caseInsensitive]) != nil }
}
private let clubKinds: Set<String> = ["book", "event", "membership_request", "membership_approved", "membership_rejected", "report"]

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
            ScreenBar(title: "Notifications") {
                Button("Read all") { Task { await readAll() } }.font(.system(size: 15, weight: .semibold)).foregroundStyle(S.sub).disabled(!items.contains { !$0.read })
            }
            Chips(options: ["All", "Mentions", "Club"], value: $tab).padding(.horizontal, 20).padding(.vertical, 10)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    let today = shown.filter { Calendar.current.isDateInToday($0.created) }, earlier = shown.filter { !Calendar.current.isDateInToday($0.created) }
                    group("Today", today)
                    group("Earlier", earlier)
                    if loaded && shown.isEmpty { Text("You’re all caught up.").font(.system(size: 16)).foregroundStyle(S.muted).frame(maxWidth: .infinity).padding(.top, 60) }
                    if !loaded { ProgressView().tint(S.muted).frame(maxWidth: .infinity).padding(.top, 60) }
                }
                .padding(.bottom, 40)
            }
            .refreshable { await load() }
        }
        .background(S.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await load() }
    }
    @ViewBuilder private func group(_ label: String, _ list: [NItem]) -> some View {
        if !list.isEmpty {
            Text(label.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.9).foregroundStyle(S.muted).padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 6)
            ForEach(list) { n in row(n) }
        }
    }
    private func badge(_ n: NItem) -> (String, Color) {
        if n.mention { return ("at", Color(red: 0.66, green: 0.53, blue: 0.25)) }
        switch n.kind {
        case "like": return ("heart.fill", Color(red: 0.88, green: 0.54, blue: 0.6))
        case "comment", "reply", "message": return ("bubble.right.fill", S.blue)
        case "book": return ("book.fill", Color(red: 0.18, green: 0.42, blue: 0.27))
        case "event": return ("calendar", Color(red: 0.18, green: 0.42, blue: 0.27))
        default: return ("bell.fill", S.sub)
        }
    }
    private func row(_ n: NItem) -> some View {
        let (icon, tone) = badge(n)
        return Button { Task { await open(n) } } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    if let by = n.by, let p = feed.people[by] { PersonFace(p: p, size: 42) }
                    else { Text("LM").font(.system(size: 15, weight: .semibold, design: .serif)).foregroundStyle(S.paper).frame(width: 42, height: 42).background(Circle().fill(S.ink)) }
                    Image(systemName: icon).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 20, height: 20).background(Circle().fill(tone)).overlay(Circle().stroke(n.read ? S.paper : S.unread, lineWidth: 2)).offset(x: 3, y: 3)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(n.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(S.ink).multilineTextAlignment(.leading)
                    if !n.message.isEmpty { Text(n.message).font(.system(size: 16, design: .serif)).foregroundStyle(S.sub).lineLimit(1) }
                    Text(ago(n.created)).font(.system(size: 12)).foregroundStyle(S.muted)
                }
                Spacer(minLength: 0)
                if !n.read { Circle().fill(S.blue).frame(width: 10, height: 10).padding(.top, 16) }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(n.read ? Color.clear : S.unread)
            .overlay(alignment: .bottom) { S.rule.frame(height: 0.5) }
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
                    Image(systemName: "magnifyingglass").foregroundStyle(S.muted)
                    TextField("Posts, #topics, members, quotes", text: $q).focused($typing).submitLabel(.search)
                        .font(.system(size: 17)).foregroundStyle(S.ink).autocorrectionDisabled()
                    if !q.isEmpty { Button { q = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(S.muted) } }
                }
                .padding(.horizontal, 12).frame(height: 40).background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.14)))
                Button("Cancel") { typing = false; close() }.font(.system(size: 16)).foregroundStyle(S.ink)
            }
            .padding(.horizontal, 12).padding(.vertical, 8).background(S.tan)
            .overlay(alignment: .bottom) { S.rule.frame(height: 0.5) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(["Top", "Posts", "Members", "Commonplace"], id: \.self) { s in
                        Button { Haptic.tap(); scope = s } label: {
                            Text(s).font(.system(size: 14, weight: .semibold)).foregroundStyle(scope == s ? S.paper : S.ink)
                                .padding(.horizontal, 14).frame(height: 32).background(Capsule().fill(scope == s ? S.ink : Color.black.opacity(0.12)))
                        }.buttonStyle(.plain)
                    }
                }.padding(.horizontal, 16).padding(.vertical, 10)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if show("Posts") && !topics.isEmpty {
                        label("Topics")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) { ForEach(topics, id: \.0) { t in
                                Button { q = "#" + t.0 } label: { Text("#\(t.0)  \(t.1)").font(.system(size: 14, weight: .semibold)).foregroundStyle(S.ink).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(S.soft)) }
                            } }.padding(.horizontal, 20)
                        }
                    }
                    if show("Members") && !people.isEmpty {
                        label("Members")
                        ForEach(people, id: \.0) { item in
                            Button { close { web.go("/member/\(item.0)") } } label: {
                                HStack(spacing: 12) { PersonFace(p: item.1, size: 40); Text(item.1.name).font(.system(size: 17, weight: .semibold, design: .serif)).foregroundStyle(S.ink); Spacer() }
                                    .padding(.horizontal, 20).padding(.vertical, 8).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                    if show("Posts") && !posts.isEmpty {
                        label("Posts")
                        ForEach(scope == "Top" ? Array(posts.prefix(6)) : posts) { hitRow($0) }
                    }
                    if show("Posts") && !replies.isEmpty {
                        label("Replies")
                        ForEach(scope == "Top" ? Array(replies.prefix(4)) : replies) { hitRow($0) }
                    }
                    if show("Commonplace") && !notes.isEmpty {
                        label("From your commonplace")
                        ForEach(scope == "Top" ? Array(notes.prefix(3)) : notes) { n in
                            Button { close { web.go("/notebook/\(n.id)") } } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(n.text).font(.system(size: 16, design: .serif)).foregroundStyle(S.ink).lineLimit(3).multilineTextAlignment(.leading)
                                    if !n.book.isEmpty { Text(n.book).font(.system(size: 13, design: .serif).italic()).foregroundStyle(S.muted) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                .background(RoundedRectangle(cornerRadius: 14).fill(S.card)).overlay(RoundedRectangle(cornerRadius: 14).stroke(S.rule))
                                .padding(.horizontal, 16).padding(.bottom, 8)
                            }.buttonStyle(.plain)
                        }
                    }
                    if searched && !q.isEmpty && topics.isEmpty && people.isEmpty && posts.isEmpty && replies.isEmpty && notes.isEmpty {
                        Text("Nothing matches “\(q)”.").font(.system(size: 16)).foregroundStyle(S.muted).frame(maxWidth: .infinity).padding(.top, 50)
                    }
                }
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(S.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { typing = true } }
        .task(id: q) {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            await run()
        }
    }
    private func label(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.9).foregroundStyle(S.muted).padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 6)
    }
    private func hitRow(_ h: Hit) -> some View {
        Button { typing = false; feed.open(h.post, false) } label: {
            HStack(alignment: .top, spacing: 12) {
                PersonFace(p: feed.people[h.userId] ?? Person(name: "", avatar: nil), size: 36)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Text(feed.people[h.userId]?.name ?? "Member").font(.system(size: 15, weight: .semibold)).foregroundStyle(S.ink)
                        Text("· \(ago(h.created))").font(.system(size: 14)).foregroundStyle(S.muted)
                    }
                    if !h.title.isEmpty { Text(h.title).font(.system(size: 17, weight: .semibold, design: .serif)).foregroundStyle(S.ink).lineLimit(2).multilineTextAlignment(.leading) }
                    Text(h.text).font(.system(size: 16, design: .serif)).foregroundStyle(S.sub).lineLimit(3).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.vertical, 12).overlay(alignment: .bottom) { S.rule.frame(height: 0.5) }.contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

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
