import SwiftUI
import WebKit

// The Library, native: My Library (your shelves and reading goals) and LOTM (the club's books, meetings, events
// and shared links), drawn as the web app drew them. The Commonplace pane is still the web page for now.

// MARK: - Data

struct LRead: Identifiable, Equatable { let id: String; var page: Int, status: String, title: String, author: String?, cover: URL?, total: Int?, bookURL: String?, sort: Int }
struct LUpdate: Identifiable, Equatable { let id: String; var title: String, author: String?, synopsis: String?, position: String?, bookURL: String?, cover: URL?, file: String?, studyAt: Date?, place: String?, placeURL: String?, created: Date }
struct LPast: Identifiable, Equatable { let id: String; var title: String, author: String?, cover: URL?, bookURL: String?, created: Date }
struct LEvent: Identifiable, Equatable { let id: String; var title: String, details: String?, place: String?, placeURL: String?, starts: Date, link: String? }
struct LSug: Identifiable, Equatable { let id: String; var user: String, title: String, dateRaw: String?, place: String?, details: String? }
struct LLink: Identifiable, Equatable { let id: String; var user: String, url: String, title: String, publication: String?, image: URL?, likes: Int }
struct LFound: Identifiable { let id = UUID(); var title: String, author: String?, publisher: String?, year: String?, pages: Int?, cover: String?, bookURL: String?, label: String?, isbn: String? }
struct LMeeting: Identifiable { let id: String, title: String, when: Date, place: String? }

private func lshort(_ t: String) -> String { String(t.replacingOccurrences(of: #"^Amazon\.com:\s*"#, with: "", options: [.regularExpression, .caseInsensitive]).split(separator: ":").first ?? "").trimmingCharacters(in: .whitespaces) }
private func lnorm(_ t: String) -> String { lshort(t).lowercased() }
private func lsame(_ a: String, _ b: String) -> Bool { let x = lnorm(a), y = lnorm(b); return x.contains(y.prefix(14)) || y.contains(x.prefix(14)) }
private func lurl(_ s: Any?) -> URL? { (s as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) } }
private func nz(_ v: Any?) -> Any { v ?? NSNull() }
private func ne(_ s: String) -> Any { s.isEmpty ? NSNull() : s }
private func lday(_ d: Date = Date()) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: d) }
private func liso(_ d: Date = Date()) -> String { ISO8601DateFormatter().string(from: d) }
private func amazon(_ title: String, _ author: String?, _ url: String?) -> URL {
    if let url, url.range(of: #"amazon\.|amzn\."#, options: [.regularExpression, .caseInsensitive]) != nil, let u = URL(string: url) { return u }
    var c = URLComponents(string: "https://www.amazon.com/s")!
    c.queryItems = [URLQueryItem(name: "k", value: [lshort(title), author].compactMap { $0 }.joined(separator: " ")), URLQueryItem(name: "i", value: "stripbooks")]
    return c.url!
}
private let SHADES: [Color] = ([0x9c5463, 0x4b3f6b, 0x5b6b80, 0xa8863f, 0x8c9469, 0xc9382f, 0x6f5b7d, 0xb8752e] as [UInt32]).map { Color(rgb: $0) }
private func site(_ path: String, _ q: [String: String]) async -> [String: Any]? {
    var c = URLComponents(string: "https://lotmstudy.org/\(path)")!; c.queryItems = q.map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let u = c.url, let (d, _) = try? await URLSession.shared.data(from: u) else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}

@MainActor
final class LibraryModel: ObservableObject {
    @Published var loaded = false
    @Published var reads: [LRead] = []
    @Published var current: [LUpdate] = []
    @Published var past: [LPast] = []
    @Published var shelfOrder: [String] = []
    @Published var notes: [String: Int] = [:]
    @Published var goal = 20
    @Published var remind = true
    @Published var remindAt = "19:30"
    @Published var days: [String: Int] = [:]
    @Published var events: [LEvent] = []
    @Published var sugs: [LSug] = []
    @Published var links: [LLink] = []
    @Published var meetings: [LMeeting]?
    @Published var admin = false
    @Published var ghost: [String: String] = [:]     // ghost cover → "adding" | "added"
    @Published var toast: String?
    weak var feed: FeedModel?
    private var busy = false
    var me: String { feed?.me ?? "" }
    private func db() async -> Supa? { guard let a = await feed?.auth() else { return nil }; return Supa(a: a) }

    var mine: [LRead] { reads.filter { $0.status == "reading" || $0.status == "paused" } }
    var want: [LRead] { reads.filter { $0.status == "want" } }
    var finished: [LRead] { reads.filter { $0.status == "finished" } }
    var clubToAdd: [LUpdate] { current.filter { b in !reads.contains { lsame($0.title, b.title) } } }
    var clubFinishedToAdd: [LPast] { past.filter { b in !reads.contains { lsame($0.title, b.title) } } }
    var year: Int { Calendar.current.component(.year, from: Date()) }
    var doneThisYear: [LPast] {
        past.filter { Calendar.current.component(.year, from: $0.created) == year }.sorted { $0.created < $1.created }
            .filter { b in !current.contains { lnorm($0.title).prefix(14) == lnorm(b.title).prefix(14) } }
    }
    var earlier: [LPast] { past.filter { Calendar.current.component(.year, from: $0.created) < year } }
    func myFor(_ b: LUpdate) -> LRead? { reads.first { $0.status != "finished" && lsame($0.title, b.title) } }
    private var front: Int { min(0, reads.map(\.sort).min() ?? 0) - 1 }
    func say(_ s: String) { toast = s; Task { try? await Task.sleep(nanoseconds: 2_400_000_000); if toast == s { toast = nil } } }

    func load() async {
        guard let db = await db() else { loaded = true; return }
        let me = db.a.me
        async let U = db.rows("/rest/v1/club_updates?select=*&order=created_at.desc&limit=30")
        async let R = db.rows("/rest/v1/current_reads?user_id=eq.\(me)&select=id,current_page,status,sort_order,custom_title,custom_author,custom_cover_url,custom_total_pages,editions(title,author,cover_url,total_pages,book_url)&order=sort_order")
        async let B = db.rows("/rest/v1/books_read?select=id,title,author,cover_url,book_url,created_at&order=created_at.desc")
        async let O = db.rows("/rest/v1/club_shelf_order?year=eq.\(year)&select=titles")
        async let N = db.rows("/rest/v1/private_notes?user_id=eq.\(me)&book_title=not.is.null&select=book_title")
        async let P = db.rows("/rest/v1/profiles?id=eq.\(me)&select=role")
        // A fetch that fails (a dropped connection, several logs in quick succession) must never empty the shelves:
        // what is on screen stays until an answer actually arrives. The books are tried once more before giving up.
        let u = (try? await U) ?? [], bGot = try? await B
        var rGot = try? await R
        if rGot == nil { try? await Task.sleep(nanoseconds: 600_000_000); rGot = try? await db.rows("/rest/v1/current_reads?user_id=eq.\(me)&select=id,current_page,status,sort_order,custom_title,custom_author,custom_cover_url,custom_total_pages,editions(title,author,cover_url,total_pages,book_url)&order=sort_order") }
        let b = bGot ?? []
        if bGot != nil || past.isEmpty { past = b.compactMap { x in (x["id"] as? String).map { LPast(id: $0, title: x["title"] as? String ?? "", author: x["author"] as? String, cover: lurl(x["cover_url"]), bookURL: x["book_url"] as? String, created: parseDate(x["created_at"])) } } }
        let rows: [LUpdate] = u.compactMap { x in
            guard let id = x["id"] as? String else { return nil }
            return LUpdate(id: id, title: x["book_title"] as? String ?? "", author: x["book_author"] as? String, synopsis: x["synopsis"] as? String, position: x["reading_position"] as? String,
                           bookURL: x["book_url"] as? String, cover: lurl(x["cover_url"]) ?? lurl(x["cover_image_url"]), file: (x["reading_file_url"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                           studyAt: (x["study_at"] as? String).map { parseDate($0) }, place: x["study_location"] as? String, placeURL: x["study_location_url"] as? String, created: parseDate(x["created_at"]))
        }
        var seen: [String: LUpdate] = [:], order: [String] = []
        let newest = rows.first?.created ?? Date()
        for x in rows {
            let k = lnorm(x.title)
            let done = past.contains { lnorm($0.title).prefix(14) == k.prefix(14) && $0.created >= x.created }
            if seen[k] == nil && !done && newest.timeIntervalSince(x.created) < 21 * 86400 { seen[k] = x; order.append(k) }
        }
        if !u.isEmpty || current.isEmpty { current = Array(order.compactMap { seen[$0] }.prefix(4)) }
        if let r = rGot { reads = r.compactMap { x in
            guard let id = x["id"] as? String else { return nil }
            let e = x["editions"] as? [String: Any]
            return LRead(id: id, page: x["current_page"] as? Int ?? 0, status: x["status"] as? String ?? "reading", title: (e?["title"] as? String) ?? (x["custom_title"] as? String) ?? "Book",
                         author: (e?["author"] as? String) ?? (x["custom_author"] as? String), cover: lurl(e?["cover_url"]) ?? lurl(x["custom_cover_url"]),
                         total: (e?["total_pages"] as? Int) ?? (x["custom_total_pages"] as? Int), bookURL: e?["book_url"] as? String, sort: x["sort_order"] as? Int ?? 0)
        } }
        shelfOrder = ((try? await O)?.first?["titles"] as? [String]) ?? []
        var c: [String: Int] = [:]; for x in (try? await N) ?? [] { if let t = x["book_title"] as? String { c[lnorm(t), default: 0] += 1 } }; notes = c
        admin = (try? await P)?.first?["role"] as? String == "administrator"
        loaded = true
        await loadGoals(db); await loadClub(db)
    }

    private func loadGoals(_ db: Supa) async {
        let me = db.a.me, tz = TimeZone.current.identifier
        if let g = try? await db.rows("/rest/v1/reading_goals?user_id=eq.\(me)&select=pages_per_day,remind,remind_at,tz").first {
            goal = g["pages_per_day"] as? Int ?? 20; remind = g["remind"] as? Bool ?? true; remindAt = String((g["remind_at"] as? String ?? "19:30").prefix(5))
            if g["tz"] as? String != tz { _ = try? await db.req("PATCH", "/rest/v1/reading_goals?user_id=eq.\(me)", json: ["tz": tz]) }
        } else {
            _ = try? await db.req("POST", "/rest/v1/reading_goals", json: ["user_id": me, "pages_per_day": 20, "remind": true, "remind_at": "19:30", "tz": tz], prefer: "resolution=merge-duplicates,return=minimal")
        }
        await loadDays(db)
    }
    private func loadDays(_ db: Supa) async {
        let from = lday(Date().addingTimeInterval(-400 * 86400))
        guard let rows = try? await db.rows("/rest/v1/reading_days?user_id=eq.\(db.a.me)&day=gte.\(from)&select=day,pages") else { return }
        var m: [String: Int] = [:]; for r in rows { if let d = r["day"] as? String { m[d] = r["pages"] as? Int ?? 0 } }; days = m
    }
    func loadClub(_ db0: Supa? = nil) async {
        var d = db0; if d == nil { d = await db() }
        guard let db = d else { return }
        async let E = db.rows("/rest/v1/club_events?starts_at=gte.\(liso())&select=id,title,description,location,location_url,starts_at,external_url&order=starts_at&limit=12")
        async let S = db.rows("/rest/v1/event_suggestions?status=eq.pending&select=*")
        async let L = db.rows("/rest/v1/worthwhile_links?select=id,user_id,url,title,publication,image_url&order=created_at.desc&limit=20")
        async let K = db.rows("/rest/v1/worthwhile_likes?select=*")
        events = ((try? await E) ?? []).compactMap { x in (x["id"] as? String).map { LEvent(id: $0, title: x["title"] as? String ?? "", details: x["description"] as? String, place: x["location"] as? String, placeURL: x["location_url"] as? String, starts: parseDate(x["starts_at"]), link: (x["external_url"] as? String).flatMap { $0.isEmpty ? nil : $0 }) } }
        sugs = ((try? await S) ?? []).compactMap { x in (x["id"] as? String).map { LSug(id: $0, user: x["user_id"] as? String ?? "", title: x["title"] as? String ?? "", dateRaw: x["event_date"] as? String, place: x["location"] as? String, details: x["description"] as? String) } }
        var likes: [String: Int] = [:]
        for x in (try? await K) ?? [] { if let k = (x["worthwhile_id"] ?? x["link_id"] ?? x["resource_id"]) as? String { likes[k, default: 0] += 1 } }
        links = ((try? await L) ?? []).compactMap { x in (x["id"] as? String).map { LLink(id: $0, user: x["user_id"] as? String ?? "", url: x["url"] as? String ?? "", title: x["title"] as? String ?? "", publication: x["publication"] as? String, image: lurl(x["image_url"]), likes: likes[$0] ?? 0) } }
    }
    func loadMeetings() async {
        guard meetings == nil, let db = await db() else { return }
        let now = liso()
        async let E = db.rows("/rest/v1/club_events?starts_at=lt.\(now)&select=id,title,location,starts_at&order=starts_at.desc&limit=40")
        async let U = db.rows("/rest/v1/club_updates?study_at=lt.\(now)&select=id,book_title,reading_position,study_at,study_location&order=study_at.desc&limit=40")
        var out: [LMeeting] = [], seen = Set<String>()
        for x in (try? await E) ?? [] { out.append(LMeeting(id: "e\(x["id"] as? String ?? "")", title: x["title"] as? String ?? "", when: parseDate(x["starts_at"]), place: x["location"] as? String)) }
        for x in (try? await U) ?? [] {
            let k = "\(x["study_at"] as? String ?? "")\(x["book_title"] as? String ?? "")"; if seen.contains(k) { continue }; seen.insert(k)
            let pos = x["reading_position"] as? String
            out.append(LMeeting(id: "u\(x["id"] as? String ?? "")", title: lshort(x["book_title"] as? String ?? "") + ((pos ?? "TBD") != "TBD" && !(pos ?? "").isEmpty ? " · \(pos!)" : ""), when: parseDate(x["study_at"]), place: x["study_location"] as? String))
        }
        meetings = out.sorted { $0.when > $1.when }
    }

    // MARK: actions on your own books

    func log(_ r: LRead, _ page: Int) async {
        guard let db = await db() else { return }
        do {
            _ = try await db.req("POST", "/rest/v1/rpc/log_reading_progress", json: ["p_read_id": r.id, "p_current_page": page, "p_log_date": lday()])
            Haptic.tap(); say(r.total != nil && page >= r.total! ? "Finished — well read" : "Logged page \(page)")
            await load()
        } catch { say(error.localizedDescription) }
    }
    func setStatus(_ r: LRead, _ status: String) async {
        guard let db = await db() else { return }
        var row: [String: Any] = ["status": status, "finished_at": status == "finished" ? lday() as Any : NSNull(), "updated_at": liso()]
        if status == "finished", let t = r.total { row["current_page"] = t }
        if status == "reading" && r.status == "want" { row["started_at"] = lday() }
        do { _ = try await db.req("PATCH", "/rest/v1/current_reads?id=eq.\(r.id)", json: row) } catch { say(error.localizedDescription) }
        await load()
    }
    func remove(_ r: LRead) async { _ = try? await db()?.req("DELETE", "/rest/v1/current_reads?id=eq.\(r.id)"); await load() }

    func edition(_ f: LFound) async -> String? {
        guard let db = await db() else { return nil }
        if let i = f.isbn, !i.isEmpty, let id = try? await db.rows("/rest/v1/editions?isbn13=eq.\(i)&select=id").first?["id"] as? String { return id }
        let row: [String: Any] = ["isbn13": nz(f.isbn), "title": f.title, "author": nz(f.author), "publisher": nz(f.publisher), "publication_year": nz(f.year.flatMap { Int($0) }),
                                  "total_pages": nz(f.pages), "cover_url": nz(f.cover), "book_url": nz(f.bookURL), "edition_label": nz(f.label), "created_by": db.a.me]
        do {
            let d = try await db.req("POST", "/rest/v1/editions?select=id", json: row, prefer: "return=representation")
            return ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]])?.first?["id"] as? String
        } catch { say(error.localizedDescription); return nil }
    }
    static func search(_ q: String) async -> [LFound] {
        let t = q.trimmingCharacters(in: .whitespaces), v = t.replacingOccurrences(of: #"[-\s]"#, with: "", options: .regularExpression)
        let key = v.range(of: #"^\d{9}[\dXx]$|^\d{13}$"#, options: .regularExpression) != nil ? ["isbn": v] : t.range(of: #"^https?:|amzn\.|a\.co/"#, options: [.regularExpression, .caseInsensitive]) != nil ? ["url": t] : ["q": t]
        let res = (await site("book-lookup", key))?["results"] as? [[String: Any]] ?? []
        return res.map { x in LFound(title: x["title"] as? String ?? "", author: x["author"] as? String, publisher: x["publisher"] as? String, year: (x["publication_year"] as? String) ?? (x["publication_year"] as? Int).map(String.init),
                                     pages: x["total_pages"] as? Int, cover: x["cover_url"] as? String, bookURL: x["book_url"] as? String, label: x["edition_label"] as? String, isbn: x["isbn13"] as? String) }
    }
    func add(_ f: LFound, want: Bool) async {
        guard let eid = await edition(f), let db = await db() else { return }
        do {
            _ = try await db.req("POST", "/rest/v1/current_reads", json: ["user_id": db.a.me, "edition_id": eid, "status": want ? "want" : "reading", "current_page": 0, "sort_order": front, "started_at": lday()])
            say("Added \(f.title)"); await load()
        } catch { say(error.localizedDescription) }
    }
    func addByHand(title: String, author: String, pages: String, want: Bool) async {
        guard let db = await db() else { return }
        do {
            _ = try await db.req("POST", "/rest/v1/current_reads", json: ["user_id": db.a.me, "custom_title": title, "custom_author": ne(author), "custom_total_pages": nz(Int(pages)), "status": want ? "want" : "reading", "current_page": 0, "sort_order": front])
            await load()
        } catch { say(error.localizedDescription) }
    }
    /// A club book needs a catalogued edition: one a member already added, else the book lookup (Amazon link, then title).
    private func clubEdition(title: String, author: String?, url: String?, cover: URL?) async -> String? {
        guard let db = await db() else { return nil }
        let t = lshort(title).replacingOccurrences(of: #"[%_*(),]"#, with: "", options: .regularExpression)
        let q = "\(t)*".addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? t
        if let id = try? await db.rows("/rest/v1/editions?title=ilike.\(q)&select=id&limit=1").first?["id"] as? String { return id }
        var tries: [String] = []
        if let url, url.range(of: #"amazon\.|amzn\.|a\.co/"#, options: [.regularExpression, .caseInsensitive]) != nil { tries.append(url) }
        tries.append([lshort(title), author].compactMap { $0 }.joined(separator: " "))
        for q in tries {
            if var f = (await Self.search(q)).first(where: { !($0.isbn ?? "").isEmpty }) { if let cover { f.cover = cover.absoluteString }; return await edition(f) }
        }
        say("Couldn’t find this edition. Add it with “Add a book”."); return nil
    }
    func joinClub(_ b: LUpdate) async {
        if busy { return }; busy = true; defer { busy = false }
        let k = "club" + b.id; ghost[k] = "adding"; Haptic.tap()
        guard let eid = await clubEdition(title: b.title, author: b.author, url: b.bookURL, cover: b.cover), let db = await db() else { ghost[k] = nil; return }
        do {
            _ = try await db.req("POST", "/rest/v1/current_reads", json: ["user_id": db.a.me, "edition_id": eid, "custom_title": lshort(b.title), "custom_author": nz(b.author), "custom_cover_url": nz(b.cover?.absoluteString),
                                                                         "status": "reading", "current_page": 0, "sort_order": front, "started_at": lday()])
            ghost[k] = "added"; try? await Task.sleep(nanoseconds: 650_000_000); await load(); ghost[k] = nil
        } catch { ghost[k] = nil; say(error.localizedDescription.lowercased().contains("duplicate") ? "Already in your library" : error.localizedDescription) }
    }
    func addFinished(_ b: LPast) async {
        if busy { return }; busy = true; defer { busy = false }
        let k = "lotmdone" + b.id; ghost[k] = "adding"; Haptic.tap()
        guard let eid = await clubEdition(title: b.title, author: b.author, url: b.bookURL, cover: b.cover), let db = await db() else { ghost[k] = nil; return }
        let pages = (try? await db.rows("/rest/v1/editions?id=eq.\(eid)&select=total_pages").first?["total_pages"] as? Int) ?? 0, day = lday(b.created)
        do {
            _ = try await db.req("POST", "/rest/v1/current_reads", json: ["user_id": db.a.me, "edition_id": eid, "custom_title": lshort(b.title), "custom_author": nz(b.author), "custom_cover_url": nz(b.cover?.absoluteString),
                                                                         "status": "finished", "current_page": pages, "started_at": day, "finished_at": day, "sort_order": front])
            ghost[k] = "added"; try? await Task.sleep(nanoseconds: 650_000_000); await load(); ghost[k] = nil
        } catch { ghost[k] = nil; say(error.localizedDescription.lowercased().contains("duplicate") ? "Already in your library" : error.localizedDescription) }
    }

    /// The order you set by carrying a cover along the shelf.
    func reorderReads(_ ids: [String]) async {
        let base = reads.filter { ids.contains($0.id) }.map(\.sort).min() ?? 0
        for (i, id) in ids.enumerated() { if let k = reads.firstIndex(where: { $0.id == id }) { reads[k].sort = base + i } }
        reads = reads.enumerated().sorted { a, b in a.element.sort != b.element.sort ? a.element.sort < b.element.sort : a.offset < b.offset }.map { $0.element }
        guard let db = await db() else { return }
        await withTaskGroup(of: Void.self) { g in
            for (i, id) in ids.enumerated() { g.addTask { _ = try? await db.req("PATCH", "/rest/v1/current_reads?id=eq.\(id)", json: ["sort_order": base + i]) } }
        }
    }
    func reorderClub(_ ids: [String]) async {
        let titles: [String] = ids.compactMap { id in
            if let b = current.first(where: { $0.id == id }) { return lnorm(b.title) }
            if let b = past.first(where: { "done" + $0.id == id }) { return lnorm(b.title) }
            return nil
        }
        shelfOrder = titles
        guard let db = await db() else { return }
        do { _ = try await db.req("POST", "/rest/v1/club_shelf_order?on_conflict=year", json: ["year": year, "titles": titles, "updated_by": db.a.me, "updated_at": liso()], prefer: "resolution=merge-duplicates,return=minimal") }
        catch { say(error.localizedDescription) }
    }

    // MARK: goals, events, links, club updates

    /// Set by hand how many pages were read on a day (pages logged on books later that day add to it).
    func setDay(_ d: Date, _ pages: Int) async {
        let k = lday(d), was = days[k]
        days[k] = pages
        do { _ = try await db()?.req("POST", "/rest/v1/rpc/set_reading_day", json: ["p_day": k, "p_pages": pages]); Haptic.tap() }
        catch { days[k] = was; say(error.localizedDescription) }
    }
    func saveGoal(_ n: Int, remind r: Bool, at: String) async {
        goal = n; remind = r; remindAt = at
        _ = try? await db()?.req("PATCH", "/rest/v1/reading_goals?user_id=eq.\(me)", json: ["pages_per_day": n, "remind": r, "remind_at": at, "last_reminded": NSNull(), "updated_at": liso()])
    }
    func saveEvent(title: String, when: Date, place: String, details: String, link: String) async {
        guard let db = await db() else { return }
        let loc: Any = ne(place)
        do {
            if admin {
                _ = try await db.req("POST", "/rest/v1/club_events", json: ["title": title, "starts_at": liso(when), "location": loc, "external_url": ne(link), "description": ne(details), "created_by": db.a.me, "source": "app"])
                say("Added to the calendar")
            } else {
                let d = [details, link].filter { !$0.isEmpty }.joined(separator: "\n")
                _ = try await db.req("POST", "/rest/v1/event_suggestions", json: ["user_id": db.a.me, "title": title, "event_date": liso(when), "location": loc, "description": ne(d), "status": "pending"])
                say("Suggestion sent to the administrators")
            }
            await loadClub(db); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil)
        } catch { say(error.localizedDescription) }
    }
    func approve(_ s: LSug, _ ok: Bool) async {
        guard let db = await db() else { return }
        if ok {
            do { _ = try await db.req("POST", "/rest/v1/club_events", json: ["title": s.title, "starts_at": s.dateRaw ?? liso(), "location": nz(s.place), "description": nz(s.details), "created_by": db.a.me, "source": "suggestion"]) }
            catch { say(error.localizedDescription); return }
        }
        _ = try? await db.req("PATCH", "/rest/v1/event_suggestions?id=eq.\(s.id)", json: ["status": ok ? "approved" : "declined", "reviewed_by": db.a.me, "reviewed_at": liso()])
        await loadClub(db); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil)
    }
    func removeEvent(_ e: LEvent) async { _ = try? await db()?.req("DELETE", "/rest/v1/club_events?id=eq.\(e.id)"); await loadClub(); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil) }
    func shareLink(url: String, title: String, publication: String, image: String, blurb: String) async {
        guard let db = await db() else { return }
        do {
            _ = try await db.req("POST", "/rest/v1/worthwhile_links", json: ["user_id": db.a.me, "url": url, "title": title, "publication": ne(publication), "image_url": ne(image), "blurb": ne(blurb)])
            await loadClub(db)
        } catch { say(error.localizedDescription) }
    }
    func openLink(_ l: LLink) {
        Task { _ = try? await db()?.req("POST", "/rest/v1/rpc/increment_worthwhile_view", json: ["resource_id": l.id]) }
        if let u = URL(string: l.url) { UIApplication.shared.open(u) }
    }
    func postUpdate(_ row: [String: Any]) async -> Bool {
        guard let db = await db() else { return false }
        var r = row; r["created_by"] = db.a.me
        do { _ = try await db.req("POST", "/rest/v1/club_updates", json: r); say("Reading updated"); await load(); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil); return true }
        catch { say(error.localizedDescription); return false }
    }
    func completeForClub(_ b: LUpdate) async {
        guard let db = await db() else { return }
        do {
            _ = try await db.req("POST", "/rest/v1/books_read", json: ["title": lshort(b.title), "author": nz(b.author), "cover_url": nz(b.cover?.absoluteString), "book_url": nz(b.bookURL), "created_by": db.a.me])
            say("Marked complete for LOTM"); await load()
        } catch { say(error.localizedDescription) }
    }
}

/// The web tells the app when its own Library tabs are used (only the Commonplace pane is still the web's).
final class LibHandler: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let v = m.body as? String else { return }
        DispatchQueue.main.async { self.model?.setLibPane(v, tellWeb: false) }
    }
}
extension WebModel {
    func setLibPane(_ v: String, tellWeb: Bool = true) {
        if libPane != v { libPane = v; UserDefaults.standard.set(v, forKey: "lotm.libPane") }
        if false, tellWeb { view.evaluateJavaScript("try{localStorage.setItem('lotm.library','\(v)');dispatchEvent(new Event('lotm:library'))}catch(e){}", completionHandler: nil) }
    }
}

// MARK: - Small pieces

private struct LBtn: ButtonStyle {
    var ghost = false, h: CGFloat = 44
    func makeBody(configuration c: Configuration) -> some View {
        c.label.font(.sans(14, .bold)).foregroundStyle(ghost ? T.ink : T.paper).padding(.horizontal, 18).frame(maxWidth: .infinity).frame(height: h)
            .background(Capsule().fill(ghost ? Color(rgb: 0x0c0e08, 0.08) : T.ink)).opacity(c.isPressed ? 0.7 : 1)
    }
}
private struct LField: View {
    let label: String; @Binding var text: String; var hint = ""; var number = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.sans(12, .bold)).tracking(0.7).foregroundStyle(T.muted)
            TextField("", text: $text, prompt: Text(hint).foregroundColor(T.muted), axis: .vertical).keyboardType(number ? .numberPad : .default)
                .font(.sans(16)).foregroundStyle(T.ink).padding(.horizontal, 14).padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.softBd))
        }
    }
}
private struct H2: View {
    let t: String; var action: String? = nil; var run: () -> Void = {}
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(t).font(.serif(20, .semibold)).foregroundStyle(T.ink)
            Spacer()
            if let action { Button(action: run) { Text("\(action) ›").font(.sans(14, .semibold)).foregroundStyle(Color(rgb: 0xd0ceb9)) }.buttonStyle(.plain) }
        }
        .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 8)
    }
}
private struct CoverArt: View {
    let url: URL?, shade: Color
    var body: some View { ZStack { shade; if let url { AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear } } } }
}
private struct Bar: View {
    let pct: Int
    var body: some View {
        HStack(spacing: 8) {
            GeometryReader { g in ZStack(alignment: .leading) { Capsule().fill(Color(rgb: 0x4a4c35)); Capsule().fill(Color(rgb: 0x3f7d4f)).frame(width: g.size.width * CGFloat(pct) / 100) } }.frame(height: 4)
            Text("\(pct)%").font(.sans(12, .semibold)).foregroundStyle(T.ink)
        }
        .frame(width: 170)
    }
}

// MARK: - A shelf of covers (the web's Cover Flow): the middle book is the chosen one; tap it to turn it over or open it

struct ShelfItem: Identifiable {
    let id: String
    var title: String, by: String? = nil, cover: URL? = nil, shade: Color = Color(rgb: 0x55583d)
    var plus = false, ghost: String? = nil
    var movable = false
    var sub: AnyView? = nil
    var back: ((@escaping () -> Void) -> AnyView)? = nil
    var open: () -> Void = {}
}

/// The covers, set where the web's `place()` put them for their distance from the middle. `pos` animates, so a
/// flick coasts and settles through every position in between.
private struct Flow: View, Animatable {
    var pos: Double
    let items: [ShelfItem]
    let w: CGFloat, h: CGFloat
    let cover: (ShelfItem, Int, Double) -> AnyView
    var animatableData: Double { get { pos } set { pos = newValue } }
    var body: some View {
        ZStack(alignment: .top) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, it in
                let d = Double(i) - pos, a = abs(d), near = min(a, 1), far = max(0, a - 1)
                let scale = 700 / (700 + 130 * near + 26 * far)
                let x = (d < 0 ? -1.0 : 1.0) * (near * Double(w) * 0.74 + far * Double(w) * 0.3) * scale
                if a < 7 {
                    cover(it, i, min(a, 2.6) * 0.17)
                        .scaleEffect(scale)
                        .offset(x: x)
                        .zIndex(1000 - a * 10)
                }
            }
        }
        .frame(maxWidth: .infinity).padding(.top, 6).frame(height: (h * 1.14).rounded(), alignment: .top)
    }
}

/// Cover Flow as the web drew it: the middle book forward, the others stepped back behind it and darker, overlapping
/// like a Rolodex. Drag to move, flick to coast; it always comes to rest on a cover. Tap the middle book to turn it over.
/// The shelf's touches, taken with UIKit's own recognizers on the page's scroll view. A pan is ours only if it sets off
/// sideways, so a swipe up or down anywhere on the covers scrolls the page as it would anywhere else; a hold picks a book up.
private struct ShelfTouch: UIViewRepresentable {
    var pan: (UIGestureRecognizer.State, CGFloat, CGFloat) -> Void
    var hold: (UIGestureRecognizer.State, CGPoint, CGFloat, CGFloat) -> Void
    func makeUIView(context: Context) -> Catcher { let v = Catcher(); v.pan = pan; v.hold = hold; return v }
    func updateUIView(_ v: Catcher, context: Context) { v.pan = pan; v.hold = hold }
    static func dismantleUIView(_ v: Catcher, coordinator: ()) { v.detach() }

    final class Catcher: UIView, UIGestureRecognizerDelegate {
        var pan: (UIGestureRecognizer.State, CGFloat, CGFloat) -> Void = { _, _, _ in }
        var hold: (UIGestureRecognizer.State, CGPoint, CGFloat, CGFloat) -> Void = { _, _, _, _ in }
        private lazy var panG: UIPanGestureRecognizer = { let g = UIPanGestureRecognizer(target: self, action: #selector(onPan)); g.delegate = self; g.maximumNumberOfTouches = 1; g.cancelsTouchesInView = false; return g }()
        private lazy var holdG: UILongPressGestureRecognizer = { let g = UILongPressGestureRecognizer(target: self, action: #selector(onHold)); g.delegate = self; g.minimumPressDuration = 0.42; g.cancelsTouchesInView = false; return g }()
        private weak var host: UIView?
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false; backgroundColor = .clear }
        required init?(coder: NSCoder) { fatalError() }
        override func didMoveToWindow() {
            super.didMoveToWindow(); detach()
            guard window != nil else { return }
            var s: UIView? = superview
            while let x = s, !(x is UIScrollView) { s = x.superview }
            guard let target = s ?? window else { return }
            target.addGestureRecognizer(panG); target.addGestureRecognizer(holdG); host = target
        }
        func detach() { host?.removeGestureRecognizer(panG); host?.removeGestureRecognizer(holdG); host = nil }
        /// The page lets go of the touch while the shelf has it.
        private func takeFromPage() { if let sc = host as? UIScrollView { sc.panGestureRecognizer.isEnabled = false; sc.panGestureRecognizer.isEnabled = true } }
        override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard window != nil, bounds.contains(g.location(in: self)) else { return false }
            if g === panG { let v = panG.velocity(in: self); return abs(v.x) > abs(v.y) * 1.2 }
            return true
        }
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith o: UIGestureRecognizer) -> Bool { true }
        @objc private func onPan() {
            if panG.state == .began { takeFromPage() }
            pan(panG.state, panG.translation(in: self).x, panG.velocity(in: self).x)
        }
        @objc private func onHold() {
            if holdG.state == .began { takeFromPage() }
            hold(holdG.state, holdG.location(in: self), bounds.width, holdG.location(in: nil).x)
        }
    }
}

struct Shelf: View {
    let items: [ShelfItem]
    var w: CGFloat = 124
    var start = 0
    var flipNow = 0
    var onCenter: (String) -> Void = { _ in }
    var onDrag: (Bool) -> Void = { _ in }
    /// Hold a cover, then drag: it is carried along the shelf and set down where it is let go.
    var onReorder: ([String]) -> Void = { _ in }
    @State private var order: [String]?
    @State private var moving: String?
    @State private var moveFrom = 0
    @State private var auto = 0                     // places gained by holding the book at an edge
    @State private var edge = 0                     // -1 held at the left edge, 1 at the right
    @State private var lastDX = 0.0
    @State private var holdX = 0.0
    @State private var pos: Double = 0
    @State private var from: Double?
    @State private var flipped: String?
    @State private var placed = false
    private var live: [ShelfItem] {
        guard let order, order.count == items.count else { return items }
        let by = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let out = order.compactMap { by[$0] }
        return out.count == items.count ? out : items
    }
    private var h: CGFloat { (w * 1.5).rounded() }
    private var unit: Double { Double(w) * 0.95 }
    private var last: Int { max(0, live.count - 1) }
    private var active: Int { max(0, min(last, Int(pos.rounded()))) }
    private var mid: ShelfItem? { live.isEmpty ? nil : live[active] }
    private let settle = Animation.spring(response: 0.5, dampingFraction: 0.82)
    private func go(_ i: Int) { withAnimation(settle) { pos = Double(max(0, min(last, i))) } }

    /// A sideways drag of the shelf (from UIKit, so an up-and-down swipe is never ours and always scrolls the page).
    private func panned(_ st: UIGestureRecognizer.State, _ tx: CGFloat, _ vx: CGFloat) {
        if moving != nil { return }
        switch st {
        case .began: from = pos; flipped = nil; onDrag(true)
        case .changed:
            guard let f = from else { return }
            var p = f - Double(tx) / unit
            if p < 0 { p *= 0.35 }; if p > Double(last) { p = Double(last) + (p - Double(last)) * 0.35 }      // rubber band at the ends
            pos = p
        default:
            guard let f = from else { return }
            from = nil; onDrag(false)
            let rest = max(0, min(Double(last), f - Double(tx) / unit)), coast = max(-2.5, min(2.5, -Double(vx) * 0.16 / unit))
            go(Int((rest + coast).rounded()))
        }
    }
    /// A hold on a cover picks it up; moving the finger carries it; letting go sets it down.
    private func held(_ st: UIGestureRecognizer.State, _ at: CGPoint, _ width: CGFloat, _ screenX: CGFloat) {
        switch st {
        case .began:
            guard moving == nil, from == nil else { return }
            // which cover is under the finger (the nearer the middle, the further forward it sits)
            var hit: Int?
            for i in live.indices.sorted(by: { abs(Double($0) - pos) < abs(Double($1) - pos) }) {
                let d = Double(i) - pos, a = abs(d), near = min(a, 1), far = max(0, a - 1), scale = 700 / (700 + 130 * near + 26 * far)
                let cx = Double(width) / 2 + (d < 0 ? -1.0 : 1.0) * (near * Double(w) * 0.74 + far * Double(w) * 0.3) * scale
                if abs(Double(at.x) - cx) <= Double(w) * scale / 2 { hit = i; break }
            }
            guard let i = hit, live[i].movable, flipped != live[i].id else { return }
            order = live.map(\.id); moving = live[i].id; moveFrom = i; auto = 0; edge = 0; lastDX = 0; holdX = Double(at.x); flipped = nil; onDrag(true)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            withAnimation(settle) { pos = Double(i) }
        case .changed:
            guard moving != nil else { return }
            let W = UIScreen.main.bounds.width
            edge = screenX < 64 ? -1 : screenX > W - 64 ? 1 : 0
            lastDX = Double(at.x) - holdX; carry()
        default: drop()
        }
    }
    /// Carry the held book to the place its drag (and any time held at an edge) has reached.
    private func carry() {
        guard let id = moving, var ids = order, let cur = ids.firstIndex(of: id) else { return }
        let ok = live.indices.filter { live[$0].movable }      // it may only travel among the books that can themselves be moved
        guard let lo = ok.first, let hi = ok.last else { return }
        let want = moveFrom + auto + Int((lastDX / 64).rounded())
        let to = max(lo, min(hi, want))
        if want != to { auto -= want - to }
        if to != cur { ids.remove(at: cur); ids.insert(id, at: to); Haptic.tap(); withAnimation(.snappy(duration: 0.26)) { order = ids; pos = Double(to) } }
    }
    private func drop() {
        guard moving != nil else { return }
        let ids = live.filter(\.movable).map(\.id), was = items.filter(\.movable).map(\.id)
        moving = nil; edge = 0; auto = 0; lastDX = 0; onDrag(false)
        if ids != was { onReorder(ids) } else { order = nil }
    }

    var body: some View {
        VStack(spacing: 0) {
            Flow(pos: pos, items: live, w: w, h: h) { it, i, shade in AnyView(card(it, i, shade: shade)) }
                .contentShape(Rectangle())
                .background(ShelfTouch(pan: panned, hold: held))
            VStack(spacing: 1) {
                Text(mid?.title ?? " ").font(.serif(16, .semibold)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.center)
                if let by = mid?.by, !by.isEmpty { Text("by \(by)").font(.serif(14, italic: true)).foregroundStyle(T.muted).lineLimit(1) }
                if let s = mid?.sub { s.padding(.top, 3) }
            }
            .padding(.horizontal, 24).frame(maxWidth: .infinity, minHeight: 64, alignment: .top)
        }
        .onAppear { open() }
        // Held at an edge, the book keeps travelling that way.
        .task(id: moving) {
            while moving != nil, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 320_000_000)
                if moving != nil, edge != 0 { auto += edge; carry() }
            }
        }
        .onChange(of: items.map(\.id)) { _, _ in order = nil }
        .onChange(of: live.map(\.id)) { _, _ in if moving != nil { return }; if pos > Double(last) { pos = Double(last) }; open() }
        .onChange(of: active) { _, _ in
            guard placed, let m = mid else { return }
            Haptic.tap(); flipped = nil; onCenter(m.id)
        }
        .onChange(of: flipNow) { _, _ in
            guard !live.isEmpty else { return }
            var i = active
            if live[i].back == nil { guard let k = live.firstIndex(where: { $0.back != nil }) else { return }; i = k }
            let id = live[i].id
            let turn = { withAnimation(.spring(response: 0.55, dampingFraction: 0.75)) { flipped = id }; Haptic.tap() }
            if i == active { turn() } else { go(i); DispatchQueue.main.asyncAfter(deadline: .now() + 0.52, execute: turn) }
        }
    }
    /// Until its books have arrived, the shelf stays opened on its starting book.
    private func open() {
        guard !live.isEmpty, !placed else { return }
        let i = min(start, last)
        pos = Double(i); onCenter(live[i].id)
        if live.count > max(1, start) { DispatchQueue.main.async { placed = true } }
    }

    @ViewBuilder private func card(_ it: ShelfItem, _ i: Int, shade: Double) -> some View {
        let on = flipped == it.id
        ZStack {
            let face = front(it).overlay(Color(rgb: 0x0d0f08).opacity(shade).clipShape(RoundedRectangle(cornerRadius: 4)))
            // its reflection on the shelf, fading out below it
            face.scaleEffect(x: 1, y: -1)
                .mask(LinearGradient(stops: [.init(color: .white.opacity(0.22), location: 0), .init(color: .clear, location: 0.42)], startPoint: .top, endPoint: .bottom))
                .offset(y: h + 3).opacity(on ? 0 : 1).allowsHitTesting(false)
            face.opacity(on ? 0 : 1)
            if on, let back = it.back {
                back { withAnimation(.spring(response: 0.55, dampingFraction: 0.75)) { flipped = nil } }
                    .frame(width: w, height: h)
                    .background(LinearGradient(colors: [Color(rgb: 0xf4f1e2), Color(rgb: 0xdcd8c2)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .rotation3DEffect(.degrees(180), axis: (0, 1, 0))
            }
        }
        .frame(width: w, height: h)
        .scaleEffect(moving == it.id ? 1.08 : 1).animation(.spring(response: 0.3, dampingFraction: 0.7), value: moving)
        .shadow(color: .black.opacity(moving == it.id ? 0.55 : 0.35), radius: moving == it.id ? 20 : 12, y: 10)
        .rotation3DEffect(.degrees(on ? 180 : 0), axis: (0, 1, 0), perspective: 0.5)
        .contentShape(Rectangle())
        .onTapGesture {
            guard !on else { return }
            if i != active { go(i); return }
            Haptic.tap()
            if it.back != nil { withAnimation(.spring(response: 0.55, dampingFraction: 0.75)) { flipped = it.id } } else { it.open() }
        }
        .accessibilityLabel(it.title).accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private func front(_ it: ShelfItem) -> some View {
        if it.plus {
            RoundedRectangle(cornerRadius: 4).fill(Color(rgb: 0x55583d))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(rgb: 0x8a8d6a), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                .overlay(Text("+").font(.sans(40)).foregroundStyle(T.ink))
        } else if let g = it.ghost {
            ZStack {
                CoverArt(url: it.cover, shade: Color(rgb: 0x2f3122)).brightness(g.isEmpty ? -0.42 : 0).saturation(g.isEmpty ? 0.7 : 1)
                Image(systemName: g == "added" ? "checkmark" : "plus").font(.system(size: 18, weight: .bold)).foregroundStyle(T.cream)
                    .rotationEffect(.degrees(g == "adding" ? 90 : 0))
                    .frame(width: 46, height: 46).background(Circle().fill(g == "added" ? Color(rgb: 0x3f7d4f) : Color(rgb: 0x0c0e08, 0.35))).overlay(Circle().stroke(T.cream.opacity(0.85), lineWidth: 1.5))
            }
            .clipShape(RoundedRectangle(cornerRadius: 4)).animation(.easeOut(duration: 0.4), value: g)
        } else {
            CoverArt(url: it.cover, shade: it.shade).clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}

/// The back of your own book: a page wheel (the page is logged a moment after the wheel comes to rest), or a button
/// to start it; the book's menu sits at the foot. Tap the card, or move to another book, to turn it back.
private struct CoverBack: View {
    let r: LRead
    @ObservedObject var m: LibraryModel
    let close: () -> Void
    @State private var n: Int
    @State private var confirmRemove = false
    @State private var pending: Task<Void, Never>?
    init(r: LRead, m: LibraryModel, close: @escaping () -> Void) { self.r = r; self.m = m; self.close = close; _n = State(initialValue: r.page) }
    private var maxPage: Int { r.total ?? max(1000, r.page + 500) }
    private let dark = Color(rgb: 0x20231a)
    private let green = Color(rgb: 0x3f7d4f)
    var body: some View {
        VStack(spacing: 0) {
            Menu {
                if r.status != "finished" { Button { close(); Task { await m.setStatus(r, "finished") } } label: { Label("Mark complete", systemImage: "checkmark") } }
                Button { UIApplication.shared.open(amazon(r.title, r.author, r.bookURL)) } label: { Label("Amazon", systemImage: "arrow.up.right") }
                Button(role: .destructive) { confirmRemove = true } label: { Label("Remove", systemImage: "trash") }
            } label: { Image(systemName: "ellipsis").font(.system(size: 16, weight: .bold)).foregroundStyle(dark.opacity(0.7)).frame(width: 56, height: 32).contentShape(Rectangle()) }
            .padding(.top, 4).accessibilityLabel("More for this book")
            if r.status == "reading" || r.status == "paused" {
                Spacer(minLength: 0)
                // The page you last logged is marked on the wheel with a ribbon, in green.
                Picker("Page", selection: $n) {
                    ForEach(0...maxPage, id: \.self) { p in
                        HStack(spacing: 4) {
                            if p == r.page && p > 0 { Image(systemName: "bookmark.fill").font(.system(size: 10)).foregroundStyle(green) }
                            Text("\(p)").font(.serif(21, .semibold)).foregroundStyle(p == r.page && p > 0 ? green : dark)
                        }
                    }
                }
                .pickerStyle(.wheel).frame(width: 110, height: 124).clipped().environment(\.colorScheme, .light)
                Text(r.total.map { "of \($0)" } ?? "page").font(.sans(12)).foregroundStyle(Color(rgb: 0x6b6e55)).padding(.top, 2)
                Button { withAnimation { n = r.page } } label: {
                    HStack(spacing: 4) { Image(systemName: "bookmark.fill").font(.system(size: 9)); Text("Last read: p. \(r.page)").font(.sans(11.5, .semibold)) }.foregroundStyle(green).padding(.horizontal, 8).frame(height: 24)
                }
                .buttonStyle(.plain).opacity(n != r.page && r.page > 0 ? 1 : 0).animation(.easeOut(duration: 0.2), value: n != r.page)
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                Button { close(); Task { await m.setStatus(r, "reading") } } label: {
                    Text(r.status == "want" ? "Start reading" : "Read again").font(.sans(14, .bold)).foregroundStyle(T.cream).frame(maxWidth: .infinity).frame(height: 40).background(Capsule().fill(T.paper))
                }
                .padding(.horizontal, 14)
                Spacer(minLength: 0)
                Color.clear.frame(height: 32)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { close() }
        .onChange(of: n) { _, page in
            pending?.cancel()
            guard page != r.page else { return }
            pending = Task { try? await Task.sleep(nanoseconds: 900_000_000); if !Task.isCancelled { await m.log(r, page) } }
        }
        .confirmationDialog("Remove this book from your library?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { close(); Task { await m.remove(r) } }
        }
    }
}

// MARK: - The screen

struct LibraryScreen: View {
    @ObservedObject var m: LibraryModel
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @Namespace private var segNS
    @State private var shelfDrag = false
    @State private var flipNow = 0
    @State private var searching: Bool?            // nil closed; true = want to read
    @State private var byHand: Bool?
    @State private var clubBook: LUpdate?
    @State private var clubKey = ""
    @State private var editing: UpdateDraft?
    @State private var clubSearch = false
    @State private var goalSheet = false
    @State private var editDay: DayPick?
    @State private var eventForm = false
    @State private var linkForm = false
    @State private var pastOpen = false

    /// The room the tabs take at the top of the Library (the Notes page sits under them).
    static let tabsHeight: CGFloat = 54
    static func paneIndex(_ v: String) -> CGFloat { v == "mine" ? 0 : v == "club" ? 2 : 1 }
    static let slide = Animation.smooth(duration: 0.36)

    var body: some View {
        VStack(spacing: 0) {
            // The tabs stay; the three panes slide beneath them like pages.
            HStack(spacing: 0) {
                ForEach([("mine", "My Library"), ("notes", "Notes"), ("club", "LOTM")], id: \.0) { v, t in
                    let on = web.libPane == v
                    Button { Haptic.tap(); web.setLibPane(v) } label: {
                        Text(t).font(.sans(14, on ? .semibold : .regular)).foregroundStyle(T.ink).frame(maxWidth: .infinity).frame(height: 34)
                            .background { if on { Capsule().fill(T.card).shadow(color: .black.opacity(0.12), radius: 1.5, y: 1).matchedGeometryEffect(id: "on", in: segNS) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(3).background(RoundedRectangle(cornerRadius: 20).fill(Color(rgb: 0x0c0e08, 0.08)))
            .padding(.horizontal, 20).padding(.top, 8).frame(height: Self.tabsHeight, alignment: .top)
            // (the screen's own width, so arriving on this tab never sets the panes moving)
            ZStack {
                page { mine }.offset(x: (0 - Self.paneIndex(web.libPane)) * UIScreen.main.bounds.width)
                NotesPane(m: NotesModel.shared, feed: feed, web: web).offset(x: (1 - Self.paneIndex(web.libPane)) * UIScreen.main.bounds.width)
                page { club }.offset(x: (2 - Self.paneIndex(web.libPane)) * UIScreen.main.bounds.width)
            }
            .clipped()
        }
        .animation(Self.slide, value: web.libPane)
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark).tint(T.ink)
        .overlay(alignment: .bottom) {
            if let t = m.toast { Text(t).font(.sans(14, .semibold)).foregroundStyle(T.paper).padding(.horizontal, 16).padding(.vertical, 10).background(Capsule().fill(T.ink)).padding(.bottom, 150).transition(.opacity) }
        }
        .animation(.easeOut(duration: 0.2), value: m.toast)
        .task { m.feed = feed; await m.load() }
        .sheet(isPresented: Binding(get: { searching != nil }, set: { if !$0 { searching = nil } })) {
            let want = searching ?? false
            BookSearch(title: want ? "Want to read" : "Add a book", cta: "Add to my library", manual: { searching = nil; byHand = want }) { f in searching = nil; Task { await m.add(f, want: want) } }
        }
        .sheet(isPresented: Binding(get: { byHand != nil }, set: { if !$0 { byHand = nil } })) { ByHand(want: byHand ?? false) { t, a, p in let w = byHand ?? false; byHand = nil; Task { await m.addByHand(title: t, author: a, pages: p, want: w) } }.presentationDetents([.medium]) }
        .sheet(item: $clubBook) { b in ClubBookSheet(b: b, m: m) { clubBook = nil }.presentationDetents([.medium]) }
        .sheet(isPresented: $clubSearch) {
            BookSearch(title: "Add a club book", cta: "Use this book", manual: { clubSearch = false; let d = pending ?? UpdateDraft(); pending = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { editing = d } }) { f in
                clubSearch = false
                var d = pending ?? UpdateDraft(); pending = nil
                d.title = f.title; d.author = f.author ?? ""; d.cover = f.cover; d.bookURL = f.bookURL; d.publisher = f.publisher
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { editing = d }
            }
        }
        .sheet(item: $editing) { d in UpdateSheet(d: d, m: m, find: { cur in editing = nil; pending = cur; DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { clubSearch = true } }) { editing = nil } }
        .sheet(item: $editDay) { d in DaySheet(m: m, day: d.date) { editDay = nil }.presentationDetents([.height(330)]) }
        .sheet(isPresented: $goalSheet) { GoalSheet(m: m) { goalSheet = false }.presentationDetents([.medium]) }
        .sheet(isPresented: $eventForm) { EventForm(m: m) { eventForm = false } }
        .sheet(isPresented: $linkForm) { LinkForm(m: m) { linkForm = false } }
    }
    @State private var pending: UpdateDraft?

    private func page<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { content(); Color.clear.frame(height: 130) }
        }
        .scrollDisabled(shelfDrag)
        .refreshable { await m.load() }
    }

    // MARK: My Library

    @ViewBuilder private var mine: some View {
        H2(t: "Currently reading", action: m.mine.isEmpty ? nil : "Update") { flipNow += 1 }.padding(.top, -8)
        Shelf(items: mineItems(), w: 150, start: m.mine.isEmpty && m.clubToAdd.isEmpty ? 0 : 1, flipNow: flipNow, onDrag: { shelfDrag = $0 }, onReorder: { ids in Task { await m.reorderReads(ids) } })
        goals
        shelf("Want to read", m.want, want: true, ghosts: [])
        shelf("Finished · \(m.finished.count)", m.finished, want: false, ghosts: finishedGhosts())
    }
    private func pct(_ r: LRead?) -> Int {
        guard let r, let t = r.total, t > 0, r.page > 0 else { return 0 }
        return min(100, Int((Double(r.page) * 100 / Double(t)).rounded()))
    }
    private func mineItems() -> [ShelfItem] {
        var out: [ShelfItem] = [ShelfItem(id: "add", title: "Add a book", plus: true, open: { searching = false })]
        for b in m.clubToAdd {
            out.append(ShelfItem(id: "club" + b.id, title: lshort(b.title), by: b.author, cover: b.cover, ghost: m.ghost["club" + b.id] ?? "",
                                 sub: AnyView(Text("LOTM book · tap to add to your library").font(.sans(12)).foregroundStyle(T.muted)), open: { Task { await m.joinClub(b) } }))
        }
        for (i, r) in m.mine.enumerated() {
            out.append(ShelfItem(id: r.id, title: lshort(r.title), by: r.author, cover: r.cover, shade: SHADES[(i + 2) % SHADES.count], movable: true, sub: AnyView(Bar(pct: pct(r))),
                                 back: { close in AnyView(CoverBack(r: r, m: m, close: close)) }))
        }
        return out
    }
    private func finishedGhosts() -> [ShelfItem] {
        m.clubFinishedToAdd.map { b in
            ShelfItem(id: "lotmdone" + b.id, title: lshort(b.title), by: b.author, cover: b.cover, ghost: m.ghost["lotmdone" + b.id] ?? "",
                      sub: AnyView(Text("Read with LOTM · tap to add to Finished").font(.sans(12)).foregroundStyle(T.muted)), open: { Task { await m.addFinished(b) } })
        }
    }
    private func shelfItems(_ list: [LRead], _ ghosts: [ShelfItem]) -> [ShelfItem] {
        var out = ghosts
        for (i, r) in list.enumerated() {
            let n = m.notes[lnorm(r.title)]
            out.append(ShelfItem(id: r.id, title: lshort(r.title), by: r.author, cover: r.cover, shade: SHADES[(i + 5) % SHADES.count],
                                 movable: true, sub: n.map { AnyView(Text("\($0) in commonplace").font(.sans(12)).foregroundStyle(T.muted)) },
                                 back: { close in AnyView(CoverBack(r: r, m: m, close: close)) }))
        }
        return out
    }
    private func clubItems() -> [ShelfItem] {
        var books: [(Int, ShelfItem)] = []
        for (i, b) in m.current.enumerated() {
            let p = pct(m.myFor(b))
            let pos = (b.position ?? "TBD") != "TBD" && !(b.position ?? "").isEmpty ? " · Read: \(b.position!)" : ""
            let label = (i == 0 ? "Current club read" : "Also reading") + pos
            let item = ShelfItem(id: b.id, title: lshort(b.title), by: b.author, cover: b.cover, shade: SHADES[i % 2], movable: m.admin,
                                 sub: AnyView(VStack(spacing: 3) { Bar(pct: p); Text(label).font(.sans(12)).foregroundStyle(T.muted).lineLimit(1) }), open: { clubBook = b })
            books.append((rank(b.title, done: false), item))
        }
        for (i, b) in m.doneThisYear.enumerated() {
            let month = b.created.formatted(.dateTime.month(.wide))
            let item = ShelfItem(id: "done" + b.id, title: lshort(b.title), cover: b.cover, shade: SHADES[(i + 4) % SHADES.count], movable: m.admin,
                                 sub: AnyView(Text("Read · \(month)").font(.sans(12)).foregroundStyle(T.muted)), open: { UIApplication.shared.open(amazon(b.title, b.author, b.bookURL)) })
            books.append((rank(b.title, done: true), item))
        }
        var out: [ShelfItem] = m.admin ? [ShelfItem(id: "addclub", title: "Add a club book", plus: true, open: { pending = nil; clubSearch = true })] : []
        if m.shelfOrder.isEmpty { out += books.map { $0.1 } }
        else { out += books.enumerated().sorted { a, b in a.element.0 != b.element.0 ? a.element.0 < b.element.0 : a.offset < b.offset }.map { $0.element.1 } }
        return out
    }

    @ViewBuilder private func shelf(_ title: String, _ list: [LRead], want: Bool, ghosts: [ShelfItem]) -> some View {
        if !list.isEmpty || want || !ghosts.isEmpty {
            H2(t: title, action: want ? "Add" : nil) { searching = true }
            if list.isEmpty && ghosts.isEmpty {
                Text("Books you mean to read next.").font(.sans(14)).foregroundStyle(T.muted).padding(.horizontal, 20)
            } else {
                Shelf(items: shelfItems(list, ghosts), onDrag: { shelfDrag = $0 }, onReorder: { ids in Task { await m.reorderReads(ids) } })
            }
        }
    }

    // MARK: Reading goals

    private func met(_ d: Date) -> Bool { (m.days[lday(d)] ?? 0) >= m.goal }
    private var streak: (cur: Int, best: Int) {
        let cal = Calendar.current, today = Date()
        var cur = 0, d = met(today) ? today : cal.date(byAdding: .day, value: -1, to: today)!
        while met(d) && cur < 800 { cur += 1; d = cal.date(byAdding: .day, value: -1, to: d)! }
        var best = 0, run = 0, prev: Date?
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        for k in m.days.filter({ $0.value >= m.goal }).keys.sorted() {
            guard let day = f.date(from: k) else { continue }
            run = prev.map { cal.dateComponents([.day], from: $0, to: day).day == 1 } == true ? run + 1 : 1; best = max(best, run); prev = day
        }
        return (cur, max(best, cur))
    }
    private var goals: some View {
        let done = m.days[lday()] ?? 0, g = max(1, m.goal), frac = min(1, CGFloat(done) / CGFloat(g)), s = streak
        let cal = Calendar.current, today = Date(), wd = cal.component(.weekday, from: today) - 1
        let week = (0..<7).map { cal.date(byAdding: .day, value: $0 - wd, to: today)! }
        return VStack(spacing: 0) {
            Text("Reading goals").font(.serif(26, .semibold)).foregroundStyle(T.ink)
            Text("Read every day, keep your streak, and finish more books.").font(.sans(15)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: 300).padding(.top, 4)
            ZStack(alignment: .top) {
                Circle().trim(from: 0, to: 2 / 3).stroke(Color(rgb: 0x4a4c35), style: StrokeStyle(lineWidth: 10, lineCap: .round)).rotationEffect(.degrees(150)).frame(width: 240, height: 240).padding(.top, 20)
                Circle().trim(from: 0, to: 2 / 3 * frac).stroke(Color(rgb: 0x5d9b6b), style: StrokeStyle(lineWidth: 10, lineCap: .round)).rotationEffect(.degrees(150)).frame(width: 240, height: 240).padding(.top, 20)
                    .opacity(frac > 0 ? 1 : 0).animation(.easeOut(duration: 0.8), value: frac)
                VStack(spacing: 4) {
                    Text("Today’s reading").font(.serif(21, .semibold)).foregroundStyle(T.ink)
                    Text("\(done)").font(.serif(76, .medium)).foregroundStyle(T.ink).contentTransition(.numericText()).animation(.snappy, value: done).frame(height: 78)
                    Button { goalSheet = true } label: { (Text("of your \(g)-page goal ").foregroundColor(T.ink) + Text("›").foregroundColor(T.muted)).font(.sans(16)) }.buttonStyle(.plain)
                }
                .padding(.top, 58)
            }
            .frame(width: 280, height: 232).padding(.top, 18)
            Button { flipNow += 1; if m.mine.isEmpty { searching = false } } label: {
                VStack(spacing: 1) {
                    Text(done >= g ? "Goal met — read on" : "Keep reading").font(.sans(17, .bold)).foregroundStyle(T.ink)
                    if let b = m.mine.first { Text(lshort(b.title)).font(.sans(14)).foregroundStyle(T.muted).lineLimit(1) }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 12).background(RoundedRectangle(cornerRadius: 30).fill(Color(rgb: 0x4d5038)))
            }
            .buttonStyle(Press()).padding(.top, 6)
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    let on = met(week[i]), isToday = i == wd, future = week[i] > today && !isToday
                    Button { Haptic.tap(); editDay = DayPick(date: week[i]) } label: {
                        Text(["S", "M", "T", "W", "T", "F", "S"][i]).font(.sans(15, .bold)).foregroundStyle(on ? .white : future ? Color(rgb: 0x7d8063) : T.ink)
                            .frame(width: 36, height: 36).background(Circle().fill(on ? Color(rgb: 0x5d9b6b) : .clear))
                            .overlay(Circle().stroke(on ? .clear : isToday ? T.ticker : Color(rgb: 0x5a5d41), lineWidth: 2))
                            .contentShape(Rectangle().inset(by: -5))
                    }
                    .buttonStyle(.plain).disabled(future)
                    .accessibilityLabel("\(week[i].formatted(.dateTime.weekday(.wide))), \(m.days[lday(week[i])] ?? 0) pages")
                    if i < 6 { Rectangle().fill(on && met(week[i + 1]) && week[i + 1] <= today ? Color(rgb: 0x5d9b6b) : .clear).frame(height: 3).frame(maxWidth: .infinity) }
                }
            }
            .padding(.top, 22)
            Group {
                if s.cur > 0 { (Text(done >= g ? "You’re on a " : "Extend your ") + Text("\(s.cur)-day").bold() + Text(" reading streak.")) }
                else { Text("Read \(g) pages today to start a streak.") }
            }
            .font(.sans(16)).foregroundStyle(T.ink).multilineTextAlignment(.center).padding(.top, 14)
            if s.best > 1 { Text("Record is \(s.best) days.").font(.sans(16)).foregroundStyle(T.muted) }
        }
        .frame(maxWidth: .infinity).padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 10)
    }

    // MARK: LOTM

    private func rank(_ title: String, done: Bool) -> Int {
        let t = lnorm(title).prefix(14)
        return m.shelfOrder.firstIndex { $0.prefix(14) == t } ?? (done ? 1_000_000 : -1)
    }
    @ViewBuilder private var club: some View {
        let cur = m.current, done = m.doneThisYear
        HStack(alignment: .center, spacing: 12) {
            Text("LOTM \(String(m.year)) Books").font(.serif(20, .semibold)).foregroundStyle(T.ink)
            Spacer()
            if m.admin {
                Button { let c = m.current.first; editing = UpdateDraft(title: c.map { lshort($0.title) } ?? "", author: c?.author ?? "", cover: c?.cover?.absoluteString, bookURL: c?.bookURL, place: c?.place ?? "") } label: {
                    Text("Post update").font(.sans(13, .bold)).foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 30).background(Capsule().fill(Color(rgb: 0x0c0e08, 0.08)))
                }.buttonStyle(.plain)
            }
            if !cur.isEmpty { Button { clubBook = cur.first } label: { Text("Update ›").font(.sans(14, .semibold)).foregroundStyle(Color(rgb: 0xd0ceb9)) }.buttonStyle(.plain) }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
        if cur.isEmpty && done.isEmpty && !m.admin {
            Text(m.loaded ? "No current reading yet." : "Loading…").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40)
        } else {
            Shelf(items: clubItems(), w: 150, start: m.admin ? 1 : 0, onCenter: { clubKey = $0 }, onDrag: { shelfDrag = $0 }, onReorder: { ids in Task { await m.reorderClub(ids) } })
        }
        clubCard.animation(.easeOut(duration: 0.25), value: clubKey)

        H2(t: "Upcoming", action: m.admin ? "Add" : "Suggest") { eventForm = true }
        VStack(alignment: .leading, spacing: 10) {
            ForEach(m.events) { e in EventCard(e: e, onRemove: m.admin ? { Task { await m.removeEvent(e) } } : nil) }
            if m.events.isEmpty { Text("Nothing on the calendar yet.").font(.sans(14)).foregroundStyle(T.muted).padding(.horizontal, 4) }
            Button { pastOpen.toggle(); if pastOpen { Task { await m.loadMeetings() } } } label: { Text(pastOpen ? "Hide past meetings ▴" : "Past meetings ▾").font(.sans(14, .semibold)).foregroundStyle(T.muted).padding(.vertical, 6).padding(.horizontal, 4) }.buttonStyle(.plain)
            if pastOpen {
                VStack(spacing: 0) {
                    if let rows = m.meetings {
                        if rows.isEmpty { Text("Nothing yet.").font(.sans(14)).foregroundStyle(T.muted).padding(12).frame(maxWidth: .infinity, alignment: .leading) }
                        ForEach(rows) { r in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text(r.when.formatted(Calendar.current.component(.year, from: r.when) == m.year ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())).font(.sans(12.5)).foregroundStyle(T.muted).frame(width: 78, alignment: .leading)
                                VStack(alignment: .leading, spacing: 1) { Text(r.title).font(.serif(15)).foregroundStyle(T.ink); if let p = r.place, !p.isEmpty { Text(p).font(.sans(12.5)).foregroundStyle(T.muted) } }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10).overlay(alignment: .top) { T.rule.frame(height: 1) }
                        }
                    } else { Text("Loading…").font(.sans(14)).foregroundStyle(T.muted).padding(12).frame(maxWidth: .infinity, alignment: .leading) }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(T.group)).clipShape(RoundedRectangle(cornerRadius: 14))
            }
            if m.admin {
                ForEach(m.sugs) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Suggested by \(feed.people[s.user]?.name ?? "a member")").font(.sans(12)).foregroundStyle(T.muted)
                        Text(s.title).font(.sans(15, .semibold)).foregroundStyle(T.ink)
                        Text([s.dateRaw.map { parseDate($0).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()) }, s.place].compactMap { $0 }.joined(separator: " · ")).font(.sans(13)).foregroundStyle(T.muted)
                        HStack(spacing: 8) {
                            Button("Add to calendar") { Task { await m.approve(s, true) } }.buttonStyle(LBtn(h: 32))
                            Button("Decline") { Task { await m.approve(s, false) } }.buttonStyle(LBtn(ghost: true, h: 32))
                        }.padding(.top, 8)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color(rgb: 0x626546), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }
            }
        }
        .padding(.horizontal, 16)

        if !m.earlier.isEmpty {
            Text("Earlier years").font(.serif(20, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 8)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 10) {
                ForEach(Array(m.earlier.enumerated()), id: \.element.id) { i, b in
                    VStack(spacing: 5) {
                        CoverArt(url: b.cover, shade: SHADES[(i + 4) % SHADES.count]).aspectRatio(2 / 3, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(lshort(b.title)).font(.serif(13)).foregroundStyle(T.ink).multilineTextAlignment(.center).lineLimit(3)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 20)
        }

        H2(t: "Worth reading", action: "Share a link") { linkForm = true }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(m.links) { l in
                    Button { m.openLink(l) } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            LinkThumb(l: l).frame(width: 220, height: 96).clipped()
                            VStack(alignment: .leading, spacing: 2) {
                                Text((l.publication ?? URL(string: l.url)?.host?.replacingOccurrences(of: "www.", with: "") ?? "").uppercased()).font(.sans(11, .bold)).tracking(0.6).foregroundStyle(T.muted).lineLimit(1)
                                Text(l.title).font(.serif(16, .semibold)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.leading)
                                Text((feed.people[l.user]?.name.split(separator: " ").first.map(String.init) ?? "") + (l.likes > 0 ? " · ♥ \(l.likes)" : "")).font(.sans(12)).foregroundStyle(T.muted).padding(.top, 2)
                            }
                            .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 10).frame(width: 220, alignment: .leading)
                        }
                        .background(T.card).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.rule))
                    }
                    .buttonStyle(.plain)
                }
                if m.links.isEmpty { Text("Articles and essays members recommend.").font(.sans(14)).foregroundStyle(T.muted) }
            }
            .padding(.horizontal, 16).padding(.bottom, 4)
        }
    }

    /// Under the LOTM shelf: the next study for a current book, or a description of the book in the middle.
    @ViewBuilder private var clubCard: some View {
        if let d = m.doneThisYear.first(where: { "done" + $0.id == clubKey }) {
            BookBio(title: lshort(d.title), author: d.author, kicker: "Read with LOTM · \(d.created.formatted(.dateTime.month(.wide).year()))", text: nil, link: amazon(d.title, d.author, d.bookURL)).id(d.id)
        } else {
            let mid = m.current.first { $0.id == clubKey }
            if let mid, mid.studyAt == nil, mid.file == nil {
                BookBio(title: lshort(mid.title), author: mid.author, kicker: "Also reading", text: mid.synopsis, link: amazon(mid.title, mid.author, mid.bookURL)).id(mid.id)
            } else if let b = (mid?.studyAt != nil ? mid : nil) ?? m.current.first(where: { $0.studyAt != nil }) ?? mid ?? m.current.first, b.studyAt != nil || b.file != nil {
                VStack(alignment: .leading, spacing: 10) {
                    if let d = b.studyAt {
                        let gone = d < Date()
                        HStack(spacing: 12) {
                            VStack(spacing: 0) {
                                Text(d.formatted(.dateTime.month(.abbreviated)).uppercased()).font(.sans(10, .bold)).foregroundStyle(T.cream).frame(maxWidth: .infinity).padding(.vertical, 2).background(T.tan)
                                Text("\(Calendar.current.component(.day, from: d))").font(.sans(18, .semibold)).foregroundStyle(T.ink).padding(.top, 2).padding(.bottom, 4)
                            }
                            .frame(width: 46).background(T.card).clipShape(RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(T.softBd)).opacity(gone ? 0.5 : 1)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(gone ? "Met \(d.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()))" : "Next study · \(d.formatted(.dateTime.weekday(.wide).month(.wide).day())) · \(d.formatted(date: .omitted, time: .shortened))").font(.sans(14, .semibold)).foregroundStyle(T.ink)
                                Text(lshort(b.title) + ((b.position ?? "TBD") != "TBD" && !(b.position ?? "").isEmpty ? " · \(b.position!)" : "")).font(.sans(13)).foregroundStyle(T.muted)
                                if let p = b.place, !p.isEmpty {
                                    Button { if let u = b.placeURL.flatMap(URL.init(string:)) ?? URL(string: "https://maps.apple.com/?q=\(p.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")") { UIApplication.shared.open(u) } } label: { Text(p).font(.sans(13)).foregroundStyle(T.muted).multilineTextAlignment(.leading) }.buttonStyle(.plain)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        if !gone { Button("Add to calendar") { calendar(title: "Life of the Mind — \(lshort(b.title))", start: d, place: b.place, uid: "study-\(b.id)") }.buttonStyle(PillStyle()) }
                    }
                    if let f = b.file, let u = URL(string: f) { Button("Reading file") { UIApplication.shared.open(u) }.buttonStyle(PillStyle()) }
                }
                .padding(14).background(RoundedRectangle(cornerRadius: 18).fill(Color(rgb: 0x454832))).overlay(RoundedRectangle(cornerRadius: 18).stroke(T.softBd))
                .padding(.horizontal, 16).padding(.top, 14)
            }
        }
    }
}

private func calendar(title: String, start: Date, place: String?, uid: String) {
    let f = ISO8601DateFormatter()
    var c = URLComponents(string: "https://lotmstudy.org/ics")!
    c.queryItems = [URLQueryItem(name: "title", value: title), URLQueryItem(name: "start", value: f.string(from: start)), URLQueryItem(name: "end", value: f.string(from: start.addingTimeInterval(7200))), URLQueryItem(name: "uid", value: uid)]
        + (place.map { [URLQueryItem(name: "location", value: $0)] } ?? [])
    if let u = c.url { UIApplication.shared.open(u) }
}

/// A shared link's picture: the one saved with it, else the one its page offers, else the site's name.
private struct LinkThumb: View {
    let l: LLink
    @State private var found: URL?
    @State private var looked = false
    private static var cache: [String: URL] = [:]
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(rgb: 0x565a3f), Color(rgb: 0x6a6e4e)], startPoint: .topLeading, endPoint: .bottomTrailing)
            if let u = l.image ?? found { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
            else if looked { Text(l.publication ?? URL(string: l.url)?.host?.replacingOccurrences(of: "www.", with: "") ?? "").font(.serif(19, .semibold)).foregroundStyle(T.ink.opacity(0.8)).lineLimit(2).multilineTextAlignment(.center).padding(.horizontal, 14) }
        }
        .task {
            guard l.image == nil, found == nil else { return }
            if let c = Self.cache[l.url] { found = c; return }
            if let u = lurl((await site("fetch-metadata", ["url": l.url]))?["image"]) { Self.cache[l.url] = u; found = u }
            looked = true
        }
    }
}

/// A book's description: the club's own notes if there are any, else what the site's book service knows.
private struct BookBio: View {
    let title: String, author: String?, kicker: String, text: String?, link: URL
    @State private var about: String??
    @State private var more = false
    private static var cache: [String: String] = [:]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(kicker.uppercased()).font(.sans(11.5, .bold)).tracking(0.9).foregroundStyle(T.muted)
            Text(title).font(.serif(19, .semibold)).foregroundStyle(T.ink).padding(.top, 4)
            if let author, !author.isEmpty { Text("by \(author)").font(.serif(15, italic: true)).foregroundStyle(T.sub) }
            switch about {
            case .none: VStack(alignment: .leading, spacing: 6) { ForEach([0.92, 1, 0.74], id: \.self) { w in GeometryReader { g in Capsule().fill(T.ink.opacity(0.08)).frame(width: g.size.width * w) }.frame(height: 11) } }.padding(.top, 10)
            case .some(.some(let a)):
                Text(a).font(.serif(15.5)).foregroundStyle(Color(rgb: 0xe4e1cf)).lineSpacing(3).lineLimit(more ? nil : 5).padding(.top, 8)
                if a.count > 260 { Button(more ? "Less" : "More") { more.toggle() }.font(.sans(13.5, .semibold)).foregroundStyle(T.ticker).padding(.top, 4) }
            case .some(.none): Text("No description yet.").font(.sans(14)).foregroundStyle(T.muted).padding(.top, 8)
            }
            Button("View on Amazon ↗") { UIApplication.shared.open(link) }.buttonStyle(PillStyle()).padding(.top, 12)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color(rgb: 0x454832))).overlay(RoundedRectangle(cornerRadius: 18).stroke(T.softBd))
        .padding(.horizontal, 16).padding(.top, 14)
        .task {
            let k = "\(title)|\(author ?? "")"
            if let text, !text.isEmpty { about = .some(text); return }
            if let c = Self.cache[k] { about = .some(c); return }
            let a = ((await site("book-about", ["title": title, "author": author ?? ""]))?["about"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !a.isEmpty { Self.cache[k] = a }
            about = .some(a.isEmpty ? nil : a)
        }
    }
}

/// One event on a card of its own (opened from a notification): its picture, when and where, what it is, and the calendar.
struct EventSheet: View {
    let e: LEvent
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 12) {
                EventCard(e: e)
                if let d = e.details, !d.isEmpty { Text(d).font(.serif(17)).foregroundStyle(T.ink).lineSpacing(3).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 4) }
                if e.starts > Date() { Button("Add to calendar") { calendar(title: e.title, start: e.starts, place: e.place, uid: "event-\(e.id)") }.buttonStyle(LBtn()) }
                if let p = e.place, !p.isEmpty {
                    Button("Directions") { if let u = e.placeURL.flatMap(URL.init(string:)) ?? URL(string: "https://maps.apple.com/?q=\(p.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")") { UIApplication.shared.open(u) } }.buttonStyle(LBtn(ghost: true))
                }
            }
            .padding(.horizontal, 16)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
}

private struct EventCard: View {
    let e: LEvent
    var onRemove: (() -> Void)?
    @State private var image: URL?
    @State private var confirm = false
    var body: some View {
        let d = e.starts
        VStack(alignment: .leading, spacing: 0) {
            if let image {
                Color(rgb: 0x2a2d1d).aspectRatio(1.91, contentMode: .fit).overlay(AsyncImage(url: image) { $0.resizable().scaledToFill() } placeholder: { Color.clear }).clipped()
            } else {
                HStack(spacing: 14) {
                    Text("\(Calendar.current.component(.day, from: d))").font(.serif(44, .semibold)).foregroundStyle(T.cream)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.formatted(.dateTime.month(.wide)).uppercased()).foregroundStyle(T.cream)
                        Text(d.formatted(.dateTime.weekday(.wide)).uppercased()).foregroundStyle(Color(rgb: 0xd9b26a))
                    }.font(.sans(13, .bold)).tracking(1.5)
                }
                .frame(maxWidth: .infinity).aspectRatio(2.6, contentMode: .fit)
                .background(LinearGradient(colors: [Color(rgb: 0x2d301f), Color(rgb: 0x4b4e36)], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("\(d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())) · \(d.formatted(date: .omitted, time: .shortened))".uppercased()).font(.sans(12, .bold)).tracking(0.7).foregroundStyle(Color(rgb: 0xd9b26a))
                Text(e.title).font(.serif(19, .semibold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true)
                if let p = e.place, !p.isEmpty {
                    Button { if let u = e.placeURL.flatMap(URL.init(string:)) ?? URL(string: "https://maps.apple.com/?q=\(p.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")") { UIApplication.shared.open(u) } } label: { Text(p).font(.sans(13.5)).foregroundStyle(T.muted).multilineTextAlignment(.leading) }.buttonStyle(.plain)
                }
                if e.link != nil || onRemove != nil {
                    HStack(spacing: 14) {
                        if let l = e.link, let u = URL(string: l) { Button { UIApplication.shared.open(u) } label: { HStack(spacing: 5) { GlyphView(n: "link", s: 14, w: 2); Text("Details") }.font(.sans(13.5, .semibold)).foregroundStyle(T.ink) }.buttonStyle(.plain) }
                        Spacer()
                        if onRemove != nil { Menu { Button("Remove event", role: .destructive) { confirm = true } } label: { Text("···").font(.sans(15, .bold)).tracking(1).foregroundStyle(T.muted).frame(width: 32, height: 22) } }
                    }
                    .padding(.top, 5)
                }
            }
            .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 12)
        }
        .background(T.card).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
        .confirmationDialog("Remove this event?", isPresented: $confirm, titleVisibility: .visible) { Button("Remove", role: .destructive) { onRemove?() } }
        .task { if let l = e.link, image == nil { image = lurl((await site("fetch-metadata", ["url": l]))?["image"]) } }
    }
}

// MARK: - Sheets

private struct BookSearch: View {
    let title: String, cta: String
    let manual: () -> Void
    let pick: (LFound) -> Void
    @State private var q = ""
    @State private var results: [LFound]?
    @State private var busy = false
    @State private var chosen: LFound?
    @State private var pages = ""
    @FocusState private var typing: Bool
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                Text(chosen == nil ? title : "Add this book?").font(.serif(18, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 4)
                if let c = chosen {
                    HStack(alignment: .top, spacing: 14) {
                        CoverArt(url: c.cover.flatMap(URL.init(string:)), shade: Color(rgb: 0x626546)).frame(width: 104, height: 156).clipShape(RoundedRectangle(cornerRadius: 5)).shadow(color: .black.opacity(0.35), radius: 10, y: 8)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(c.title).font(.serif(20, .semibold)).foregroundStyle(T.ink)
                            if let a = c.author { Text(a).font(.serif(16)).foregroundStyle(T.muted) }
                            if let l = c.label { Text(l).font(.sans(13)).foregroundStyle(T.ink).padding(.top, 5) }
                            if let i = c.isbn { Text("ISBN \(i)").font(.sans(12)).foregroundStyle(T.muted) }
                            if let u = c.bookURL.flatMap(URL.init(string:)) { Button("View on Amazon ↗") { UIApplication.shared.open(u) }.font(.sans(13, .semibold)).foregroundStyle(T.ink).padding(.top, 8) }
                        }
                    }
                    LField(label: "Pages", text: $pages, hint: "Number of pages", number: true)
                    Button(cta) { var f = c; f.pages = Int(pages) ?? c.pages; pick(f) }.buttonStyle(LBtn())
                    Button("Back to results") { chosen = nil }.buttonStyle(LBtn(ghost: true))
                } else {
                    HStack(spacing: 8) {
                        TextField("", text: $q, prompt: Text("Title, author, ISBN or Amazon link").foregroundColor(T.muted)).focused($typing).submitLabel(.search).onSubmit { find() }.autocorrectionDisabled()
                            .font(.sans(16)).foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 46).background(RoundedRectangle(cornerRadius: 12).fill(T.paper)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.softBd))
                        Button(busy ? "…" : "Find") { find() }.buttonStyle(LBtn()).frame(width: 80).disabled(busy)
                    }
                    if results == nil { Button("Paste an Amazon link") { if let s = UIPasteboard.general.string, !s.isEmpty { q = s; find() } }.buttonStyle(LBtn(ghost: true)) }
                    if let results {
                        VStack(spacing: 0) {
                            ForEach(Array(results.enumerated()), id: \.element.id) { i, f in
                                Button { chosen = f; pages = f.pages.map(String.init) ?? "" } label: {
                                    HStack(spacing: 12) {
                                        CoverArt(url: f.cover.flatMap(URL.init(string:)), shade: Color(rgb: 0x626546)).frame(width: 38, height: 57).clipShape(RoundedRectangle(cornerRadius: 3))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(f.title).font(.serif(16)).foregroundStyle(T.ink).multilineTextAlignment(.leading)
                                            Text([f.author, f.label].compactMap { $0 }.joined(separator: " · ")).font(.sans(12)).foregroundStyle(T.muted).multilineTextAlignment(.leading)
                                            if let p = f.pages { Text("\(p) pages").font(.sans(12)).foregroundStyle(T.muted) }
                                        }
                                        Spacer(minLength: 0); Text("›").font(.sans(18)).foregroundStyle(T.muted)
                                    }
                                    .padding(.horizontal, 14).padding(.vertical, 8).contentShape(Rectangle())
                                    .overlay(alignment: .top) { if i > 0 { T.groupLine.frame(height: 1) } }
                                }.buttonStyle(.plain)
                            }
                            if results.isEmpty { Text("No matches. Try the Amazon link or ISBN.").font(.sans(15)).foregroundStyle(T.muted).padding(16).frame(maxWidth: .infinity, alignment: .leading) }
                        }
                        .background(RoundedRectangle(cornerRadius: 14).fill(T.group))
                    }
                    Button("Enter it by hand", action: manual).buttonStyle(LBtn(ghost: true))
                }
            }
            .padding(.horizontal, 16)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .onAppear { typing = true }
    }
    private func find() {
        let t = q.trimmingCharacters(in: .whitespaces); guard !t.isEmpty, !busy else { return }
        busy = true; chosen = nil
        Task { let r = await LibraryModel.search(t); results = r; busy = false
            if t.range(of: #"^https?:|amzn\.|a\.co/"#, options: [.regularExpression, .caseInsensitive]) != nil, let f = r.first { chosen = f; pages = f.pages.map(String.init) ?? "" } }
    }
}

private struct ByHand: View {
    let want: Bool
    let add: (String, String, String) -> Void
    @State private var title = ""
    @State private var author = ""
    @State private var pages = ""
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                Text(want ? "Want to read" : "Add a book").font(.serif(18, .semibold)).foregroundStyle(T.ink)
                LField(label: "Title", text: $title); LField(label: "Author", text: $author); LField(label: "Pages", text: $pages, number: true)
                Button("Add") { let t = title.trimmingCharacters(in: .whitespaces); if !t.isEmpty { add(t, author, pages) } }.buttonStyle(LBtn())
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
}

private struct ClubBookSheet: View {
    let b: LUpdate
    @ObservedObject var m: LibraryModel
    let close: () -> Void
    @State private var page = ""
    @State private var confirm = false
    var body: some View {
        let my = m.myFor(b), n = Int(page) ?? 0, ok = my != nil && n > 0 && (my?.total == nil || n <= my!.total!)
        SheetBody {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    CoverArt(url: b.cover, shade: SHADES[0]).frame(width: 64, height: 96).clipShape(RoundedRectangle(cornerRadius: 4))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lshort(b.title)).font(.serif(19, .semibold)).foregroundStyle(T.ink)
                        if let a = b.author { Text("by \(a)").font(.serif(15, italic: true)).foregroundStyle(T.muted) }
                        Button("Amazon ↗") { UIApplication.shared.open(amazon(b.title, b.author, b.bookURL)) }.font(.sans(13, .semibold)).foregroundStyle(T.ink).padding(.top, 4)
                    }
                }
                if let my {
                    HStack(alignment: .bottom, spacing: 10) {
                        LField(label: "I’m on page" + (my.total.map { " (of \($0))" } ?? ""), text: $page, hint: "\(my.page)", number: true)
                        Button("Log") { close(); Task { await m.log(my, n) } }.buttonStyle(LBtn()).frame(width: 84).disabled(!ok).opacity(ok ? 1 : 0.4)
                    }
                    Button("I’ve finished it") { close(); Task { await m.setStatus(my, "finished") } }.buttonStyle(LBtn(ghost: true))
                } else {
                    Button("Add to my Currently reading") { close(); Task { await m.joinClub(b) } }.buttonStyle(LBtn())
                }
                if m.admin { Button("Mark complete for LOTM") { confirm = true }.buttonStyle(LBtn(ghost: true)) }
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .confirmationDialog("Mark “\(lshort(b.title))” complete for LOTM? It moves to the end of this year’s books.", isPresented: $confirm, titleVisibility: .visible) {
            Button("Mark complete") { close(); Task { await m.completeForClub(b) } }
        }
    }
}

struct UpdateDraft: Identifiable { let id = UUID(); var title = "", author = "", cover: String? = nil, bookURL: String? = nil, publisher: String? = nil, place = "", position = "", file = "", notes = "", hasDate = false, when = Date() }

/// Administrators: post the club's reading (book, what to read, when and where the next study is).
private struct UpdateSheet: View {
    @State var d: UpdateDraft
    @ObservedObject var m: LibraryModel
    let find: (UpdateDraft) -> Void
    let close: () -> Void
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    if let c = d.cover.flatMap(URL.init(string:)) { CoverArt(url: c, shade: T.card).frame(width: 46, height: 69).clipShape(RoundedRectangle(cornerRadius: 3)) }
                    VStack(alignment: .leading) { Text(d.title.isEmpty ? "Club book" : lshort(d.title)).font(.serif(18, .semibold)).foregroundStyle(T.ink); if !d.author.isEmpty { Text("by \(d.author)").font(.serif(15, italic: true)).foregroundStyle(T.muted) } }
                    Spacer()
                    Button("Find on Amazon") { find(d) }.font(.sans(13, .bold)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(Color(rgb: 0x0c0e08, 0.08)))
                }
                Text("A different title runs alongside as another card (e.g. the Advent devotion).").font(.sans(14)).foregroundStyle(T.muted)
                LField(label: "Book", text: $d.title); LField(label: "Author", text: $d.author); LField(label: "Read for next time", text: $d.position)
                Toggle(isOn: $d.hasDate) { Text("Next study").font(.sans(15, .semibold)).foregroundStyle(T.ink) }.tint(Color(rgb: 0x3f7d4f))
                if d.hasDate { DatePicker("When", selection: $d.when, displayedComponents: [.date, .hourAndMinute]).font(.sans(15)).foregroundStyle(T.ink) }
                LField(label: "Where", text: $d.place, hint: "A place or address")
                LField(label: "Reading file link (optional)", text: $d.file); LField(label: "Notes", text: $d.notes)
                Button("Post update") {
                    guard !d.title.trimmingCharacters(in: .whitespaces).isEmpty else { m.say("Book title is required"); return }
                    func v(_ s: String?) -> Any { (s ?? "").isEmpty ? NSNull() as Any : s! }
                    let row: [String: Any] = ["book_title": d.title, "book_author": v(d.author), "book_publisher": v(d.publisher), "reading_position": v(d.position), "book_url": v(d.bookURL), "cover_url": v(d.cover),
                                              "reading_file_url": v(d.file), "synopsis": v(d.notes), "study_at": d.hasDate ? liso(d.when) as Any : NSNull(), "study_location": v(d.place),
                                              "study_location_url": d.place.isEmpty ? NSNull() as Any : "https://www.google.com/maps/search/?api=1&query=\(d.place.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")"]
                    Task { if await m.postUpdate(row) { close() } }
                }.buttonStyle(LBtn())
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
}

struct DayPick: Identifiable { let date: Date; var id: String { lday(date) } }
/// How many pages were read on one day, set by hand.
private struct DaySheet: View {
    @ObservedObject var m: LibraryModel
    let day: Date
    let close: () -> Void
    @State private var n = 0
    private func step(_ d: Int) { n = max(0, min(2000, n + d)); Haptic.tap() }
    var body: some View {
        SheetBody {
            VStack(spacing: 0) {
                Text(Calendar.current.isDateInToday(day) ? "Today" : day.formatted(.dateTime.weekday(.wide).month(.wide).day())).font(.serif(22, .semibold)).foregroundStyle(T.ink)
                HStack(spacing: 22) {
                    Button { step(-5) } label: { Image(systemName: "minus").font(.system(size: 16, weight: .bold)).foregroundStyle(T.ink).frame(width: 44, height: 44).background(Circle().fill(Color(rgb: 0x4d5038))) }.accessibilityLabel("Fewer pages")
                    VStack(spacing: 0) {
                        TextField("", value: $n, format: .number).keyboardType(.numberPad).multilineTextAlignment(.center).font(.serif(54)).foregroundStyle(T.ink).monospacedDigit().frame(width: 130)
                        Text(n == 1 ? "page read" : "pages read").font(.sans(14)).foregroundStyle(T.muted)
                    }
                    Button { step(5) } label: { Image(systemName: "plus").font(.system(size: 16, weight: .bold)).foregroundStyle(T.ink).frame(width: 44, height: 44).background(Circle().fill(Color(rgb: 0x4d5038))) }.accessibilityLabel("More pages")
                }
                .padding(.top, 14)
                HStack(spacing: 8) {
                    ForEach([0, m.goal, m.goal * 2], id: \.self) { v in
                        Button { n = v; Haptic.tap() } label: { Text(v == 0 ? "None" : "\(v)").font(.sans(14, .semibold)).foregroundStyle(n == v ? T.paper : T.ink).padding(.horizontal, 14).frame(height: 32).background(Capsule().fill(n == v ? T.ink : Color(rgb: 0x4d5038))) }.buttonStyle(.plain)
                    }
                }
                .padding(.top, 14)
                Button("Save") { let v = max(0, min(2000, n)); close(); Task { await m.setDay(day, v) } }.buttonStyle(LBtn(h: 48)).padding(.top, 20)
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .onAppear { n = m.days[lday(day)] ?? 0 }
    }
}

private struct GoalSheet: View {
    @ObservedObject var m: LibraryModel
    let close: () -> Void
    @State private var n = 20
    @State private var remind = true
    @State private var at = Date()
    private func step(_ d: Int) { n = max(1, min(500, n + d)); Haptic.tap() }
    var body: some View {
        SheetBody {
            VStack(spacing: 0) {
                Text("Daily goal").font(.serif(22, .semibold)).foregroundStyle(T.ink)
                HStack(spacing: 22) {
                    Button { step(-5) } label: { Image(systemName: "minus").font(.system(size: 16, weight: .bold)).foregroundStyle(T.ink).frame(width: 44, height: 44).background(Circle().fill(Color(rgb: 0x4d5038))) }.accessibilityLabel("Fewer pages")
                    VStack(spacing: 0) { Text("\(n)").font(.serif(54)).foregroundStyle(T.ink).monospacedDigit().contentTransition(.numericText()).animation(.snappy(duration: 0.2), value: n); Text("pages a day").font(.sans(14)).foregroundStyle(T.muted) }.frame(width: 120)
                    Button { step(5) } label: { Image(systemName: "plus").font(.system(size: 16, weight: .bold)).foregroundStyle(T.ink).frame(width: 44, height: 44).background(Circle().fill(Color(rgb: 0x4d5038))) }.accessibilityLabel("More pages")
                }
                .padding(.top, 18).padding(.bottom, 6)
                HStack(spacing: 8) {
                    ForEach([10, 20, 30, 50], id: \.self) { v in
                        Button { n = v; Haptic.tap() } label: { Text("\(v)").font(.sans(14, .semibold)).foregroundStyle(n == v ? T.paper : T.ink).padding(.horizontal, 14).frame(height: 32).background(Capsule().fill(n == v ? T.ink : Color(rgb: 0x4d5038))) }.buttonStyle(.plain)
                    }
                }
                .padding(.top, 12).padding(.bottom, 18)
                VStack(spacing: 0) {
                    Toggle(isOn: $remind) { VStack(alignment: .leading, spacing: 1) { Text("Evening reminder").font(.sans(15, .semibold)).foregroundStyle(T.ink); Text("Pages left, if you haven’t met your goal").font(.sans(13)).foregroundStyle(T.muted) } }
                        .tint(Color(rgb: 0x3f7d4f)).padding(.horizontal, 16).padding(.vertical, 12)
                    if remind { T.groupLine.frame(height: 1); DatePicker("Time", selection: $at, displayedComponents: .hourAndMinute).font(.sans(15, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 16).padding(.vertical, 8) }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(T.group))
                Button("Save") {
                    let c = Calendar.current.dateComponents([.hour, .minute], from: at)
                    let t = String(format: "%02d:%02d", c.hour ?? 19, c.minute ?? 30)
                    close(); Task { await m.saveGoal(n, remind: remind, at: t) }
                }.buttonStyle(LBtn(h: 48)).padding(.top, 18)
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .onAppear {
            n = m.goal; remind = m.remind
            let p = m.remindAt.split(separator: ":").compactMap { Int($0) }
            at = Calendar.current.date(bySettingHour: p.first ?? 19, minute: p.count > 1 ? p[1] : 30, second: 0, of: Date()) ?? Date()
        }
    }
}

private struct EventForm: View {
    @ObservedObject var m: LibraryModel
    let close: () -> Void
    @State private var title = ""
    @State private var place = ""
    @State private var details = ""
    @State private var link = ""
    @State private var when = Date().addingTimeInterval(86400)
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                Text(m.admin ? "Add an event" : "Suggest an event").font(.serif(18, .semibold)).foregroundStyle(T.ink)
                LField(label: "What", text: $title, hint: "Pieper reading night")
                DatePicker("When", selection: $when, displayedComponents: [.date, .hourAndMinute]).font(.sans(15, .semibold)).foregroundStyle(T.ink)
                LField(label: "Where", text: $place, hint: "A place or address")
                LField(label: "Details", text: $details, hint: "What to bring, what we’ll read, who’s hosting")
                LField(label: "Link (optional)", text: $link, hint: "Tickets, a reading, a website")
                Button(m.admin ? "Add" : "Send suggestion") {
                    let t = title.trimmingCharacters(in: .whitespaces); guard !t.isEmpty else { m.say("Add a title and a time"); return }
                    close(); Task { await m.saveEvent(title: t, when: when, place: place, details: details, link: link.trimmingCharacters(in: .whitespaces)) }
                }.buttonStyle(LBtn())
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
}

private struct LinkForm: View {
    @ObservedObject var m: LibraryModel
    let close: () -> Void
    @State private var url = ""
    @State private var title = ""
    @State private var publication = ""
    @State private var image = ""
    @State private var blurb = ""
    @State private var busy = false
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                Text("Share something worth reading").font(.serif(18, .semibold)).foregroundStyle(T.ink)
                HStack(alignment: .bottom, spacing: 8) {
                    LField(label: "Link", text: $url, hint: "https://")
                    Button(busy ? "…" : "Fetch") { fetch() }.buttonStyle(LBtn(ghost: true)).frame(width: 84).disabled(busy)
                }
                if let u = URL(string: image), !image.isEmpty { Color(rgb: 0x2a2d1d).frame(height: 120).overlay(AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear }).clipShape(RoundedRectangle(cornerRadius: 12)) }
                LField(label: "Title", text: $title); LField(label: "Publication", text: $publication); LField(label: "Why it’s worth reading (optional)", text: $blurb)
                Button("Share") {
                    let u = url.trimmingCharacters(in: .whitespaces); guard !u.isEmpty, !title.isEmpty else { m.say("Add the link and a title"); return }
                    close(); Task { await m.shareLink(url: u, title: title, publication: publication, image: image, blurb: blurb) }
                }.buttonStyle(LBtn())
            }
            .padding(.horizontal, 20)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
    private func fetch() {
        let u = url.trimmingCharacters(in: .whitespaces); guard !u.isEmpty else { return }
        busy = true
        Task {
            if let j = await site("fetch-metadata", ["url": u]), j["error"] == nil {
                if let t = j["title"] as? String, !t.isEmpty { title = t }
                if let p = j["publication"] as? String, !p.isEmpty { publication = p }
                if let i = j["image"] as? String { image = i }
            } else { m.say("Could not read that page — fill it in by hand") }
            busy = false
        }
    }
}
