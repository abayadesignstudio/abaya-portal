import SwiftUI
import WebKit

// The native Feed and tab bar, drawn to the app's own design (its stylesheet, fonts and icons): the masthead, the
// story pills with their turning rings, the cards that drop from the top, the post cards and their pills, and the dock.
// Screens not yet native are the web app, shown in place; the web tells the app which screen it is on.

enum Tab: String { case feed, library, people, settings
    var route: String { switch self { case .feed, .settings: "/native"; case .library: "/reading"; case .people: "/people" } }
}

// MARK: - Shell

struct Shell: View {
    @ObservedObject var web: WebModel
    @StateObject private var feed = FeedModel()
    /// The web's own tab screens; anything else it shows (a profile, the devotion, a web form) is a page over the app.
    private static let webTabs: Set<String> = ["/native", "/reading", "/people", "/settings", "/notebook/index", "/chat", "/loading", ""]
    private var path: String { String(web.route.split(separator: "?", maxSplits: 1).first ?? "") }
    private var overlay: Bool { !Self.webTabs.contains(path) && !path.hasPrefix("/post/") }
    private var showWeb: Bool { web.tab == .library || web.tab == .people || overlay }

    var body: some View {
        ZStack(alignment: .bottom) {
            T.paper.ignoresSafeArea()
            FeedScreen(m: feed, web: web).opacity(web.tab == .feed ? 1 : 0).allowsHitTesting(web.tab == .feed && !overlay)
            if web.tab == .settings { SettingsScreen(feed: feed, web: web).allowsHitTesting(!overlay).transition(.opacity) }
            WebView(model: web).ignoresSafeArea()
                .opacity(showWeb ? 1 : 0).allowsHitTesting(showWeb)
            if !overlay { Dock(web: web, feed: feed).transition(.opacity) }
            if let it = feed.detail { DropCard(it: it, m: feed, web: web).zIndex(5) }
        }
        .animation(.easeOut(duration: 0.18), value: showWeb)
        .animation(.easeOut(duration: 0.18), value: overlay)
        .onAppear { feed.web = web.view; feed.open = { id, reply in web.openPost(id, people: feed.people, reply: reply) } }
        // Back from a web page (an edit, a profile) to the Feed: catch up quietly.
        .onChange(of: path) { old, new in if new == "/native" && old != "/native" { Task { await feed.load(quiet: true) } } }
    }
}

/// .dock — the floating bar: Feed, Library, the write button, Directory, Settings.
private struct Dock: View {
    @ObservedObject var web: WebModel
    @ObservedObject var feed: FeedModel
    var body: some View {
        HStack(spacing: 0) {
            item(.feed, "feed", "Feed")
            item(.library, "reading", "Library")
            Button {
                Haptic.tap()
                web.composer.present(name: feed.myName, avatar: feed.myAvatar)
            } label: {
                GlyphView(n: "pencil", s: 22).foregroundStyle(T.paper)
                    .frame(width: 44, height: 44).background(Circle().fill(T.ink)).shadow(color: Color(rgb: 0x0c0e08, 0.3), radius: 6, y: 4)
                    .frame(width: 60, height: 52)
            }
            .buttonStyle(Press(scale: 0.92)).frame(maxWidth: .infinity)
            .accessibilityLabel("Write a post")
            item(.people, "members", "Directory")
            item(.settings, "settings", "Settings")
        }
        .padding(.horizontal, 8)
        .frame(width: min(362, UIScreen.main.bounds.width - 28), height: 68)
        .background(.ultraThinMaterial.opacity(0.9), in: Capsule())
        .background(Capsule().fill(Color(rgb: 0x454934, 0.8)))
        .overlay(Capsule().stroke(.white.opacity(0.16), lineWidth: 1))
        .overlay(Capsule().inset(by: 1).stroke(LinearGradient(colors: [.white.opacity(0.12), .clear], startPoint: .top, endPoint: .center), lineWidth: 1))
        .shadow(color: Color(rgb: 0x0c0e08, 0.18), radius: 15, y: 10)
        .padding(.bottom, 2)
        .environment(\.colorScheme, .dark)
    }
    private func item(_ t: Tab, _ icon: String, _ label: String) -> some View {
        let on = web.tab == t
        return Button {
            Haptic.tap()
            if on && t == .feed { feed.scrollTop += 1; return }
            web.select(t)
        } label: {
            GlyphView(n: icon, s: 28).foregroundStyle(on ? T.ink : T.muted)
                .frame(width: 60, height: 52).background(Capsule().fill(on ? Color(rgb: 0x0c0e08, 0.09) : .clear))
        }
        .buttonStyle(Press(scale: 0.92)).frame(maxWidth: .infinity)
        .accessibilityLabel(label)
        .animation(.easeOut(duration: 0.2), value: on)
    }
}

// MARK: - Masthead

/// The title: LIFE of the MIND, in Garamond small capitals, "of the" stacked between.
struct Wordmark: View {
    var size: CGFloat = 40
    var body: some View {
        HStack(alignment: .top, spacing: size * 0.15) {
            Text("Life")
            VStack(spacing: -size * 0.06) { Text("of"); Text("the") }
                .font(.serif(size * 0.35, .semibold).smallCaps()).tracking(size * 0.35 * 0.06).padding(.top, size * 0.275)
            Text("Mind")
        }
        .font(.serif(size, .semibold).smallCaps()).tracking(size * 0.02)
        .lineLimit(1).minimumScaleFactor(0.7)
        .foregroundStyle(T.cream)
    }
}

/// .mast — search, the title, and the bell with its count, on the tan-to-olive gradient.
struct Mast: View {
    let unread: Int
    let search: () -> Void, bell: () -> Void, title: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            ibtn("search", search)
            Wordmark().frame(maxWidth: .infinity).contentShape(Rectangle()).onTapGesture(perform: title)
            ibtn("bell", bell)
                .overlay(alignment: .topTrailing) {
                    if unread > 0 {
                        Text(unread > 9 ? "9+" : "\(unread)").font(.sans(10, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 4).frame(minWidth: 16, minHeight: 16).background(Capsule().fill(T.like)).offset(x: 4, y: -3)
                    }
                }
                .offset(x: -4)
        }
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 12)
        .background(LinearGradient(stops: [.init(color: T.tan, location: 0), .init(color: T.tan, location: 0.3), .init(color: T.paper, location: 1)], startPoint: .top, endPoint: .bottom).ignoresSafeArea(edges: .top))
    }
    private func ibtn(_ icon: String, _ run: @escaping () -> Void) -> some View {
        Button { Haptic.tap(); run() } label: {
            GlyphView(n: icon, s: 18).foregroundStyle(T.cream).frame(width: 36, height: 36).background(Circle().fill(Color(rgb: 0xf3eddf, 0.14)))
        }
        .buttonStyle(Press())
    }
}

// MARK: - Feed

struct FeedScreen: View {
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    @State private var acting: FPost?
    @State private var reporting: FPost?
    @State private var reason = ""
    @State private var deleting: FPost?

    var body: some View {
        VStack(spacing: 0) {
            Mast(unread: m.unread,
                 search: { presentSlide(SearchScreen(feed: m, web: web)) },
                 bell: { presentSlide(NotificationsScreen(feed: m, web: web)) },
                 title: { m.scrollTop += 1 })
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        Color.clear.frame(height: 0).id("top")
                        if !m.pins.isEmpty { StoryRow(m: m, web: web) }
                        if !m.loaded {
                            Text("Loading…").font(.sans(15)).foregroundStyle(T.muted).padding(40)
                        } else if let f = m.failed, m.posts.isEmpty {
                            Text(f).font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(40)
                        } else if m.posts.isEmpty {
                            Text("Nothing here yet.").font(.serif(17)).foregroundStyle(T.muted).padding(40)
                        }
                        ForEach(Array(m.posts.enumerated()), id: \.element.id) { k, p in
                            PostCard(p: p, m: m, web: web, more: { acting = p })
                                .padding(.top, k == 0 ? 10 : 0)
                        }
                        Color.clear.frame(height: 110)
                    }
                }
                .refreshable { await m.load() }
                .onChange(of: m.scrollTop) { _, _ in withAnimation(.snappy) { proxy.scrollTo("top", anchor: .top) } }
            }
        }
        .background(T.paper.ignoresSafeArea())
        .task { await m.load() }
        .sheet(item: $acting) { p in
            PostActions(p: p, m: m, web: web, close: { acting = nil }, report: { acting = nil; reporting = p; reason = "" }, delete: { acting = nil; deleting = p })
                .presentationDetents([.medium, .large])
        }
        .alert("What is wrong with this post?", isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } })) {
            TextField("Sent to the administrators", text: $reason)
            Button("Cancel", role: .cancel) {}
            Button("Report") { if let p = reporting { Task { await m.report(p, reason) } } }
        }
        .confirmationDialog("Delete this post? This cannot be undone.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let p = deleting { Task { await m.delete(p) } } }
        }
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .preferredColorScheme(.dark)
    }
}

// MARK: - Story pills ("Coming up and pinned")

private let seenKey = "lotm.seen2"
private func dayLine(_ d: Date?) -> String {
    guard let d else { return "" }
    return "\(d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) · \(d.formatted(date: .omitted, time: .shortened).replacingOccurrences(of: ":00", with: ""))"
}

private struct StoryRow: View {
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    @State private var seen: Set<String> = Set(UserDefaults.standard.stringArray(forKey: seenKey) ?? [])
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(m.pins) { it in
                    Button {
                        Haptic.tap()
                        seen.insert(it.id); UserDefaults.standard.set(Array(seen.suffix(300)), forKey: seenKey)
                        if it.kind == .read, let s = it.slug { web.go("/read/\(s)") } else { m.detail = it }
                    } label: { StoryPill(it: it, m: m, fresh: !seen.contains(it.id)) }
                    .buttonStyle(Press())
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.04), .init(color: .black, location: 0.92), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
        .padding(.vertical, 1)
        .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
    }
}

private struct StoryPill: View {
    let it: FPin
    @ObservedObject var m: FeedModel
    let fresh: Bool
    private var ring: [Color] {
        switch it.kind {
        case .read: [Color(rgb: 0xb3203a), Color(rgb: 0xf2c46b), Color(rgb: 0x6b2a35), Color(rgb: 0xb3203a)]
        case .pin: [Color(rgb: 0xe08a98), Color(rgb: 0xd9b26a), Color(rgb: 0xa7b36e), Color(rgb: 0xe08a98)]
        default: [Color(rgb: 0xd9b26a), Color(rgb: 0xf1eedd), Color(rgb: 0xa7b36e), Color(rgb: 0xd9b26a)]
        }
    }
    private var caption: String {
        switch it.kind { case .read: it.title; case .study: it.title.isEmpty ? "Next study" : it.title; case .event: it.text; case .pin: m.people[it.by ?? ""]?.name.split(separator: " ").first.map(String.init) ?? "Pinned" }
    }
    private var line2: String {
        switch it.kind {
        case .read: Date().formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        case .study: ["Next study", dayLine(it.when)].filter { !$0.isEmpty }.joined(separator: " · ")
        case .event: [dayLine(it.when), it.place?.components(separatedBy: ",").first ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        case .pin: it.text
        }
    }
    var body: some View {
        HStack(spacing: 10) {
            face.frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(caption).font(.serif(16, .semibold)).foregroundStyle(T.ink).lineLimit(1)
                Text(line2).font(.sans(12)).foregroundStyle(T.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 4).padding(.trailing, 14).padding(.vertical, 4)
        .background(Capsule().fill(T.card))
        .padding(2)
        .frame(width: 236)
        .background {
            if fresh {
                // A new item wears a slowly turning ring and a soft breathing glow until it has been opened.
                TimelineView(.animation) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate
                    let turn = Angle.degrees((t.truncatingRemainder(dividingBy: 6)) / 6 * 360), breathe = 0.35 + 0.55 * (0.5 + 0.5 * sin(t / 2.8 * .pi))
                    ZStack {
                        Capsule().fill(AngularGradient(colors: ring, center: .center, angle: turn)).padding(-3).blur(radius: 6).opacity(breathe)
                        Capsule().fill(AngularGradient(colors: ring, center: .center, angle: turn))
                    }
                }
            } else { Capsule().fill(T.rule) }
        }
    }
    @ViewBuilder private var face: some View {
        switch it.kind {
        case .pin: Face(m.people[it.by ?? ""], s: 48)
        case .read: Image("advent-story").resizable().scaledToFill().frame(width: 48, height: 48).clipShape(Circle())
        case .event where it.link != nil: LinkFace(url: it.link!, when: it.when)
        case .study where it.cover != nil:
            AsyncImage(url: it.cover) { $0.resizable().scaledToFill() } placeholder: { T.card }.frame(width: 48, height: 48).clipShape(Circle())
        default: DateBubble(when: it.when, study: it.kind == .study)
        }
    }
}

private struct DateBubble: View {
    let when: Date?, study: Bool
    var body: some View {
        VStack(spacing: 1) {
            Text(when.map { $0.formatted(.dateTime.weekday(.abbreviated)).uppercased() } ?? "").font(.sans(9, .bold)).tracking(0.5).foregroundStyle(study ? Color(rgb: 0xd9b26a) : T.muted)
            Text(when.map { $0.formatted(.dateTime.day()) } ?? "•").font(.serif(19, .semibold)).foregroundStyle(T.ink)
        }
        .frame(width: 48, height: 48).background(Circle().fill(study ? T.tan : T.card))
    }
}

/// An event's face: its link's picture, or the date.
private struct LinkFace: View {
    let url: URL, when: Date?
    @State private var image: URL?
    var body: some View {
        ZStack {
            if let image { AsyncImage(url: image) { $0.resizable().scaledToFill() } placeholder: { T.card }.frame(width: 48, height: 48).clipShape(Circle()) }
            else { DateBubble(when: when, study: false) }
        }
        .task { image = await LinkMeta.get(url)?.image }
    }
}

// MARK: - The card that drops from the top (study, event, pin)

private func band(_ x: CGFloat) -> CGFloat { (1 - 1 / (x * 0.55 / 220 + 1)) * 220 }   // pulled down, it stretches like a rubber band

private struct DropCard: View {
    let it: FPin
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    @State private var dy: CGFloat = 0
    @State private var shown = false
    @State private var rsvps: [String: String] = [:]
    @State private var hero: URL?

    private var kicker: String { it.kind == .study ? "Next study" : it.kind == .event ? "Coming up" : "Pinned" }
    private func close() { withAnimation(.easeIn(duration: 0.24)) { shown = false }; DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { m.detail = nil } }

    var body: some View {
        ZStack(alignment: .top) {
            Color(rgb: 0x0a0c06, 0.5).ignoresSafeArea().opacity(shown ? 1 : 0).onTapGesture(perform: close)
            VStack(spacing: 0) {
                HStack {
                    Text(kicker.uppercased()).font(.sans(11.5, .bold)).tracking(1.15).foregroundStyle(T.muted)
                    Spacer()
                    Button(action: close) { Text("✕").font(.sans(15)).foregroundStyle(T.ink).frame(width: 34, height: 34).background(Circle().fill(Color(rgb: 0x0c0e08, 0.12))) }
                }
                .padding(.leading, 20).padding(.trailing, 10).padding(.top, 4)
                ScrollView {
                    content.padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 14)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: UIScreen.main.bounds.height * 0.6)
                Capsule().fill(Color(rgb: 0xf1eedd, 0.3)).frame(width: 40, height: 5).frame(maxWidth: .infinity).padding(.top, 10).padding(.bottom, 16).contentShape(Rectangle())
            }
            .padding(.top, safeTop + 6)
            // the card reaches up past the top of the screen, so pulling it down never shows a gap above it
            .background(alignment: .bottom) { UnevenRoundedRectangle(bottomLeadingRadius: 26, bottomTrailingRadius: 26).fill(T.card).padding(.top, -400) }
            .shadow(color: .black.opacity(0.45), radius: 22, y: 18)
            .frame(maxWidth: 640)
            .offset(y: shown ? dy : -UIScreen.main.bounds.height * 0.8)
            .gesture(DragGesture(minimumDistance: 4).onChanged { g in
                let raw = g.translation.height
                dy = raw < 0 ? raw : band(raw)                 // up follows the finger; down stretches
            }.onEnded { g in
                if g.translation.height < -60 || g.predictedEndTranslation.height < -160 { close() }
                else { withAnimation(.spring(response: 0.45, dampingFraction: 0.62)) { dy = 0 } }
            })
        }
        .onAppear { withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { shown = true } }
        .task { await loadRsvps(); if it.kind == .event, let l = it.link { hero = await LinkMeta.get(l)?.image } }
    }
    private var safeTop: CGFloat { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.top }.first ?? 47 }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let hero { AsyncImage(url: hero) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x2a2d1d) }.frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 14)) }
            HStack(alignment: .top, spacing: 14) {
                if it.kind == .study {
                    AsyncImage(url: it.cover) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x9c5463) }.frame(width: 70, height: 105).clipShape(RoundedRectangle(cornerRadius: 4)).shadow(color: .black.opacity(0.3), radius: 5, y: 4)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(it.kind == .pin ? (m.people[it.by ?? ""]?.name ?? "A member") : it.title).font(.serif(24, .semibold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true)
                    if let a = it.author { Text("by \(a)").font(.serif(16, italic: true)).foregroundStyle(T.muted) }
                }
            }
            if it.when != nil || it.place != nil {
                HStack(spacing: 12) {
                    if let d = it.when {
                        VStack(spacing: 0) {
                            Text(d.formatted(.dateTime.month(.abbreviated)).uppercased()).font(.sans(10, .bold)).foregroundStyle(T.cream).frame(maxWidth: .infinity).padding(.vertical, 3).background(T.tan)
                            Text(d.formatted(.dateTime.day())).font(.serif(22, .semibold)).foregroundStyle(T.ink).padding(.top, 2).padding(.bottom, 4)
                        }
                        .frame(width: 50).background(T.paper).clipShape(RoundedRectangle(cornerRadius: 11)).overlay(RoundedRectangle(cornerRadius: 11).stroke(T.rule))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        if let d = it.when { Text("\(d.formatted(.dateTime.weekday(.wide).month(.wide).day())) · \(d.formatted(date: .omitted, time: .shortened))").font(.sans(15, .semibold)).foregroundStyle(T.ink) }
                        if let p = it.place {
                            Button { openInApp(it.placeURL ?? URL(string: "https://maps.apple.com/?q=" + (p.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""))!) } label: {
                                Text("\(p) ↗").font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.leading)
                            }
                        }
                    }
                }
            }
            if let d = (it.kind == .pin ? Optional(it.text) : it.detail), !d.isEmpty {
                Text(linked(d)).font(.serif(17)).foregroundStyle(T.ink).lineSpacing(3).textSelection(.enabled)
            }
            if it.rsvp { rsvpRow }
            FlowButtons(items: buttons)
        }
    }
    private var buttons: [(String, () -> Void)] {
        var b: [(String, () -> Void)] = []
        if let w = it.when, w > Date(), it.kind != .pin { b.append(("Add to calendar", { addToCalendar(w) })) }
        if let l = it.link { b.append(("Details ↗", { openInApp(l) })) }
        if let s = it.sourcePost { b.append(("Open the post", { close(); m.open(s, false) })) }
        return b
    }
    private func addToCalendar(_ w: Date) {
        let f = ISO8601DateFormatter()
        var c = URLComponents(string: "https://lotmstudy.org/ics")!
        c.queryItems = [URLQueryItem(name: "title", value: it.kind == .study ? "Life of the Mind — \(it.title)" : it.title), URLQueryItem(name: "start", value: f.string(from: w)),
                        URLQueryItem(name: "end", value: f.string(from: w.addingTimeInterval(7200))), URLQueryItem(name: "uid", value: "\(it.rsvpType)-\(it.id)")]
            + (it.place.map { [URLQueryItem(name: "location", value: $0)] } ?? [])
        if let u = c.url { UIApplication.shared.open(u) }
    }
    private var rsvpRow: some View {
        let going = rsvps.filter { $0.value == "yes" }.map(\.key), maybe = rsvps.filter { $0.value == "maybe" }.count, no = rsvps.filter { $0.value == "no" }.count
        let mine = rsvps[m.me]
        return HStack(spacing: 8) {
            HStack(spacing: -7) { ForEach(going.prefix(3), id: \.self) { Face(m.people[$0], s: 22).overlay(Circle().stroke(T.card, lineWidth: 2)) } }
            Text([going.isEmpty ? "No one yet" : "\(going.count) going", maybe > 0 ? "\(maybe) maybe" : nil, no > 0 ? "\(no) can’t" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.sans(13)).foregroundStyle(T.muted).frame(maxWidth: .infinity, alignment: .leading)
            ForEach([("yes", "thumbup", Color(rgb: 0x2f6b45)), ("maybe", "question", Color(rgb: 0xa8863f)), ("no", "thumbdown", Color(rgb: 0x8f4a4f))], id: \.0) { v, icon, tone in
                Button { Task { await set(v) } } label: {
                    GlyphView(n: icon, s: 21, w: 1.9).foregroundStyle(mine == v ? .white : T.ink)
                        .frame(width: 40, height: 40).background(Circle().fill(mine == v ? tone : .clear)).overlay(Circle().stroke(mine == v ? .clear : T.softBd))
                }.buttonStyle(Press())
            }
        }
        .padding(.top, 14).overlay(alignment: .top) { T.rule.frame(height: 1) }
    }
    @MainActor private func loadRsvps() async {
        guard it.rsvp, let a = await m.auth() else { return }
        let rows = (try? await Supa(a: a).rows("/rest/v1/rsvps?target_type=eq.\(it.rsvpType)&target_id=eq.\(it.id)&select=user_id,going,maybe")) ?? []
        var out: [String: String] = [:]
        for r in rows { if let u = r["user_id"] as? String { out[u] = (r["going"] as? Bool ?? false) ? "yes" : (r["maybe"] as? Bool ?? false) ? "maybe" : "no" } }
        rsvps = out
    }
    @MainActor private func set(_ v: String) async {
        Haptic.tap(); rsvps[m.me] = v
        guard let a = await m.auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/rsvps?on_conflict=target_type,target_id,user_id",
                                      json: ["target_type": it.rsvpType, "target_id": it.id, "user_id": a.me, "going": v == "yes", "maybe": v == "maybe", "updated_at": ISO8601DateFormatter().string(from: Date())],
                                      prefer: "resolution=merge-duplicates")
        await loadRsvps()
    }
}

/// Pills that wrap onto a second line when they don't fit (the card's buttons).
private struct FlowButtons: View {
    let items: [(String, () -> Void)]
    var body: some View {
        if !items.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, b in
                    Button(action: b.1) { Text(b.0) }.buttonStyle(PillStyle())
                }
            }
        }
    }
}

// MARK: - A post in the Feed (.postcard)

private struct PostCard: View {
    let p: FPost
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    let more: () -> Void
    @State private var open = false
    private let z = T.z
    private var person: Person? { m.people[p.userId] }
    private var kindLine: String {
        if let s = p.publishAt { return "Scheduled · posts \(s.formatted(.dateTime.weekday(.abbreviated).hour().minute()))" }
        return "\(p.kind) · \(ago(p.created))\(p.edited ? " · Edited" : "")"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Button { web.go("/member/\(p.userId)") } label: { Face(person, s: 36 * z) }.buttonStyle(.plain)
                (Text(person?.name ?? "Member").font(.sans(14 * z, .semibold)).foregroundColor(T.ink) + Text(" · \(kindLine)").font(.sans(14 * z)).foregroundColor(T.muted))
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button(action: more) { Text("···").font(.sans(15 * z, .bold)).tracking(1).foregroundStyle(T.muted).padding(.horizontal, 2).frame(height: 28) }.buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 0) {
                if p.article { article } else { note }
                actions.padding(.top, 10 * z)
            }
            .padding(.top, 6 * z)
        }
        .padding(.horizontal, 16 * z).padding(.vertical, 14 * z)
        .background(RoundedRectangle(cornerRadius: 20).fill(T.card))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(T.rule))
        .shadow(color: Color(rgb: 0x0c0e08, open ? 0.28 : 0.14), radius: open ? 11 : 5, y: open ? 6 : 2)
        .padding(.horizontal, 10).padding(.bottom, 10)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { open.toggle() } }
    }

    @ViewBuilder private var note: some View {
        if p.showTitle {
            Text(p.title).font(.serif(21 * z, .bold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 9).overlay(alignment: .bottom) { T.rule.frame(height: 1) }.padding(.vertical, 8)
        }
        if !p.body.isEmpty && !(p.audio && p.body.trimmingCharacters(in: .whitespaces) == "Voice note") {
            Text(linked(p.body)).font(.serif(18 * z)).foregroundStyle(T.ink).lineSpacing(18 * z * 0.4 - 6)
                .lineLimit(open ? nil : 6).fixedSize(horizontal: false, vertical: true)
        }
        if p.audio { Button { m.open(p.id, false) } label: { Label("Voice note", systemImage: "play.fill") }.buttonStyle(PillStyle()).padding(.top, 10) }
        PhotoRow(urls: p.photos).padding(.top, p.photos.isEmpty ? 0 : 10)
        if let b = p.book { BookCard(b: b).padding(.top, 8) }
        if let q = p.quoteId { QuoteEmbed(userId: p.quoteUser ?? "", text: p.quoteText ?? "", m: m).onTapGesture { m.open(q, false) }.padding(.top, 8) }
        if let poll = p.poll { PollView(poll: poll, me: m.me) { i in Task { await m.vote(p, i) } }.padding(.top, 10) }
        if let l = p.link { LinkCard(url: l).padding(.top, 10) }
        if !p.tags.isEmpty {
            HStack(spacing: 8) { ForEach(p.tags, id: \.self) { t in Button("#\(t)") { presentSlide(SearchScreen(feed: m, web: web, start: "#" + t)) }.font(.sans(13)).foregroundStyle(T.ticker) } }.padding(.top, 6)
        }
        if p.continuations > 0 && !open {
            Button { m.open(p.id, false) } label: { Text("Show this thread").font(.sans(14)).foregroundStyle(T.muted) }.buttonStyle(.plain).padding(.top, 6)
        }
        if open && (p.replies > 0 || p.continuations > 0) {
            Button { m.open(p.id, false) } label: { Text(p.continuations > 0 ? "Open the thread" : "Read \(p.replies) \(p.replies == 1 ? "reply" : "replies")").font(.sans(14, .semibold)).foregroundStyle(T.sub) }.buttonStyle(.plain).padding(.top, 8)
        }
    }

    @ViewBuilder private var article: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let t = p.thumb { AsyncImage(url: t) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x626546) }.frame(height: 140).clipped() }
            else { Color(rgb: 0x626546).frame(height: 96) }
            VStack(alignment: .leading, spacing: 3) {
                Text(p.title).font(.serif(18 * z, .semibold)).foregroundStyle(T.ink)
                if !(p.subtitle.isEmpty && p.body.isEmpty) { Text(p.subtitle.isEmpty ? p.body : p.subtitle).font(.serif(14 * z)).foregroundStyle(T.sub).lineLimit(2) }
                Text("\(max(1, Int((Double(p.body.split(whereSeparator: \.isWhitespace).count) / 230).rounded()))) min read").font(.sans(12 * z)).foregroundStyle(T.muted).padding(.top, 3)
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T.paper).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule))
        .padding(.top, 8)
        .onTapGesture { m.open(p.id, false) }
    }

    private var actions: some View {
        HStack(spacing: 6) {
            Button { m.open(p.id, true) } label: { HStack(spacing: 5) { GlyphView(n: "reply", s: 20); if p.replies > 0 { Text("\(p.replies)") } } }
                .buttonStyle(PillStyle()).disabled(!p.canReply).opacity(p.canReply ? 1 : 0.45)
            Button { Task { await m.like(p) } } label: {
                HStack(spacing: 5) { GlyphView(n: "heart", s: 20, fill: p.liked).symbolPop(p.liked); if p.likes > 0 { Text("\(p.likes)") } }
            }
            .buttonStyle(PillStyle(liked: p.liked))
            Button { Task { await m.save(p) } } label: { GlyphView(n: "bookmark", s: 20, fill: p.saved).symbolPop(p.saved) }.buttonStyle(PillStyle())
            Button(action: more) { GlyphView(n: "share", s: 20) }.buttonStyle(PillStyle())
        }
    }
}

/// The heart and bookmark pop when they turn on (the app's like-pop), with a fading ring.
private struct Pop: ViewModifier {
    let on: Bool
    @State private var k = 0
    func body(content: Content) -> some View {
        content
            .keyframeAnimator(initialValue: 1.0, trigger: k) { v, s in v.scaleEffect(s) } keyframes: { _ in
                SpringKeyframe(1.35, duration: 0.18); SpringKeyframe(0.92, duration: 0.14); SpringKeyframe(1.0, duration: 0.18)
            }
            .overlay {
                Circle().stroke(T.like, lineWidth: 2).padding(-6)
                    .keyframeAnimator(initialValue: 0.0, trigger: k) { v, o in v.opacity(o).scaleEffect(0.6 + (1 - o) * 0.8) } keyframes: { _ in
                        LinearKeyframe(0.9, duration: 0.01); LinearKeyframe(0, duration: 0.5)
                    }
                    .opacity(k == 0 ? 0 : 1)
            }
            .onChange(of: on) { _, now in if now { k += 1 } }
    }
}
extension View { func symbolPop(_ on: Bool) -> some View { modifier(Pop(on: on)) } }

// MARK: - Pieces inside a post

/// One photo full width; several in a sideways row. Tap for the full-screen view.
struct PhotoRow: View {
    let urls: [URL]
    @State private var openAt: Int?
    var body: some View {
        ZStack {
            if urls.count == 1 {
                AsyncImage(url: urls[0]) { $0.resizable().scaledToFit() } placeholder: { Color(rgb: 0x2a2d1d).frame(height: 240) }
                    .frame(maxWidth: .infinity, maxHeight: 560).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
                    .onTapGesture { openAt = 0 }
            } else if urls.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(urls.enumerated()), id: \.offset) { i, u in
                            AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x2a2d1d) }
                                .frame(width: 240, height: 300).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
                                .onTapGesture { openAt = i }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .padding(.trailing, -16)
            }
        }
        .fullScreenCover(item: Binding(get: { openAt.map { IntBox(v: $0) } }, set: { openAt = $0?.v })) { b in Lightbox(urls: urls, start: b.v) }
    }
}
private struct IntBox: Identifiable { let v: Int; var id: Int { v } }

/// Full-screen photos: swipe sideways for the next, swipe down or ✕ to close.
private struct Lightbox: View {
    let urls: [URL], start: Int
    @State private var i = 0
    @State private var drop: CGFloat = 0
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(Double(1 - min(CGFloat(0.6), abs(drop) / CGFloat(600)))).ignoresSafeArea()
            TabView(selection: $i) {
                ForEach(Array(urls.enumerated()), id: \.offset) { k, u in
                    AsyncImage(url: u) { $0.resizable().scaledToFit() } placeholder: { ProgressView().tint(.white) }.tag(k)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: urls.count > 1 ? .automatic : .never))
            .offset(y: drop)
            .gesture(DragGesture().onChanged { drop = max(0, $0.translation.height) }.onEnded { g in if g.translation.height > 120 { dismiss() } else { withAnimation(.spring) { drop = 0 } } })
            Button { dismiss() } label: { Text("✕").font(.sans(17)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.white.opacity(0.15))) }.padding(16)
        }
        .onAppear { i = start }
        .statusBarHidden()
    }
}

private struct BookCard: View {
    let b: FBook
    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: b.cover) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0xc9c7af) }.frame(width: 28, height: 40).clipShape(RoundedRectangle(cornerRadius: 3))
            VStack(alignment: .leading, spacing: 1) {
                Text(b.title).font(.serif(14, italic: true)).foregroundStyle(T.ink)
                if let a = b.author { Text(a).font(.sans(12)).foregroundStyle(T.muted) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
    }
}

private struct QuoteEmbed: View {
    let userId: String, text: String
    @ObservedObject var m: FeedModel
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) { Face(m.people[userId], s: 20); Text(m.people[userId]?.name ?? "").font(.sans(14, .semibold)).foregroundStyle(T.ink) }
            Text(text).font(.serif(16)).foregroundStyle(T.ink).lineLimit(3).multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border))
    }
}

private struct PollView: View {
    let poll: FPoll, me: String
    let vote: (Int) -> Void
    var body: some View {
        let mine = poll.votes[me], closed = poll.closes.map { $0 < Date() } ?? false, total = poll.votes.count, show = mine != nil || closed
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(poll.options.enumerated()), id: \.offset) { i, o in
                let n = poll.votes.values.filter { $0 == i }.count, pct = total > 0 ? Double(n) / Double(total) : 0
                Button { vote(i) } label: {
                    HStack { Text(o + (mine == i ? " ✓" : "")); Spacer(); if show { Text("\(Int((pct * 100).rounded()))%") } }
                        .font(.sans(14)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 36)
                        .background(alignment: .leading) { GeometryReader { g in Rectangle().fill(mine == i ? Color(rgb: 0x4d5038) : Color(rgb: 0x434530)).frame(width: show ? g.size.width * pct : 0) } }
                        .background(T.card).clipShape(RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(T.border))
                }
                .buttonStyle(.plain).disabled(closed)
            }
            Text("\(total) vote\(total == 1 ? "" : "s")\(poll.closes.map { $0 < Date() ? " · Final results" : " · " + left($0) } ?? "")").font(.sans(13)).foregroundStyle(T.muted)
        }
    }
    private func left(_ d: Date) -> String { let h = d.timeIntervalSinceNow / 3600; return h < 1 ? "Closing soon" : h < 24 ? "\(Int(h.rounded())) hours left" : "\(Int((h / 24).rounded())) days left" }
}

/// A link's preview (.linkcard): its picture, the site, and the title — read from the club's own link reader.
enum LinkMeta {
    struct Meta { let title: String?, image: URL?, publication: String? }
    @MainActor private static var cache: [URL: Meta] = [:]
    @MainActor static func get(_ url: URL) async -> Meta? {
        if let m = cache[url] { return m }
        if let id = youtube(url) { let m = Meta(title: "YouTube video", image: URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg"), publication: "YouTube"); cache[url] = m; return m }
        var c = URLComponents(string: "https://lotmstudy.org/fetch-metadata")!; c.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
        guard let u = c.url, let (d, _) = try? await URLSession.shared.data(from: u), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], o["error"] == nil else { return nil }
        let m = Meta(title: o["title"] as? String, image: (o["image"] as? String).flatMap(URL.init(string:)), publication: o["publication"] as? String)
        cache[url] = m; return m
    }
    static func youtube(_ u: URL) -> String? {
        let s = u.absoluteString
        guard let r = s.range(of: #"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})"#, options: .regularExpression) else { return nil }
        return String(s[r].suffix(11))
    }
}
struct LinkCard: View {
    let url: URL
    @State private var meta: LinkMeta.Meta?
    @State private var tried = false
    var body: some View {
        Button { openInApp(url) } label: {
            VStack(alignment: .leading, spacing: 0) {
                if let img = meta?.image {
                    AsyncImage(url: img) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x2a2d1d) }.frame(maxWidth: .infinity).aspectRatio(1.91, contentMode: .fit).clipped()
                } else if !tried { LinearGradient(colors: [Color(rgb: 0x3e412c), Color(rgb: 0x46492f), Color(rgb: 0x3e412c)], startPoint: .leading, endPoint: .trailing).aspectRatio(1.91, contentMode: .fit) }
                VStack(alignment: .leading, spacing: 2) {
                    Text((meta?.publication ?? url.host?.replacingOccurrences(of: "www.", with: "") ?? "").uppercased()).font(.sans(11.5, .semibold)).tracking(0.7).foregroundStyle(T.muted)
                    Text(meta?.title ?? url.host ?? "").font(.serif(16, .semibold)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.leading)
                }
                .padding(.horizontal, 12).padding(.top, 9).padding(.bottom, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(T.paper).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule))
        }
        .buttonStyle(.plain)
        .task { meta = await LinkMeta.get(url); tried = true }
    }
}

// MARK: - The post's sheet (share, quote, your post's tools)

private struct PostActions: View {
    let p: FPost
    @ObservedObject var m: FeedModel
    @ObservedObject var web: WebModel
    let close: () -> Void, report: () -> Void, delete: () -> Void
    @State private var pinned: String?
    private var mine: Bool { p.userId == m.me }
    private var link: URL { URL(string: "https://lotmstudy.org/next/#/post/\(p.id)")! }
    var body: some View {
        SheetBody {
            Card14 {
                GroupRow(icon: "quote", label: "Quote in a post", action: { close(); web.go("/write?quote=\(p.id)") }) { EmptyView() }
                GroupLine()
                ShareLink(item: link) { HStack(spacing: 14) { GlyphView(n: "link", s: 20); Text("Copy or share link").font(.sans(15)).frame(maxWidth: .infinity, alignment: .leading) }.foregroundStyle(T.ink).padding(.horizontal, 16).frame(minHeight: 50) }
            }
            if mine {
                Card14 {
                    Eyebrow(t: "Your post").frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 4)
                    GroupRow(icon: "pencil", label: "Edit", action: { close(); web.go("/write/\(p.id)") }) { EmptyView() }; GroupLine()
                    GroupRow(icon: "plus", label: "Continue this thread", action: { close(); web.go("/write?continue=\(p.id)") }) { EmptyView() }; GroupLine()
                    GroupRow(icon: "x", label: "Hide a reply…", action: { close(); web.go("/post/\(p.id)?hide=1") }) { EmptyView() }; GroupLine()
                    GroupRow(icon: "reply", label: "Who can reply", action: { Task { await m.setReplies(p, on: !p.canReply) }; close() }) { Text(p.canReply ? "Everyone ›" : "No one ›").font(.sans(15)).foregroundStyle(T.muted) }; GroupLine()
                    GroupRow(icon: "pin", label: pinned == nil ? "Pin for a week" : "Unpin", action: { Task { await togglePin() }; close() }) { EmptyView() }; GroupLine()
                    GroupRow(icon: "trash", label: "Delete", danger: true, action: delete) { EmptyView() }
                }
                .padding(.top, 10)
            } else {
                Card14 {
                    GroupRow(icon: "x", label: "Mute \(m.people[p.userId]?.name.split(separator: " ").first.map(String.init) ?? "")", action: { Task { await m.mute(p) }; close() }) { EmptyView() }; GroupLine()
                    GroupRow(icon: "flag", label: "Report to an admin", danger: true, action: report) { EmptyView() }
                }
                .padding(.top, 10)
            }
        }
        .task { await loadPin() }
    }
    @MainActor private func loadPin() async {
        guard let a = await m.auth() else { return }
        pinned = ((try? await Supa(a: a).rows("/rest/v1/weekly_pins?source_aside_id=eq.\(p.id)&expires_at=gt.\(ISO8601DateFormatter().string(from: Date()))&select=id&limit=1")) ?? []).first?["id"] as? String
    }
    @MainActor private func togglePin() async {
        guard let a = await m.auth() else { return }; let db = Supa(a: a)
        if pinned != nil { _ = try? await db.req("DELETE", "/rest/v1/weekly_pins?source_aside_id=eq.\(p.id)") }
        else {
            let body = (p.showTitle ? p.title + " — " : "") + String(p.body.prefix(400))
            _ = try? await db.req("POST", "/rest/v1/weekly_pins", json: ["user_id": a.me, "body": body, "week_start": String(ISO8601DateFormatter().string(from: Date()).prefix(10)),
                                                                     "expires_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 86400)), "source_aside_id": p.id])
        }
        await m.load(quiet: true)
    }
}
