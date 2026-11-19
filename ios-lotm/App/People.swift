import SwiftUI
import WebKit

// The Directory (everyone in the club, by surname) and a member's page — drawn as the web app drew them.

struct DMember: Identifiable { let id: String, name: String, avatar: URL?, role: String, bio: String
    var sortKey: String { let w = name.trimmingCharacters(in: .whitespaces).split(separator: " "); return (w.count > 1 ? "\(w.last!) \(w.dropLast().joined(separator: " "))" : name).lowercased() }
    var letter: String { let c = sortKey.prefix(1).uppercased(); return c.range(of: "[A-Z]", options: .regularExpression) != nil ? c : "#" }
    var roleName: String? { role == "administrator" ? "Administrator" : role == "moderator" ? "Moderator" : nil }
}

@MainActor func openMember(_ id: String, _ web: WebModel) {
    guard let feed = web.feed, MemberScreen.showing != id else { return }
    MemberScreen.showing = id
    presentSlide(MemberScreen(id: id, feed: feed, web: web))
}

extension WebModel {
    /// Go to a web page from anywhere: any native screen slid over the app closes first, so the page isn't hidden behind it.
    func goTop(_ route: String) {
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        if let root, root.presentedViewController != nil { root.dismiss(animated: true) { self.go(route) } } else { go(route) }
    }
}

struct DirectoryScreen: View {
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @State private var people: [DMember] = []
    @State private var q = ""
    @State private var loaded = false
    private var shown: [DMember] {
        let t = q.trimmingCharacters(in: .whitespaces).lowercased()
        return t.isEmpty ? people : people.filter { [$0.name, $0.bio, $0.roleName ?? ""].contains { $0.lowercased().contains(t) } }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Directory").font(.serif(20, .semibold)).foregroundStyle(T.ink)
                Spacer()
                Text("\(people.count) \(people.count == 1 ? "member" : "members")").font(.sans(14)).foregroundStyle(T.muted)
            }
            .padding(.horizontal, 20).frame(height: 50)
            HStack(spacing: 8) {
                GlyphView(n: "search", s: 18).foregroundStyle(T.muted)
                TextField("", text: $q, prompt: Text("Search by name").foregroundColor(T.muted)).font(.sans(15)).foregroundStyle(T.ink).autocorrectionDisabled()
            }
            .padding(.horizontal, 12).frame(height: 40).background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x0c0e08, 0.07)))
            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 4)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    let list = shown
                    ForEach(Array(list.enumerated()), id: \.element.id) { i, p in
                        if q.isEmpty && (i == 0 || list[i - 1].letter != p.letter) {
                            Text(p.letter).font(.sans(12, .bold)).tracking(1.2).foregroundStyle(T.muted).padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 4)
                        }
                        Button { Haptic.tap(); openMember(p.id, web) } label: {
                            HStack(spacing: 14) {
                                Face(name: p.name, url: p.avatar, s: 48)
                                VStack(alignment: .leading, spacing: 2) {
                                    (Text(p.name).font(.serif(18, .semibold)).foregroundColor(T.ink) + Text(p.id == feed.me ? " · You" : "").font(.sans(13)).foregroundColor(T.muted))
                                        .lineLimit(1)
                                    let sub = [p.roleName, p.bio.isEmpty ? nil : p.bio].compactMap { $0 }.joined(separator: " · ")
                                    if !sub.isEmpty { Text(sub).font(.sans(14)).foregroundStyle(T.muted).lineLimit(1) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text("›").font(.sans(18)).foregroundStyle(T.muted)
                            }
                            .padding(.horizontal, 20).padding(.vertical, 10).contentShape(Rectangle())
                            .overlay(alignment: .bottom) { T.rule.frame(height: 1).padding(.leading, 82) }
                        }
                        .buttonStyle(.plain)
                    }
                    if loaded && list.isEmpty {
                        Text(people.isEmpty ? "No members yet." : "No one by that name.").font(.serif(17)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40)
                    }
                    Color.clear.frame(height: 120)
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .refreshable { await load() }
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await load() }
    }
    private func load() async {
        guard let a = await feed.auth(), let rows = try? await Supa(a: a).rows("/rest/v1/profiles?status=eq.approved&select=id,display_name,avatar_url,role,bio") else { loaded = true; return }
        people = rows.compactMap { r in
            guard let id = r["id"] as? String, let n = r["display_name"] as? String, !n.isEmpty else { return nil }
            return DMember(id: id, name: n, avatar: (r["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }, role: r["role"] as? String ?? "member", bio: r["bio"] as? String ?? "")
        }.sorted { $0.sortKey < $1.sortKey }
        loaded = true
    }
}

// MARK: - A member's page

private struct MReply: Identifiable { let id: String, post: String, body: String, created: Date }

struct MemberScreen: View {
    static var showing: String?
    let id: String
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @StateObject private var mine: FeedModel
    @ObservedObject private var chat = ChatSession.shared
    @Environment(\.closeScreen) private var close
    @State private var bio = "", role = "member", since: Date?, cover: URL?
    @State private var reading: (title: String, cover: URL?, page: Int?)?
    @State private var replies: [MReply] = []
    @State private var finished = 0
    @State private var tab = "Posts"
    @State private var acting: FPost?
    @State private var reporting: FPost?
    @State private var deleting: FPost?
    @State private var reason = ""
    @State private var reportingMember = false
    @State private var confirmBlock = false
    @State private var thanks = false

    init(id: String, feed: FeedModel, web: WebModel) {
        self.id = id; self.feed = feed; self.web = web
        _mine = StateObject(wrappedValue: FeedModel(only: id))
    }
    private var person: Person? { feed.people[id] }
    private var isMe: Bool { id == feed.me }
    private var blocked: Bool { chat.blocked.contains(id) }
    private var shown: [FPost] { tab == "Articles" ? mine.posts.filter(\.article) : mine.posts }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                banner
                HStack(alignment: .bottom) {
                    Face(name: person?.name ?? "", url: person?.avatar, s: 76).padding(4).background(Circle().fill(T.paper))
                    Spacer()
                    if isMe {
                        Button { close { web.select(.settings) } } label: {
                            Text("Edit profile").font(.sans(14, .bold)).foregroundStyle(T.ink).padding(.horizontal, 18).frame(height: 40).overlay(Capsule().stroke(Color(rgb: 0x626546)))
                        }
                    } else {
                        Button { Haptic.tap(); openChat(web, with: id) } label: {
                            Text("Message").font(.sans(14, .bold)).foregroundStyle(T.paper).padding(.horizontal, 18).frame(height: 40).background(Capsule().fill(T.ink))
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, -42)
                VStack(alignment: .leading, spacing: 0) {
                    Text(person?.name ?? "Member").font(.serif(24, .semibold)).foregroundStyle(T.ink)
                    Text([since.map { "Member since \($0.formatted(.dateTime.month(.wide).year()))" }, role == "member" ? nil : role.capitalized].compactMap { $0 }.joined(separator: " · "))
                        .font(.sans(14)).foregroundStyle(T.muted)
                    if !bio.isEmpty { Text(bio).font(.serif(17)).foregroundStyle(T.ink).lineSpacing(3).fixedSize(horizontal: false, vertical: true).padding(.top, 10) }
                    if let r = reading {
                        HStack(spacing: 10) {
                            AsyncImage(url: r.cover) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0xc9c7af) }.frame(width: 26, height: 38).clipShape(RoundedRectangle(cornerRadius: 3))
                            VStack(alignment: .leading, spacing: 1) {
                                Text("CURRENTLY READING").font(.sans(11, .bold)).tracking(0.9).foregroundStyle(T.muted)
                                Text(r.title).font(.serif(15, italic: true)).foregroundStyle(T.ink).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            if let p = r.page, p > 0 { Text("p. \(p)").font(.sans(13)).foregroundStyle(T.muted) }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.border)).padding(.top, 10)
                    }
                    HStack(spacing: 16) { stat(mine.posts.count, "posts"); stat(replies.count, "replies"); stat(finished, "books read") }.padding(.top, 10)
                }
                .padding(.horizontal, 20).padding(.top, 10)
                HStack(spacing: 0) {
                    ForEach(["Posts", "Replies", "Articles"], id: \.self) { t in
                        Button { Haptic.tap(); tab = t } label: {
                            Text(t).font(.sans(14, tab == t ? .bold : .regular)).foregroundStyle(tab == t ? T.ink : T.muted)
                                .frame(maxWidth: .infinity).padding(.top, 12).padding(.bottom, 10)
                                .overlay(alignment: .bottom) { (tab == t ? T.ink : Color.clear).frame(height: 3) }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .overlay(alignment: .bottom) { T.rule.frame(height: 1) }.padding(.top, 12)
                if blocked {
                    Text("You’ve blocked \(person?.name.split(separator: " ").first.map(String.init) ?? "this member"). Their posts, replies and messages are hidden.")
                        .font(.sans(14)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(32)
                } else if tab == "Replies" {
                    ForEach(replies) { r in
                        Button { feed.open(r.post, false) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Face(name: person?.name ?? "", url: person?.avatar, s: 36)
                                VStack(alignment: .leading, spacing: 3) {
                                    (Text(person?.name ?? "").font(.sans(14, .semibold)).foregroundColor(T.ink) + Text(" · Reply · \(ago(r.created))").font(.sans(14)).foregroundColor(T.muted))
                                    Text(r.body).font(.serif(17)).foregroundStyle(T.ink).lineSpacing(3).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 20).padding(.vertical, 14).contentShape(Rectangle())
                            .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
                        }
                        .buttonStyle(.plain)
                    }
                    if replies.isEmpty { empty }
                } else {
                    Color.clear.frame(height: 10)
                    ForEach(shown) { p in PostCard(p: p, m: mine, web: web, more: { acting = p }) }
                    if shown.isEmpty && mine.loaded { empty }
                }
                Color.clear.frame(height: 60)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark).tint(T.ink)
        .environment(\.openURL, OpenURLAction { url in openInApp(url); return .handled })
        .task { mine.web = web.view; mine.open = feed.open; async let a: () = mine.load(); async let b: () = load(); _ = await (a, b) }
        .onDisappear { if MemberScreen.showing == id { MemberScreen.showing = nil } }
        .sheet(item: $acting) { p in
            PostActions(p: p, m: mine, web: web, close: { acting = nil }, report: { acting = nil; reporting = p; reason = "" }, delete: { acting = nil; deleting = p })
                .presentationDetents([.medium, .large])
        }
        .alert("What is wrong with this post?", isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } })) {
            TextField("Sent to the administrators", text: $reason)
            Button("Cancel", role: .cancel) {}
            Button("Report") { if let p = reporting { Task { await mine.report(p, reason) } } }
        }
        .alert("Report \(person?.name ?? "this member")?", isPresented: $reportingMember) {
            TextField("What’s wrong?", text: $reason)
            Button("Cancel", role: .cancel) {}
            Button("Report") { Task { await reportMember() } }
        } message: { Text("Sent to the administrators, who review reports within 24 hours.") }
        .alert("Thank you", isPresented: $thanks) { Button("OK", role: .cancel) {} } message: { Text("Reported to the administrators. They review reports within 24 hours.") }
        .confirmationDialog("Delete this post? This cannot be undone.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let p = deleting { Task { await mine.delete(p) } } }
        }
        .confirmationDialog("Block \(person?.name ?? "this member")?", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("Block", role: .destructive) { Task { await chat.block(id) } }
        } message: { Text("Their posts, replies and chat messages will be hidden from you. You can unblock them in Settings.") }
    }

    private var empty: some View { Text("Nothing yet.").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
    private func stat(_ n: Int, _ l: String) -> some View {
        (Text("\(n)").font(.sans(14, .bold)).foregroundColor(T.ink) + Text(" \(l)").font(.sans(14)).foregroundColor(T.muted))
    }

    private var banner: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [Color(rgb: 0x9c5463), Color(rgb: 0xcdcbb4)], startPoint: .topLeading, endPoint: .bottomTrailing)
            if let cover { AsyncImage(url: cover) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
        }
        .frame(height: 150 + safeTop).frame(maxWidth: .infinity).clipped()
        .overlay(alignment: .top) {
            HStack {
                Button { close() } label: { GlyphView(n: "back", s: 22).foregroundStyle(.white).frame(width: 36, height: 36).background(Circle().fill(Color(rgb: 0x0a0c06, 0.45))) }
                    .accessibilityLabel("Back")
                Spacer()
                if !isMe {
                    Menu {
                        if blocked { Button("Unblock") { Task { await chat.unblock(id) } } }
                        else { Button("Block", role: .destructive) { confirmBlock = true } }
                        Button("Report") { reason = ""; reportingMember = true }
                    } label: { GlyphView(n: "more", s: 22).foregroundStyle(.white).frame(width: 36, height: 36).background(Circle().fill(Color(rgb: 0x0a0c06, 0.45))) }
                        .accessibilityLabel("More")
                }
            }
            .padding(.horizontal, 10).padding(.top, max(safeTop, 20) + 8)
        }
    }
    private var safeTop: CGFloat { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.top }.first ?? 47 }

    private func load() async {
        if chat.a == nil { await chat.start(web.view) }
        guard let a = await feed.auth() else { return }
        let db = Supa(a: a)
        async let P = db.rows("/rest/v1/profiles?id=eq.\(id)&select=bio,role,background_url,current_read_title,current_read_cover_url,created_at")
        async let C = db.rows("/rest/v1/comments?user_id=eq.\(id)&select=id,aside_id,body,created_at&order=created_at.desc&limit=50")
        async let R = db.rows("/rest/v1/current_reads?user_id=eq.\(id)&select=status,current_page,custom_title,custom_cover_url,editions(title,cover_url)")
        let p = (try? await P)?.first, cs = (try? await C) ?? [], rs = (try? await R) ?? []
        bio = p?["bio"] as? String ?? ""; role = p?["role"] as? String ?? "member"
        since = (p?["created_at"] as? String).map { parseDate($0) }
        cover = (p?["background_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
        replies = cs.compactMap { c in (c["id"] as? String).map { MReply(id: $0, post: c["aside_id"] as? String ?? "", body: c["body"] as? String ?? "", created: parseDate(c["created_at"])) } }
        finished = rs.filter { $0["status"] as? String == "finished" }.count
        if let cur = rs.first(where: { $0["status"] as? String == "reading" }) {
            let e = cur["editions"] as? [String: Any]
            let t = (e?["title"] as? String) ?? (cur["custom_title"] as? String) ?? ""
            let c = ((e?["cover_url"] as? String) ?? (cur["custom_cover_url"] as? String)).flatMap { $0.isEmpty ? nil : URL(string: $0) }
            if !t.isEmpty { reading = (t, c, cur["current_page"] as? Int) }
        } else if let t = p?["current_read_title"] as? String, !t.isEmpty {
            reading = (t, (p?["current_read_cover_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }, nil)
        }
    }

    private func reportMember() async {
        guard let a = await feed.auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/reports", json: ["reporter_id": a.me, "reason": "Member \(person?.name ?? id): \(reason)"], prefer: "return=minimal")
        thanks = true
    }
}
