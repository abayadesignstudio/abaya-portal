import SwiftUI
import WebKit

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
    var tags: [String] = [], thumb: URL? = nil
    var showTitle: Bool {
        if article { return !title.isEmpty }
        let n = { (t: String) in t.replacingOccurrences(of: quoteMark, with: "").lowercased().replacingOccurrences(of: #"[…\.\s"“”'‘’,:;!?-]+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
        let t = n(title); return !t.isEmpty && t != "voice note" && t != "photo" && !n(body).hasPrefix(t)
    }
}
struct FPin: Identifiable {
    enum Kind { case read, study, event, pin }
    let id: String, kind: Kind, title: String, text: String
    var detail: String? = nil, when: Date? = nil, place: String? = nil, placeURL: URL? = nil, link: URL? = nil
    var slug: String? = nil, cover: URL? = nil, sourcePost: String? = nil, rsvp = false, by: String? = nil, author: String? = nil, notes: String? = nil, file: URL? = nil
    /// What the group reads for the study: the page the schedule sets, and any note on it.
    static func reading(page: Int?, total: Int?, pos: String?) -> String? {
        if let pos, !pos.isEmpty, pos != "TBD" { return pos }   // the administrator's own note comes first
        var parts: [String] = []
        if let page { parts.append("Read through page \(page)" + (total.map { " of \($0)" } ?? "")) }
        if let pos, !pos.isEmpty, pos != "TBD" { parts.append(page == nil ? "Read \(pos)" : pos) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
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
    /// Set for a member's page: only that member's posts.
    let only: String?

    init(only: String? = nil) {
        self.only = only
        // The last Feed shows at once; the fresh one replaces it a moment later.
        if let me = UserDefaults.standard.string(forKey: "lotm.me") {
            self.me = me
            if only == nil, let d = UserDefaults.standard.data(forKey: "lotm.feed." + me), let p = try? JSONDecoder().decode([FPost].self, from: d) { posts = p; loaded = true }
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
            people = Self.people(map); UserDefaults.standard.set(map, forKey: "lotm.people"); Roster.names = map.values.compactMap { $0["name"] }.filter { !$0.isEmpty }
            posts = Fe; pins = Pi; unread = Nn.count; loaded = true; failed = nil
            if only == nil, let d = try? JSONEncoder().encode(Array(Fe.prefix(25))) { UserDefaults.standard.set(d, forKey: cacheKey) }
        } catch { if posts.isEmpty { failed = error.localizedDescription } }
    }

    private static let cols = "id,user_id,title,subtitle,body,body_html,aside_type,link_url,thumbnail_url,image_urls,created_at,edited_at,allow_comments,reply_policy,thread_parent_id,quote_of_id,post_format,selected_edition_id,related_edition_id,audio_url,publish_at"
    private func loadPosts(_ db: Supa) async throws -> [FPost] {
        let me = db.a.me
        let rows = try await db.rows("/rest/v1/asides?select=\(Self.cols)&or=(visibility.eq.public,visibility.is.null,and(user_id.eq.\(me),publish_at.not.is.null))\(only.map { "&user_id=eq.\($0)" } ?? "")&order=created_at.desc&limit=60")
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
        async let TG = db.rows("/rest/v1/aside_tags?aside_id=in.(\(list))&select=aside_id,tag")
        async let E = db.rowsIf(!eids.isEmpty, "/rest/v1/editions?id=in.(\(eids.joined(separator: ",")))&select=id,title,author,cover_url")
        let (likes, cs, saved, polls, conts, quotes, eds, tagRows) = try await (L, C, S, PO, T, Q, E, TG)
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
            return FPost(id: id, userId: r["user_id"] as? String ?? "", title: r["title"] as? String ?? "", subtitle: r["subtitle"] as? String ?? "", body: article ? body : quoteMarked(body, r["body_html"] as? String), kind: kind,
                         created: parseDate(r["created_at"]), edited: (r["edited_at"] as? String) != nil, publishAt: (r["publish_at"] as? String).map { parseDate($0) },
                         photos: article ? [] : photos, link: photos.isEmpty && !audio ? link : nil, article: article, audio: audio,
                         likes: count(likes, "aside_id", id), liked: likes.contains { $0["aside_id"] as? String == id && $0["user_id"] as? String == me },
                         replies: count(cs, "aside_id", id), saved: saved.contains { $0["aside_id"] as? String == id },
                         canReply: (r["allow_comments"] as? Bool ?? true) && (r["reply_policy"] as? String) != "none",
                         continuations: count(conts, "thread_root_id", id),
                         quoteId: q?["id"] as? String, quoteUser: q?["user_id"] as? String,
                         quoteText: q.map { (($0["body"] as? String).flatMap { $0.isEmpty ? nil : $0 }) ?? ($0["title"] as? String ?? "") },
                         poll: poll, book: book, tags: tagRows.filter { $0["aside_id"] as? String == id }.compactMap { $0["tag"] as? String },
                         thumb: (r["thumbnail_url"] as? String).flatMap(URL.init(string:)))
        }
    }

    private func loadPins(_ db: Supa) async throws -> [FPin] {
        let now = ISO8601DateFormatter().string(from: Date()), soon = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3 * 3600))
        let today = String(now.prefix(10))
        async let P = db.rows("/rest/v1/weekly_pins?expires_at=gt.\(now)&select=id,user_id,body,source_aside_id,link_url,rsvp_enabled&order=created_at.desc")
        async let S = db.rows("/rest/v1/club_updates?study_at=gte.\(soon)&select=id,book_title,book_author,cover_url,cover_image_url,reading_position,club_page,club_total,synopsis,reading_file_url,study_at,study_location,study_location_url&order=study_at.asc,created_at.desc&limit=1")
        async let R = db.rows("/rest/v1/devotionals?show_from=lte.\(today)&show_until=gte.\(today)&select=slug,title,subtitle")
        async let E = db.rows("/rest/v1/club_events?starts_at=gte.\(soon)&select=id,title,description,location,location_url,starts_at,external_url&order=starts_at&limit=8")
        let (pins, study, own, events) = try await (P, S, R, E)
        // a devotional published day by day is listed for members from its published copy
        var reads = own
        for r in (try? await db.rows("/rest/v1/devotionals_public?show_from=lte.\(today)&show_until=gte.\(today)&select=slug,title,subtitle,body")) ?? [] {
            if !reads.contains(where: { $0["slug"] as? String == r["slug"] as? String }), (r["body"] as? String ?? "").contains("\n# ") || (r["body"] as? String ?? "").hasPrefix("# ") { reads.append(r) }
        }
        var out: [FPin] = []
        for r in reads { out.append(FPin(id: "read" + (r["slug"] as? String ?? ""), kind: .read, title: r["title"] as? String ?? "", text: (r["subtitle"] as? String) ?? (r["title"] as? String ?? ""), slug: r["slug"] as? String)) }
        if let s = study.first, let at = s["study_at"] as? String {
            let book = (s["book_title"] as? String ?? "").replacingOccurrences(of: #"^Amazon\.com:\s*"#, with: "", options: .regularExpression).components(separatedBy: ":").first ?? ""
            let pos = (s["reading_position"] as? String).flatMap { $0 == "TBD" || $0.isEmpty ? nil : $0 }
            out.append(FPin(id: s["id"] as? String ?? "", kind: .study, title: book, text: [book, pos].compactMap { $0 }.joined(separator: ", "),
                            detail: FPin.reading(page: s["club_page"] as? Int, total: s["club_total"] as? Int, pos: pos), when: parseDate(at), place: s["study_location"] as? String,
                            placeURL: (s["study_location_url"] as? String).flatMap(URL.init(string:)),
                            cover: ((s["cover_url"] as? String) ?? (s["cover_image_url"] as? String)).flatMap(URL.init(string:)), rsvp: true, author: s["book_author"] as? String, notes: (s["synopsis"] as? String).flatMap { $0.isEmpty ? nil : $0 }, file: (s["reading_file_url"] as? String).flatMap(URL.init(string:))))
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
        // The choice shows at once; if the server refuses it, it is put back as it was.
        do {
            if mine != nil { _ = try await db.req("DELETE", "/rest/v1/poll_votes?poll_id=eq.\(poll.id)&user_id=eq.\(a.me)") }
            if mine != i { _ = try await db.req("POST", "/rest/v1/poll_votes", json: ["poll_id": poll.id, "user_id": a.me, "option_index": i]) }
        } catch {
            if let k2 = posts.firstIndex(where: { $0.id == p.id }), var back = posts[k2].poll { back.votes[me] = mine; posts[k2].poll = back }
        }
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
        ChatSession.shared.blocked.insert(p.userId)
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

extension Supa {
    func rowsIf(_ c: Bool, _ path: String) async throws -> [[String: Any]] { c ? try await rows(path) : [] }
}

/// A light tap, ready before it is needed (an unprepared generator is often too slow to be felt).
enum Haptic {
    private static let light: UIImpactFeedbackGenerator = { let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); return g }()
    static func tap() { light.impactOccurred(); light.prepare() }
}
