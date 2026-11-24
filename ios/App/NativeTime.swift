import SwiftUI
import UIKit
import WebKit

// Native Time tab. It is drawn over the portal's Time tab (the web keeps its header and tab bar) and talks to
// Supabase directly with the session the web app hands over (window.abayaNativeAuth). Same tables and rules as the
// web timer (components/useTimer.ts), so the two always agree.

// MARK: - Supabase access

struct SupaAuth { let token: String, me: String, url: String, key: String }

@MainActor func portalAuth() async -> SupaAuth? {
    guard let web = PortalController.current?.webView else { return nil }
    return await withCheckedContinuation { (k: CheckedContinuation<SupaAuth?, Never>) in
        web.callAsyncJavaScript("return window.abayaNativeAuth ? await window.abayaNativeAuth() : ''", arguments: [:], in: nil, in: .page) { r in
            guard case .success(let v) = r, let s = v as? String, let d = s.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                  let t = o["token"] as? String, let me = o["me"] as? String, let u = o["url"] as? String, let key = o["key"] as? String
            else { return k.resume(returning: nil) }
            k.resume(returning: SupaAuth(token: t, me: me, url: u, key: key))
        }
    }
}

struct Supa {
    let a: SupaAuth
    @discardableResult
    func req(_ method: String, _ path: String, json: Any? = nil, prefer: String? = nil) async throws -> Data {
        guard let url = URL(string: a.url + path) else { throw fail("Bad address") }
        var r = URLRequest(url: url); r.httpMethod = method; r.timeoutInterval = 25
        r.setValue(a.key, forHTTPHeaderField: "apikey")
        r.setValue("Bearer \(a.token)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { r.setValue(prefer, forHTTPHeaderField: "Prefer") }
        if let json { r.httpBody = try JSONSerialization.data(withJSONObject: json) }
        let (d, resp) = try await URLSession.shared.data(for: r)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 300 {
            let msg = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["message"] as? String
            throw fail(msg ?? "Something went wrong (\(code))")
        }
        return d
    }
    func rows(_ path: String) async throws -> [[String: Any]] {
        let d = try await req("GET", path)
        return ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]]) ?? []
    }
    func fail(_ m: String) -> NSError { NSError(domain: "Abaya", code: 1, userInfo: [NSLocalizedDescriptionKey: m]) }
}

private let isoFrac: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
private let isoPlain = ISO8601DateFormatter()
func parseTS(_ v: Any?) -> Date? {
    guard let s = v as? String else { return nil }
    if let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) { return d }
    // Postgres sometimes sends "+00:00" with microseconds, which ISO8601DateFormatter can't read: trim to milliseconds
    if let dot = s.firstIndex(of: "."), let tz = s[dot...].firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) {
        let frac = s[s.index(after: dot)..<tz].prefix(3)
        return isoFrac.date(from: String(s[..<dot]) + "." + frac + String(s[tz...]))
    }
    return nil
}
func dayISO(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
}
func dateOf(_ day: String) -> Date {
    let p = day.split(separator: "-").compactMap { Int($0) }
    return Calendar.current.date(from: DateComponents(year: p.count > 0 ? p[0] : 2000, month: p.count > 1 ? p[1] : 1, day: p.count > 2 ? p[2] : 1, hour: 12)) ?? Date()
}
func mondayOf(_ d: Date) -> Date {
    let cal = Calendar.current
    let start = cal.startOfDay(for: d)
    let wd = cal.component(.weekday, from: start) // 1 = Sunday
    return cal.date(byAdding: .day, value: -((wd + 5) % 7), to: start) ?? start
}
/// HH:MM, like the web (no seconds, firm-wide)
func hhmm(seconds: Double) -> String { let s = max(0, Int(seconds)); return String(format: "%02d:%02d", s / 3600, (s / 60) % 60) }
/** 7.5h, 0.25h (up to two decimals, trailing zeros dropped) */
func hrsText(_ mins: Int) -> String { var t = String(format: "%.2f", Double(mins) / 60); while t.hasSuffix("0") { t.removeLast() }; if t.hasSuffix(".") { t.removeLast() }; return t + "h" }
func hhmm(minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
func orNull(_ v: String?) -> Any { v.map { $0 as Any } ?? NSNull() }
func orNull(_ v: Double?) -> Any { v.map { $0 as Any } ?? NSNull() }
private func str(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
private func num(_ v: Any?) -> Double { (v as? Double) ?? (v as? NSNumber)?.doubleValue ?? Double((v as? String) ?? "") ?? 0 }

let navy = Color(red: 2 / 255, green: 37 / 255, blue: 61 / 255)
let paper = Color(red: 231 / 255, green: 231 / 255, blue: 228 / 255)
let runGreen = Color(red: 3 / 255, green: 152 / 255, blue: 85 / 255)
func sectorColor(_ s: String?, number: String?) -> Color {
    if number == "OH" { return Color(red: 0.42, green: 0.45, blue: 0.5) }
    switch s ?? "internal" {
    case "commercial": return Color(red: 0x2b / 255, green: 0x5c / 255, blue: 0x8a / 255)
    case "residential": return Color(red: 0xa3 / 255, green: 0x2d / 255, blue: 0x2d / 255)
    case "medical": return Color(red: 0x2e / 255, green: 0x7d / 255, blue: 0x4f / 255)
    case "consultation": return Color(red: 0x6b / 255, green: 0x72 / 255, blue: 0x80 / 255)
    case "civic": return Color(red: 0x5b / 255, green: 0x4b / 255, blue: 0x8a / 255)
    default: return navy
    }
}
let phaseNames = ["CE": "Conceptual / Exploratory", "SD": "Schematic Design", "DD": "Design Development", "CD": "Construction Documents",
                  "BN": "Bidding & Negotiation", "PM": "Permitting", "CA": "Construction Administration", "AS": "Additional service", "CU": "Custom phase"]
let activities = ["Administration", "Basic Services", "Change Order", "Internal Staff Meeting", "Meeting (office)", "Meeting (site)", "Past Hours", "Renderings", "Research", "RFP/RFQ", "Travel"]
let overheadTypes = ["Equipment", "Insurance", "Meetings", "Office Admin.", "Personal Days", "Rent", "Sick Leave"]
let roles = ["Principal", "Project Architect", "Designer"]

// MARK: - Model

struct Ph: Identifiable, Hashable { let id: String, code: String, name: String?; var label: String { name ?? phaseNames[code] ?? code } }
struct Proj: Identifiable, Hashable { let id: String, number: String, name: String, sector: String?, phases: [Ph]; var isOH: Bool { number == "OH" } }
struct TaskKey: Hashable {
    var projectId: String, phaseId: String?, role: String?, activity: String?
    var key: String { "\(projectId)|\(phaseId ?? "null")|\(role ?? "null")|\(activity ?? "null")" }
}
struct RunningTimer {
    var task: TaskKey, note: String?, billRate: Double?
    var startedAt: Date, pausedAt: Date?, bankedMinutes: Double, bankedSeconds: Double
    var paused: Bool { pausedAt != nil }
    func elapsed(_ now: Date) -> Double { (pausedAt ?? now).timeIntervalSince(startedAt) + bankedMinutes * 60 + bankedSeconds }
}
struct TCard: Identifiable { let task: TaskKey; var minutes: Int; let number: String, name: String, sector: String?, phaseCode: String?, phaseName: String?; var id: String { task.key } }

@MainActor final class TimeModel: ObservableObject {
    static let shared = TimeModel()
    @Published var day = dayISO(Date())
    @Published var running: RunningTimer?
    @Published var projects: [Proj] = []
    @Published var cards: [TCard] = []
    @Published var perDay: [String: Int] = [:]
    @Published var recent: [TaskKey] = []
    @Published var loggedTodayByKey: [String: Int] = [:]
    @Published var error = ""
    @Published var busy = false
    @Published var loaded = false
    @Published var gpsOn = TripTracker.shared.running
    @Published var gpsMiles = TripTracker.shared.miles
    private var me = ""
    private var memberRoles: [String: String] = [:]   // project → role on its team
    private var lastRoles: [String: String] = [:]     // project → role last used
    private var title: String?

    var days: [String] { let m = mondayOf(dateOf(day)); return (0..<7).map { dayISO(Calendar.current.date(byAdding: .day, value: $0, to: m) ?? m) } }
    var today: String { dayISO(Date()) }
    func project(_ id: String) -> Proj? { projects.first { $0.id == id } }
    func defaultRole(_ projectId: String) -> String { memberRoles[projectId] ?? lastRoles[projectId] ?? (roles.contains(title ?? "") ? title! : "") }
    func loggedToday(_ t: TaskKey) -> Int { loggedTodayByKey[t.key] ?? 0 }

    private func db() async -> Supa? {
        guard let a = await portalAuth() else { error = "Not signed in yet. Pull down to try again."; return nil }
        me = a.me; return Supa(a: a)
    }

    func load() async {
        guard let db = await db() else { return }
        let days = self.days, since = dayISO(Calendar.current.date(byAdding: .day, value: -14, to: dateOf(days[0])) ?? Date())
        do {
            async let P = db.rows("/rest/v1/projects?status=in.(active,paused)&select=id,number,name,sector,phases(id,code,sort,name)&order=number.desc")
            async let T = db.rows("/rest/v1/timers?profile_id=eq.\(me)&select=*")
            async let E = db.rows("/rest/v1/time_entries?profile_id=eq.\(me)&work_date=gte.\(days[0])&work_date=lte.\(days[6])&select=project_id,phase_id,role_label,activity,minutes,work_date,projects(number,name,sector),phases(code,name)")
            async let R = db.rows("/rest/v1/timesheet_rows?profile_id=eq.\(me)&select=project_id,phase_id,role_label,activity,created_at,projects(number,name,sector,status),phases(code,name)&order=created_at")
            async let U = db.rows("/rest/v1/time_entries?profile_id=eq.\(me)&work_date=gte.\(since)&work_date=lte.\(days[6])&select=project_id,phase_id,role_label,activity")
            async let RC = db.rows("/rest/v1/time_entries?profile_id=eq.\(me)&select=project_id,phase_id,role_label,activity,created_at&order=created_at.desc&limit=200")
            async let TD = db.rows("/rest/v1/time_entries?profile_id=eq.\(me)&work_date=eq.\(today)&select=project_id,phase_id,role_label,activity,minutes")
            async let M = db.rows("/rest/v1/project_members?profile_id=eq.\(me)&select=project_id,role_label")
            async let ME = db.rows("/rest/v1/profiles?id=eq.\(me)&select=title")
            let (p, t, e, r, u, rc, td, m, mine) = try await (P, T, E, R, U, RC, TD, M, ME)
            projects = p.map { x in
                let phs = ((x["phases"] as? [[String: Any]]) ?? []).sorted { num($0["sort"]) < num($1["sort"]) }
                    .map { Ph(id: str($0["id"]) ?? "", code: str($0["code"]) ?? "", name: str($0["name"])) }
                return Proj(id: str(x["id"]) ?? "", number: str(x["number"]) ?? "", name: str(x["name"]) ?? "", sector: str(x["sector"]), phases: phs)
            }
            func task(_ x: [String: Any]) -> TaskKey { TaskKey(projectId: str(x["project_id"]) ?? "", phaseId: str(x["phase_id"]), role: str(x["role_label"]), activity: str(x["activity"])) }
            running = t.first.flatMap { x in
                guard let s = parseTS(x["started_at"]) else { return nil }
                return RunningTimer(task: task(x), note: str(x["note"]), billRate: x["bill_rate"] is NSNull ? nil : (x["bill_rate"] == nil ? nil : num(x["bill_rate"])),
                                    startedAt: s, pausedAt: parseTS(x["paused_at"]), bankedMinutes: num(x["banked_minutes"]), bankedSeconds: num(x["banked_seconds"]))
            }
            var pd: [String: Int] = [:]
            for x in e { let d = str(x["work_date"]) ?? ""; pd[d, default: 0] += Int(num(x["minutes"])) }
            perDay = pd
            var td2: [String: Int] = [:]
            for x in td { td2[task(x).key, default: 0] += Int(num(x["minutes"])) }
            loggedTodayByKey = td2
            let used = Set(u.map { task($0).key })
            var byKey: [String: TCard] = [:]; var order: [String] = []
            func card(_ x: [String: Any]) -> TCard {
                let pr = x["projects"] as? [String: Any], ph = x["phases"] as? [String: Any]
                return TCard(task: task(x), minutes: 0, number: str(pr?["number"]) ?? "", name: str(pr?["name"]) ?? "", sector: str(pr?["sector"]), phaseCode: str(ph?["code"]), phaseName: str(ph?["name"]))
            }
            for x in r {
                let pr = x["projects"] as? [String: Any]
                let k = task(x).key, created = String((str(x["created_at"]) ?? "").prefix(10))
                if str(pr?["status"]) == "complete" || !(used.contains(k) || created >= since) { continue }
                if byKey[k] == nil { order.append(k) }
                byKey[k] = card(x)
            }
            for x in e where str(x["work_date"]) == day {
                let k = task(x).key
                if byKey[k] == nil { byKey[k] = card(x); order.append(k) }
                byKey[k]?.minutes += Int(num(x["minutes"]))
            }
            cards = order.compactMap { byKey[$0] }.sorted { $0.minutes > $1.minutes }
            var seen = Set<String>(); var rec: [TaskKey] = []
            for x in rc { let t = task(x); if seen.insert(t.key).inserted { rec.append(t) }; if rec.count >= 8 { break } }
            recent = rec
            lastRoles = [:]
            for x in rc { if let pid = str(x["project_id"]), let role = str(x["role_label"]), lastRoles[pid] == nil { lastRoles[pid] = role } }
            memberRoles = Dictionary(m.compactMap { x in str(x["project_id"]).flatMap { p in str(x["role_label"]).map { (p, $0) } } }, uniquingKeysWith: { a, _ in a })
            title = str(mine.first?["title"])
            error = ""; loaded = true
        } catch { self.error = error.localizedDescription }
    }

    // MARK: timer actions (mirror useTimer.ts)

    private func act(_ f: @escaping (Supa) async throws -> Void) async -> Bool {
        guard let db = await db() else { return false }
        busy = true; defer { busy = false }
        do { try await f(db); error = ""; await load(); PortalController.current?.timeChangedNatively(); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    private func fields(_ t: TaskKey, note: String? = nil) -> [String: Any] {
        ["project_id": t.projectId, "phase_id": orNull(t.phaseId), "role_label": orNull(t.role), "activity": orNull(t.activity), "note": orNull(note)]
    }
    private func logRunning(_ db: Supa) async throws {
        guard let r = running else { return }
        let minutes = max(1, Int((r.elapsed(Date()) / 60).rounded()))
        var row = fields(r.task, note: r.note)
        row["profile_id"] = me; row["work_date"] = today; row["minutes"] = minutes
        row["started_at"] = isoPlain.string(from: r.startedAt); row["ended_at"] = isoPlain.string(from: Date())
        row["bill_rate"] = orNull(r.billRate)
        try await db.req("POST", "/rest/v1/time_entries", json: row)
        try await db.req("DELETE", "/rest/v1/timers?profile_id=eq.\(me)")
        var ts = fields(r.task); ts["profile_id"] = me; ts["bill_rate"] = orNull(r.billRate); ts.removeValue(forKey: "note")
        _ = try? await db.req("POST", "/rest/v1/timesheet_rows", json: ts) // a duplicate is rejected by the unique index, which is fine
        running = nil
    }
    private func startRow(_ t: TaskKey, note: String?) -> [String: Any] {
        var row = fields(t, note: note); row["profile_id"] = me
        row["started_at"] = isoPlain.string(from: Date()); row["banked_minutes"] = 0; row["banked_seconds"] = 0; row["paused_at"] = NSNull()
        return row
    }

    func start(_ t: TaskKey, note: String?, trip: Bool) async {
        let ok = await act { db in
            if self.running != nil { try await self.logRunning(db) }
            try await db.req("POST", "/rest/v1/timers?on_conflict=profile_id", json: self.startRow(t, note: note), prefer: "resolution=merge-duplicates")
        }
        if ok { haptic(.success); if trip && !TripTracker.shared.running { TripTracker.shared.start() } }
    }
    /// End & log. The GPS trip belongs to the timer's task, so it ends too (the portal then opens the trip sheet).
    func stop() async {
        if await act({ db in try await self.logRunning(db) }) {
            haptic(.success)
            if TripTracker.shared.running { TripTracker.shared.stop() }
        }
    }
    func pause() async {
        guard running?.paused == false else { return }
        _ = await act { db in try await db.req("PATCH", "/rest/v1/timers?profile_id=eq.\(self.me)", json: ["paused_at": isoPlain.string(from: Date())]) }
    }
    func resume() async {
        guard let r = running, let p = r.pausedAt else { return }
        let stretch = max(0, p.timeIntervalSince(r.startedAt))
        _ = await act { db in try await db.req("PATCH", "/rest/v1/timers?profile_id=eq.\(self.me)", json: ["banked_seconds": Int((r.bankedSeconds + stretch).rounded()), "started_at": isoPlain.string(from: Date()), "paused_at": NSNull()] as [String: Any]) }
    }
    func addTime(_ minutes: Int) async {
        guard let r = running else { return }
        _ = await act { db in try await db.req("PATCH", "/rest/v1/timers?profile_id=eq.\(self.me)", json: ["banked_seconds": Int(r.bankedSeconds) + minutes * 60] as [String: Any]) }
    }
    func discard() async {
        _ = await act { db in try await db.req("DELETE", "/rest/v1/timers?profile_id=eq.\(self.me)") }
    }
    /// ▶ on a card: log whatever is running, then start this task.
    func pickUp(_ c: TCard) async { await start(c.task, note: nil, trip: false) }

    func shift(_ days: Int) { day = dayISO(Calendar.current.date(byAdding: .day, value: days, to: dateOf(day)) ?? Date()); Task { await load() } }
    func pick(_ d: String) { day = d; Task { await load() } }

    func gpsChanged() { gpsOn = TripTracker.shared.running; gpsMiles = TripTracker.shared.miles }
    func haptic(_ t: UINotificationFeedbackGenerator.FeedbackType) { UINotificationFeedbackGenerator().notificationOccurred(t) }

    func label(_ t: TaskKey) -> (number: String, name: String, sub: String, color: Color) {
        let p = project(t.projectId)
        let ph = p?.phases.first { $0.id == t.phaseId }
        let oh = p?.isOH ?? false
        let sub = oh ? (t.activity ?? "Overhead") : [ph?.label, t.activity].compactMap { $0 }.joined(separator: " · ")
        return (oh ? "OH" : (p?.number ?? ""), oh ? "Overhead" : (p?.name ?? "Project"), sub.isEmpty ? "—" : sub, sectorColor(p?.sector, number: p?.number))
    }
}

// MARK: - Screen

struct TimeScreen: View {
    @ObservedObject var m: TimeModel
    @State private var sheet: SheetKind?
    enum SheetKind: Identifiable { case start, running; var id: Int { self == .start ? 0 : 1 } }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                dayBar
                weekStrip
                if let r = m.running { runningCard(r).padding(.horizontal, 14).padding(.top, 14) }
                else { startButton.padding(.horizontal, 14).padding(.top, 14) }
                HStack { Text("Hours this week: ").foregroundStyle(.secondary) + Text(hhmm(minutes: m.days.reduce(0) { $0 + (m.perDay[$1] ?? 0) })).bold().monospacedDigit(); Spacer() }
                    .font(.system(size: 16)).padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 6)
                if !m.error.isEmpty { Text(m.error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16).frame(maxWidth: .infinity, alignment: .leading) }
                LazyVStack(spacing: 10) {
                    ForEach(m.cards) { c in cardView(c) }
                    if m.loaded && m.cards.isEmpty { Text("No time on this day.").foregroundStyle(.secondary).padding(.top, 30) }
                }.padding(.horizontal, 14).padding(.top, 4)
                Button { PortalController.current?.openWebSheet("manual") } label: {
                    Label("Manual entry", systemImage: "square.and.pencil").font(.system(size: 16, weight: .semibold)).foregroundStyle(navy)
                }.padding(.top, 18).padding(.bottom, 28)
            }
        }
        .background(paper)
        .refreshable { await m.load() }
        .task { await m.load() }
        .sheet(item: $sheet) { k in
            switch k {
            case .start: StartTimerSheet(m: m).preferredColorScheme(.light)
            case .running: RunningSheet(m: m).preferredColorScheme(.light)
            }
        }
        .preferredColorScheme(.light)
    }

    private var dayBar: some View {
        let d = dateOf(m.day)
        let f = DateFormatter(); f.dateFormat = m.day == m.today ? "'Today,' MMM d" : "EEE, MMM d"
        return HStack {
            Text(f.string(from: d)).font(.system(size: 19, weight: .bold))
            Spacer()
            Button { m.shift(-7) } label: { Image(systemName: "chevron.left").frame(width: 40, height: 40) }.accessibilityLabel("Previous week")
            Button { m.shift(7) } label: { Image(systemName: "chevron.right").frame(width: 40, height: 40) }.accessibilityLabel("Next week")
            if m.day != m.today { Button("Today") { m.pick(m.today) }.font(.system(size: 15, weight: .semibold)) }
        }
        .foregroundStyle(navy).padding(.horizontal, 16).padding(.vertical, 6).background(.white)
    }

    private var weekStrip: some View {
        HStack(spacing: 2) {
            ForEach(m.days, id: \.self) { d in
                let dt = dateOf(d), mins = m.perDay[d] ?? 0, on = d == m.day
                Button { m.pick(d) } label: {
                    VStack(spacing: 2) {
                        Text(String(dt.formatted(.dateTime.weekday(.abbreviated)).prefix(2))).font(.system(size: 13)).foregroundStyle(on ? navy : .secondary)
                        Text("\(Calendar.current.component(.day, from: dt))").font(.system(size: 20, weight: .bold)).foregroundStyle(on ? navy : .primary)
                        Text(mins > 0 ? hrsText(mins) : "–").font(.system(size: 11.5)).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(on ? Color(red: 0xed / 255, green: 0xe6 / 255, blue: 0xd6 / 255) : .clear, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
        }.padding(.horizontal, 6).padding(.vertical, 8).background(.white).shadow(color: .black.opacity(0.05), radius: 5, y: 4)
    }

    private var startButton: some View {
        Button { sheet = .start } label: {
            HStack(spacing: 10) {
                Image(systemName: "play.fill")
                Text("Start timer").font(.system(size: 17, weight: .semibold))
                Spacer()
                Image(systemName: "location").opacity(0.8)
                Text("GPS optional").font(.system(size: 13)).opacity(0.8)
            }.foregroundStyle(.white).padding(.horizontal, 18).frame(height: 56).background(navy, in: RoundedRectangle(cornerRadius: 16))
        }.buttonStyle(.plain)
    }

    private func runningCard(_ r: RunningTimer) -> some View {
        let l = m.label(r.task)
        return VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(l.number).font(.system(size: 12.5, weight: .heavy)).foregroundStyle(l.color).padding(.horizontal, 7).padding(.vertical, 3).background(.white, in: RoundedRectangle(cornerRadius: 6))
                    Text(l.name).font(.system(size: 16, weight: .bold)).lineLimit(1)
                    Spacer()
                    Text(r.paused ? "Paused" : "Running").font(.system(size: 13, weight: .semibold)).opacity(0.85)
                }
                Text(l.sub).font(.system(size: 14)).opacity(0.85).lineLimit(1)
                HStack(alignment: .center) {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(hhmm(seconds: r.elapsed(ctx.date) + Double(m.loggedToday(r.task) * 60))).font(.system(size: 40, weight: .bold)).monospacedDigit()
                    }
                    Spacer()
                    Button { Task { if r.paused { await m.resume() } else { await m.pause() } } } label: {
                        Image(systemName: r.paused ? "play.fill" : "pause.fill").font(.system(size: 18)).frame(width: 48, height: 48).background(.white.opacity(0.2), in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel(r.paused ? "Resume" : "Pause")
                    Button { Task { await m.stop() } } label: {
                        Image(systemName: "stop.fill").font(.system(size: 18)).frame(width: 48, height: 48).background(.white, in: Circle()).foregroundStyle(l.color)
                    }.buttonStyle(.plain).accessibilityLabel("End and log")
                }
                gpsRow(white: true)
            }
            .foregroundStyle(.white).padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(l.color, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(runGreen, lineWidth: r.paused ? 0 : 3))
            .contentShape(RoundedRectangle(cornerRadius: 18))
            .onTapGesture { sheet = .running }
            .accessibilityAction(named: "Timer options") { sheet = .running }
    }

    @ViewBuilder func gpsRow(white: Bool) -> some View {
        Button {
            if m.gpsOn { TripTracker.shared.stop() } else { TripTracker.shared.start() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: m.gpsOn ? "location.fill" : "location")
                Text(m.gpsOn ? String(format: "Trip · %.1f mi", m.gpsMiles) : "Track mileage (GPS)").font(.system(size: 15, weight: .semibold))
                Spacer()
                Text(m.gpsOn ? "End trip" : "Start").font(.system(size: 14, weight: .semibold)).padding(.horizontal, 12).padding(.vertical, 6)
                    .background(white ? Color.white.opacity(0.2) : navy.opacity(0.1), in: Capsule())
            }.padding(.horizontal, 12).frame(height: 44).background(white ? Color.white.opacity(0.12) : Color.white, in: RoundedRectangle(cornerRadius: 12))
        }.buttonStyle(.plain)
    }

    private func cardView(_ c: TCard) -> some View {
        let oh = c.number == "OH", color = sectorColor(c.sector, number: c.number)
        let on = m.running?.task.key == c.task.key, isToday = m.day == m.today
        let sub = oh ? (c.task.activity ?? "Overhead") : [c.phaseName ?? c.phaseCode.flatMap { phaseNames[$0] }, c.task.activity].compactMap { $0 }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(oh ? "OH" : c.number).font(.system(size: 12.5, weight: .heavy)).foregroundStyle(color).padding(.horizontal, 7).padding(.vertical, 3).background(.white, in: RoundedRectangle(cornerRadius: 6))
                Text(oh ? "Overhead" : c.name).font(.system(size: 16, weight: .bold)).lineLimit(1)
                Spacer()
                if isToday {
                    Button { Task { if on { await m.stop() } else { await m.pickUp(c) } } } label: {
                        Image(systemName: on ? "stop.fill" : "play.fill").font(.system(size: 13)).frame(width: 36, height: 36)
                            .background(on ? runGreen : .white, in: Circle()).foregroundStyle(on ? .white : color)
                    }.buttonStyle(.plain).disabled(m.busy).accessibilityLabel(on ? "Stop and log" : "Start a timer on \(c.name)")
                }
            }
            Text(sub.isEmpty ? "—" : sub).font(.system(size: 14)).opacity(0.85).lineLimit(1)
            HStack {
                Text(c.task.role ?? "").font(.system(size: 14)).opacity(0.85)
                Spacer()
                if on, let r = m.running {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in Text(hhmm(seconds: r.elapsed(ctx.date) + Double(m.loggedToday(r.task) * 60))).font(.system(size: 18, weight: .bold)).monospacedDigit() }
                } else { Text(hhmm(minutes: c.minutes)).font(.system(size: 18, weight: .bold)).monospacedDigit() }
                Button { PortalController.current?.openEditCard(c, day: m.day) } label: { Image(systemName: "pencil").frame(width: 36, height: 36) }
                    .buttonStyle(.plain).accessibilityLabel("Edit time")
            }
        }
        .foregroundStyle(.white).padding(.horizontal, 16).padding(.vertical, 14)
        .background(color, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(runGreen, lineWidth: on ? 3 : 0))
    }
}

// MARK: - Start timer (GPS is part of it)

struct StartTimerSheet: View {
    @ObservedObject var m: TimeModel
    @Environment(\.dismiss) private var dismiss
    @State private var projectId = ""
    @State private var phaseId = ""
    @State private var role = ""
    @State private var activity = ""
    @State private var note = ""
    @State private var trip = false
    @State private var search = ""

    private var proj: Proj? { m.project(projectId) }

    var body: some View {
        NavigationStack {
            Form {
                if !m.recent.isEmpty && projectId.isEmpty {
                    Section("Recent") {
                        ForEach(m.recent, id: \.key) { t in
                            let l = m.label(t)
                            Button { use(t) } label: { taskRow(l.number, l.name, [l.sub, t.role].compactMap { $0 }.filter { $0 != "—" }.joined(separator: " · "), l.color) }
                        }
                    }
                }
                Section("Project") {
                    if let p = proj {
                        HStack { taskRow(p.isOH ? "OH" : p.number, p.isOH ? "Overhead" : p.name, nil, sectorColor(p.sector, number: p.number)); Spacer()
                            Button("Change") { projectId = ""; phaseId = ""; activity = "" }.font(.system(size: 15)) }
                    } else {
                        TextField("Search projects", text: $search).textInputAutocapitalization(.never).autocorrectionDisabled()
                        ForEach(filtered.prefix(40)) { p in
                            Button { choose(p) } label: { taskRow(p.isOH ? "OH" : p.number, p.isOH ? "Overhead" : p.name, nil, sectorColor(p.sector, number: p.number)) }
                        }
                    }
                }
                if let p = proj {
                    if !p.isOH && !p.phases.isEmpty {
                        Picker("Phase", selection: $phaseId) {
                            Text("No phase").tag("")
                            ForEach(p.phases) { ph in Text("\(ph.code) · \(ph.label)").tag(ph.id) }
                        }
                    }
                    Picker("Role", selection: $role) {
                        Text("No role").tag("")
                        ForEach(roles + (role.isEmpty || roles.contains(role) ? [] : [role]), id: \.self) { Text($0).tag($0) }
                    }
                    Picker(p.isOH ? "Overhead type" : "Activity", selection: $activity) {
                        Text("None").tag("")
                        ForEach(p.isOH ? overheadTypes : activities, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Note (optional)", text: $note, axis: .vertical)
                    Section {
                        Toggle(isOn: $trip) {
                            Label { VStack(alignment: .leading, spacing: 2) { Text("Track mileage (GPS)"); Text("Miles and site stops go with this task").font(.caption).foregroundStyle(.secondary) } }
                                icon: { Image(systemName: "location.fill").foregroundStyle(navy) }
                        }.disabled(m.gpsOn)
                        if m.gpsOn { Text(String(format: "A trip is already running (%.1f mi).", m.gpsMiles)).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if !m.error.isEmpty { Text(m.error).foregroundStyle(.red) }
            }
            .navigationTitle(m.running == nil ? "Start timer" : "Switch task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(m.running == nil ? "Start" : "Switch") {
                        Task {
                            await m.start(TaskKey(projectId: projectId, phaseId: phaseId.isEmpty ? nil : phaseId, role: role.isEmpty ? nil : role, activity: activity.isEmpty ? nil : activity),
                                          note: note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note, trip: trip)
                            if m.error.isEmpty { dismiss() }
                        }
                    }.bold().disabled(projectId.isEmpty || m.busy)
                }
            }
        }
    }

    private var filtered: [Proj] {
        let q = search.lowercased().trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? m.projects : m.projects.filter { $0.number.lowercased().contains(q) || $0.name.lowercased().contains(q) || ($0.isOH && "overhead".contains(q)) }
    }
    private func choose(_ p: Proj) { projectId = p.id; phaseId = ""; activity = ""; role = m.defaultRole(p.id); search = "" }
    private func use(_ t: TaskKey) { projectId = t.projectId; phaseId = t.phaseId ?? ""; role = t.role ?? m.defaultRole(t.projectId); activity = t.activity ?? "" }
    private func taskRow(_ chip: String, _ name: String, _ sub: String?, _ color: Color) -> some View {
        HStack(spacing: 10) {
            Text(chip).font(.system(size: 12.5, weight: .heavy)).foregroundStyle(.white).padding(.horizontal, 7).padding(.vertical, 3).background(color, in: RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 1) {
                Text(name).foregroundStyle(.primary).lineLimit(1)
                if let sub, !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
    }
}

// MARK: - Running timer (tap the card): time, GPS, switch, discard

struct RunningSheet: View {
    @ObservedObject var m: TimeModel
    @Environment(\.dismiss) private var dismiss
    @State private var switching = false
    @State private var confirmDiscard = false

    var body: some View {
        NavigationStack {
            List {
                if let r = m.running {
                    let l = m.label(r.task)
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Text(l.number).font(.system(size: 12.5, weight: .heavy)).foregroundStyle(.white).padding(.horizontal, 7).padding(.vertical, 3).background(l.color, in: RoundedRectangle(cornerRadius: 6))
                                Text(l.name).font(.headline).lineLimit(1)
                            }
                            Text([l.sub, r.task.role].compactMap { $0 }.filter { $0 != "—" }.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                                Text(hhmm(seconds: r.elapsed(ctx.date) + Double(m.loggedToday(r.task) * 60))).font(.system(size: 44, weight: .bold)).monospacedDigit()
                                    .foregroundStyle(r.paused ? Color.orange : runGreen)
                            }
                        }.padding(.vertical, 4)
                        HStack(spacing: 10) {
                            ForEach([15, 30, 60], id: \.self) { n in
                                Button(n == 60 ? "+1 hr" : "+\(n) min") { Task { await m.addTime(n) } }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                            }
                        }
                    }
                    Section("Mileage") {
                        Button {
                            if m.gpsOn { TripTracker.shared.stop(); dismiss() } else { TripTracker.shared.start() }
                        } label: {
                            HStack {
                                Image(systemName: m.gpsOn ? "location.fill" : "location").foregroundStyle(navy)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(m.gpsOn ? String(format: "Trip running · %.1f mi", m.gpsMiles) : "Track mileage (GPS)").foregroundStyle(.primary)
                                    Text(m.gpsOn ? "End the trip to save miles and site stops to \(l.number == "OH" ? "a project" : l.number)" : "Records miles and site stops for this task, even with the phone locked")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(m.gpsOn ? "End trip" : "Start").bold().foregroundStyle(m.gpsOn ? .red : navy)
                            }
                        }
                    }
                    Section {
                        Button(r.paused ? "Resume" : "Pause") { Task { if r.paused { await m.resume() } else { await m.pause() } } }
                        Button("Switch to another task…") { switching = true }
                        Button("End & log") { Task { await m.stop(); dismiss() } }.bold()
                        Button("Discard this time", role: .destructive) { confirmDiscard = true }
                    }
                    if !m.error.isEmpty { Text(m.error).foregroundStyle(.red) }
                } else {
                    Text("No timer running.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle(m.running?.paused == true ? "Paused" : "Running")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $switching) { StartTimerSheet(m: m).preferredColorScheme(.light) }
            .confirmationDialog("Discard the time on this timer? It won’t be logged.", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard", role: .destructive) { Task { await m.discard(); dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
