import SwiftUI
import PhotosUI
import WebKit

// The Settings tab, native and in the app's own design: your profile, notifications and devotion reminders, drafts,
// saved posts, muted members, and (for administrators) members waiting for approval and reports.

struct Me { var name = "", bio = "", avatar: URL? = nil, role = "member", since = "" }
struct Pref: Equatable { var tagged = true, likes = true, study = true, reading = true, email = false }
struct Reminders: Equatable { var morning = false, noon = false, evening = false, morningAt = "07:00", noonAt = "12:00", eveningAt = "19:00" }
private struct Draft: Identifiable { let id: String, title: String, when: Date, scheduled: Bool }
private struct Report: Identifiable { let id: String, reporter: String, reason: String, post: String?, created: Date }

private enum SettingsSheet: String, Identifiable { case profile, members, notifications, drafts, mutes, reports; var id: String { rawValue } }

final class SettingsModel: ObservableObject {
    @Published var me = Me()
    @Published var prefs = Pref()
    @Published var reminders = Reminders()
    @Published fileprivate var drafts: [Draft] = []
    @Published var mutes: [String] = []
    @Published var members: [(String, Person, String)] = []      // id, person, role
    @Published var pending: [(String, Person)] = []
    @Published fileprivate var reports: [Report] = []
    @Published var loaded = false
    var admin: Bool { me.role == "administrator" }
    weak var feed: FeedModel?

    @MainActor func load() async {
        guard let a = await feed?.auth() else { return }; let db = Supa(a: a)
        async let P = db.rows("/rest/v1/profiles?id=eq.\(a.me)&select=display_name,bio,avatar_url,role,created_at")
        async let N = db.rows("/rest/v1/notification_preferences?user_id=eq.\(a.me)&select=*")
        async let R = db.rows("/rest/v1/devotion_reminders?user_id=eq.\(a.me)&select=morning,noon,evening,morning_at,noon_at,evening_at")
        async let D = db.rows("/rest/v1/post_drafts?user_id=eq.\(a.me)&select=id,title,body,updated_at&order=updated_at.desc")
        async let SC = db.rows("/rest/v1/asides?user_id=eq.\(a.me)&publish_at=not.is.null&select=id,title,publish_at&order=publish_at")
        async let M = db.rows("/rest/v1/member_mutes?user_id=eq.\(a.me)&select=muted_user_id")
        async let ALL = db.rows("/rest/v1/profiles?select=id,display_name,avatar_url,role,status&order=display_name")
        guard let res = try? await (P, N, R, D, SC, M, ALL) else { return }
        let (p, n, r, d, sc, m, all) = res
        if let x = p.first {
            me = Me(name: x["display_name"] as? String ?? "", bio: x["bio"] as? String ?? "", avatar: (x["avatar_url"] as? String).flatMap(URL.init(string:)),
                    role: x["role"] as? String ?? "member", since: String((x["created_at"] as? String ?? "").prefix(4)))
        }
        if let x = n.first {
            prefs = Pref(tagged: x["tagged_posts"] as? Bool ?? true, likes: x["likes"] as? Bool ?? true, study: x["next_study"] as? Bool ?? true,
                         reading: x["reading_changes"] as? Bool ?? true, email: x["email_notifications"] as? Bool ?? false)
        }
        if let x = r.first {
            let t = { (k: String, d: String) in String((x[k] as? String ?? d).prefix(5)) }
            reminders = Reminders(morning: x["morning"] as? Bool ?? false, noon: x["noon"] as? Bool ?? false, evening: x["evening"] as? Bool ?? false,
                                  morningAt: t("morning_at", "07:00"), noonAt: t("noon_at", "12:00"), eveningAt: t("evening_at", "19:00"))
        }
        drafts = sc.map { Draft(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "Untitled", when: parseDate($0["publish_at"]), scheduled: true) }
            + d.map { x in Draft(id: x["id"] as? String ?? "", title: (x["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? String((x["body"] as? String ?? "Untitled").prefix(60)), when: parseDate(x["updated_at"]), scheduled: false) }
        mutes = m.compactMap { $0["muted_user_id"] as? String }
        let person = { (x: [String: Any]) in Person(name: x["display_name"] as? String ?? "", avatar: (x["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }) }
        members = all.filter { $0["status"] as? String == "approved" }.map { ($0["id"] as? String ?? "", person($0), $0["role"] as? String ?? "member") }
        if admin {
            pending = all.filter { $0["status"] as? String == "pending" }.map { ($0["id"] as? String ?? "", person($0)) }
            let rep = (try? await db.rows("/rest/v1/reports?status=eq.open&select=id,reporter_id,reason,aside_id,created_at&order=created_at.desc")) ?? []
            reports = rep.map { Report(id: $0["id"] as? String ?? "", reporter: $0["reporter_id"] as? String ?? "", reason: $0["reason"] as? String ?? "", post: $0["aside_id"] as? String, created: parseDate($0["created_at"])) }
        }
        loaded = true
    }
    @MainActor func savePrefs() async {
        guard let a = await feed?.auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/notification_preferences?on_conflict=user_id", json: ["user_id": a.me, "tagged_posts": prefs.tagged, "likes": prefs.likes, "next_study": prefs.study,
            "reading_changes": prefs.reading, "email_notifications": prefs.email, "updated_at": ISO8601DateFormatter().string(from: Date())], prefer: "resolution=merge-duplicates")
    }
    @MainActor func saveReminders() async {
        guard let a = await feed?.auth() else { return }
        _ = try? await Supa(a: a).req("POST", "/rest/v1/devotion_reminders?on_conflict=user_id", json: ["user_id": a.me, "morning": reminders.morning, "noon": reminders.noon, "evening": reminders.evening,
            "morning_at": reminders.morningAt, "noon_at": reminders.noonAt, "evening_at": reminders.eveningAt, "tz": TimeZone.current.identifier,
            "updated_at": ISO8601DateFormatter().string(from: Date())], prefer: "resolution=merge-duplicates")
    }
    @MainActor func saveProfile(name: String, bio: String) async -> String? {
        guard let a = await feed?.auth() else { return "You’re signed out." }
        do { try await Supa(a: a).req("PATCH", "/rest/v1/profiles?id=eq.\(a.me)", json: ["display_name": name, "bio": bio.isEmpty ? NSNull() as Any : bio as Any]); me.name = name; me.bio = bio; await feed?.load(quiet: true); return nil }
        catch { return error.localizedDescription }
    }
    @MainActor func setPhoto(_ img: UIImage, field: String) async -> String? {
        guard let a = await feed?.auth() else { return "You’re signed out." }; let db = Supa(a: a)
        do {
            let url = try await db.upload(img, bucket: "avatars")
            try await db.req("PATCH", "/rest/v1/profiles?id=eq.\(a.me)", json: [field: url])
            if field == "avatar_url" { me.avatar = URL(string: url) }
            await feed?.load(quiet: true); return nil
        } catch { return error.localizedDescription }
    }
    @MainActor func decide(_ id: String, approve: Bool) async {
        pending.removeAll { $0.0 == id }
        guard let a = await feed?.auth() else { return }
        _ = try? await Supa(a: a).req("PATCH", "/rest/v1/profiles?id=eq.\(id)", json: ["status": approve ? "approved" : "rejected"])
        await load()
    }
    @MainActor func unmute(_ id: String) async {
        mutes.removeAll { $0 == id }; ChatSession.shared.blocked.remove(id)
        guard let a = await feed?.auth() else { return }
        _ = try? await Supa(a: a).req("DELETE", "/rest/v1/member_mutes?user_id=eq.\(a.me)&muted_user_id=eq.\(id)")
        await feed?.load(quiet: true)
    }
    @MainActor fileprivate func deleteScheduled(_ d: Draft) async {
        drafts.removeAll { $0.id == d.id }
        guard let a = await feed?.auth() else { return }
        _ = try? await Supa(a: a).req("DELETE", "/rest/v1/asides?id=eq.\(d.id)")
    }
    @MainActor fileprivate func resolve(_ r: Report, removePost: Bool) async {
        reports.removeAll { $0.id == r.id }
        guard let a = await feed?.auth() else { return }; let db = Supa(a: a)
        if removePost, let p = r.post { _ = try? await db.req("DELETE", "/rest/v1/asides?id=eq.\(p)") }
        _ = try? await db.req("PATCH", "/rest/v1/reports?id=eq.\(r.id)", json: ["status": removePost ? "resolved" : "dismissed"])
        if removePost { await feed?.load(quiet: true) }
    }
}

struct SettingsScreen: View {
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @StateObject private var m = SettingsModel()
    @State private var sheet: SettingsSheet?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deletingAccount = false
    @State private var deleteError: String?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Settings").font(.serif(20, .semibold)).tracking(-0.2).foregroundStyle(T.ink).padding(.horizontal, 20).padding(.top, 12)
                    Button { Haptic.tap(); openProfileEdit(feed) } label: {
                        HStack(spacing: 14) {
                            Face(name: m.me.name, url: m.me.avatar, s: 60)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.me.name).font(.sans(17, .bold)).foregroundStyle(T.ink)
                                Text("\(m.me.role.capitalized)\(m.me.since.isEmpty ? "" : " · since \(m.me.since)")").font(.sans(14)).foregroundStyle(T.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Chevron()
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
                        .padding(.horizontal, 16).padding(.top, 10)
                    }.buttonStyle(Press(scale: 0.98))

                    Card14 {
                        GroupRow(icon: "members", label: "Members", action: { sheet = .members }) { HStack(spacing: 8) { CountText(n: m.members.count); LikeBadge(n: m.admin ? m.pending.count : 0); Chevron() } }; GroupLine()
                        GroupRow(icon: "bell", label: "Notifications", action: { sheet = .notifications }) { Chevron() }; GroupLine()
                        GroupRow(icon: "pencil", label: "Drafts and scheduled", action: { sheet = .drafts }) { HStack(spacing: 8) { CountText(n: m.drafts.count); Chevron() } }; GroupLine()
                        GroupRow(icon: "bookmark", label: "Saved posts", action: { presentSlide(SavedScreen(feed: feed)) }) { Chevron() }
                    }
                    .padding(.top, 12)
                    Card14 {
                        GroupRow(icon: "mute", label: "Blocked members", action: { sheet = .mutes }) { HStack(spacing: 8) { CountText(n: m.mutes.count); Chevron() } }
                        if m.admin { GroupLine(); GroupRow(icon: "flag", label: "Reports", action: { sheet = .reports }) { HStack(spacing: 8) { LikeBadge(n: m.reports.count); Chevron() } } }
                    }
                    .padding(.top, 12)
                    if m.admin { Text("Reports are shown to administrators only.").font(.sans(12)).foregroundStyle(T.muted).padding(.horizontal, 30).padding(.top, 6) }
                    Card14 {
                        GroupRow(icon: "link", label: "Open the classic site", action: { openInApp(URL(string: "https://lotmstudy.org/?classic=1")!) }) { Text("↗").font(.sans(15)).foregroundStyle(T.chev) }; GroupLine()
                        GroupRow(icon: "link", label: "Terms of Use", action: { openInApp(URL(string: "https://lotmstudy.org/terms")!) }) { Text("↗").font(.sans(15)).foregroundStyle(T.chev) }; GroupLine()
                        GroupRow(icon: "link", label: "Privacy Policy", action: { openInApp(URL(string: "https://lotmstudy.org/privacy")!) }) { Text("↗").font(.sans(15)).foregroundStyle(T.chev) }; GroupLine()
                        GroupRow(icon: "link", label: "Help and support", action: { openInApp(URL(string: "https://lotmstudy.org/support")!) }) { Text("↗").font(.sans(15)).foregroundStyle(T.chev) }; GroupLine()
                        GroupRow(icon: "logout", label: "Sign out", danger: true, action: { confirmSignOut = true }) { EmptyView() }
                    }
                    .padding(.top, 12)
                    Card14 {
                        GroupRow(icon: "trash", label: deletingAccount ? "Deleting…" : "Delete account", danger: true, action: { if !deletingAccount { confirmDelete = true } }) { EmptyView() }
                    }
                    .padding(.top, 12)
                    Text("Deleting your account permanently removes your profile, posts, replies, notes and chat keys.").font(.sans(12)).foregroundStyle(T.muted).padding(.horizontal, 30).padding(.top, 6)
                    Text("Life of the Mind · version 2.0").font(.sans(12)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(.top, 14)
                    Color.clear.frame(height: 110)
                }
            }
            .refreshable { await m.load() }
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { m.feed = feed; await m.load() }
        .onReceive(NotificationCenter.default.publisher(for: .lotmProfileChanged)) { _ in Task { await m.load() } }
        .sheet(item: $sheet) { s in sheetView(s).presentationDetents([.medium, .large]) }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete my account", role: .destructive) { Task { await deleteAccount() } }
        } message: { Text("This permanently removes your profile, posts, replies, notes and chat keys. It cannot be undone.") }
        .alert("Couldn’t delete the account", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) { Button("OK", role: .cancel) {} } message: { Text(deleteError ?? "") }
        .confirmationDialog("Sign out of Life of the Mind?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                UserDefaults.standard.removeObject(forKey: "lotm.me")
                web.view.evaluateJavaScript("window.lotmSignOut && window.lotmSignOut()")
                web.select(.feed)
            }
        }
    }

    private func deleteAccount() async {
        guard let a = await feed.auth() else { deleteError = "You’re not signed in."; return }
        deletingAccount = true; defer { deletingAccount = false }
        do {
            _ = try await Supa(a: a).req("POST", "/functions/v1/delete-account", json: ["confirm": "DELETE"])
            UserDefaults.standard.removeObject(forKey: "lotm.me"); UserDefaults.standard.removeObject(forKey: "lotm.feed." + a.me)
            web.view.evaluateJavaScript("window.lotmSignOut && window.lotmSignOut()", completionHandler: nil)
            web.select(.feed)
        } catch { deleteError = error.localizedDescription }
    }

    @ViewBuilder private func sheetView(_ s: SettingsSheet) -> some View {
        switch s {
        case .profile: ProfileSheet(m: m) { sheet = nil; web.go("/member/\(feed.me)") }
        case .members: MembersSheet(m: m) { id in sheet = nil; web.go("/member/\(id)") }
        case .notifications: NotificationsSheet(m: m)
        case .drafts: DraftsSheet(m: m) { id in sheet = nil; web.go("/write?draft=\(id)") }
        case .mutes: MutesSheet(m: m, people: feed.people)
        case .reports: ReportsSheet(m: m, people: feed.people) { id in sheet = nil; feed.open(id, false) }
        }
    }
}

// MARK: - Sheets (the app's .sheet: card colour, grab bar, .group lists)

private struct SheetEyebrow: View {
    let t: String
    var body: some View { Eyebrow(t: t).padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 2) }
}
private struct Note: View {
    let t: String
    var body: some View { Text(t).font(.sans(12.5)).foregroundStyle(T.muted).lineSpacing(3).padding(.horizontal, 30).padding(.top, 6) }
}
private struct Field: View {
    let label: String
    @Binding var text: String
    var lines = 1
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.sans(13, .semibold)).foregroundStyle(T.muted)
            TextField("", text: $text, axis: lines > 1 ? .vertical : .horizontal).lineLimit(lines...max(lines, 6))
                .font(.sans(16)).foregroundStyle(T.ink).padding(.horizontal, 12).padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 12).fill(T.paper)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.softBd))
        }
    }
}
/// .btn — the solid button.
private struct SolidButton: ButtonStyle {
    var ghost = false
    var h: CGFloat = 48
    func makeBody(configuration c: Configuration) -> some View {
        c.label.font(.sans(16, .semibold)).foregroundStyle(ghost ? T.ink : T.paper)
            .frame(maxWidth: .infinity).frame(height: h)
            .background(RoundedRectangle(cornerRadius: 14).fill(ghost ? .clear : T.ink))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(ghost ? T.softBd : .clear))
            .scaleEffect(c.isPressed ? 0.97 : 1).animation(.easeOut(duration: 0.1), value: c.isPressed)
    }
}

private struct ProfileSheet: View {
    @ObservedObject var m: SettingsModel
    let viewProfile: () -> Void
    @State private var name = ""
    @State private var bio = ""
    @State private var pickAvatar: PhotosPickerItem?
    @State private var pickBanner: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        SheetBody {
            VStack(spacing: 12) {
                PhotosPicker(selection: $pickAvatar, matching: .images) {
                    VStack(spacing: 4) { Face(name: m.me.name, url: m.me.avatar, s: 84); Text(busy ? "Uploading…" : "Change photo").font(.sans(13)).foregroundStyle(T.muted) }
                }
                Field(label: "Name", text: $name)
                Field(label: "Bio", text: $bio, lines: 3)
                PhotosPicker(selection: $pickBanner, matching: .images) { Text("Change banner image").font(.sans(16, .semibold)).foregroundStyle(T.ink).frame(maxWidth: .infinity).frame(height: 48).overlay(RoundedRectangle(cornerRadius: 14).stroke(T.softBd)) }
                Button("Save") {
                    Task { busy = true; error = await m.saveProfile(name: name.trimmingCharacters(in: .whitespaces), bio: bio.trimmingCharacters(in: .whitespacesAndNewlines)); busy = false; if error == nil { Haptic.tap(); dismiss() } }
                }
                .buttonStyle(SolidButton()).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                if let error { Text(error).font(.sans(14)).foregroundStyle(T.danger) }
                Button("View my profile", action: viewProfile).font(.sans(14)).foregroundStyle(T.muted)
            }
            .padding(.horizontal, 20)
        }
        .onAppear { name = m.me.name; bio = m.me.bio }
        .onChange(of: pickAvatar) { _, it in upload(it, "avatar_url") }
        .onChange(of: pickBanner) { _, it in upload(it, "background_url") }
    }
    private func upload(_ it: PhotosPickerItem?, _ field: String) {
        guard let it else { return }
        Task {
            busy = true
            if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { error = await m.setPhoto(img, field: field) }
            busy = false; pickAvatar = nil; pickBanner = nil
            if error == nil { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        }
    }
}

private struct MembersSheet: View {
    @ObservedObject var m: SettingsModel
    let open: (String) -> Void
    var body: some View {
        SheetBody {
            if m.admin && !m.pending.isEmpty {
                SheetEyebrow(t: "Waiting for approval")
                Card14 {
                    ForEach(m.pending, id: \.0) { item in
                        HStack(spacing: 10) {
                            Face(item.1, s: 34)
                            Text(item.1.name).font(.sans(15)).foregroundStyle(T.ink).frame(maxWidth: .infinity, alignment: .leading)
                            Button("Decline") { Task { await m.decide(item.0, approve: false) } }.font(.sans(14, .semibold)).foregroundStyle(T.muted)
                            Button("Approve") { Task { await m.decide(item.0, approve: true) } }.font(.sans(14, .semibold)).foregroundStyle(T.paper).padding(.horizontal, 12).frame(height: 32).background(RoundedRectangle(cornerRadius: 10).fill(T.ink))
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                    }
                }
            }
            Card14 {
                ForEach(Array(m.members.enumerated()), id: \.element.0) { k, item in
                    if k > 0 { GroupLine() }
                    Button { Haptic.tap(); open(item.0) } label: {
                        HStack(spacing: 14) {
                            Face(item.1, s: 34)
                            Text(item.1.name).font(.sans(15)).foregroundStyle(T.ink).frame(maxWidth: .infinity, alignment: .leading)
                            if item.2 != "member" { Text(item.2.capitalized).font(.sans(13)).foregroundStyle(T.muted) }
                        }
                        .padding(.horizontal, 16).frame(minHeight: 50).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }
            .padding(.top, 10)
        }
    }
}

private struct NotificationsSheet: View {
    @ObservedObject var m: SettingsModel
    var body: some View {
        SheetBody {
            Card14 {
                Text("Notifications are on for the iPhone app. To turn them off or change how they appear, go to iPhone Settings › Notifications › LOTM.")
                    .font(.sans(14)).foregroundStyle(T.ink).lineSpacing(3).padding(.horizontal, 16).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
            }
            Card14 {
                toggle("When I am mentioned", $m.prefs.tagged); GroupLine()
                toggle("Likes on my posts", $m.prefs.likes); GroupLine()
                toggle("Next study reminders", $m.prefs.study); GroupLine()
                toggle("Reading changes", $m.prefs.reading); GroupLine()
                toggle("Also by email", $m.prefs.email)
            }
            .padding(.top, 10)
            SheetEyebrow(t: "Devotion").padding(.top, 4)
            Card14 {
                reminder("Morning Prayer", $m.reminders.morning, $m.reminders.morningAt); GroupLine()
                reminder("Noonday Prayer", $m.reminders.noon, $m.reminders.noonAt); GroupLine()
                reminder("Evening Prayer", $m.reminders.evening, $m.reminders.eveningAt)
            }
            Note(t: "A notification arrives when each prayer is ready to be prayed, while a devotional is running. Tap it to open that office.")
        }
        .onChange(of: m.prefs) { _, _ in Task { await m.savePrefs() } }
        .onChange(of: m.reminders) { _, _ in Task { await m.saveReminders() } }
    }
    private func toggle(_ label: String, _ on: Binding<Bool>) -> some View {
        GroupRow(label: label, action: { on.wrappedValue.toggle() }) { Switch(on: on.wrappedValue) }
    }
    private func reminder(_ label: String, _ on: Binding<Bool>, _ at: Binding<String>) -> some View {
        VStack(spacing: 0) {
            toggle(label, on)
            if on.wrappedValue {
                HStack {
                    Text("Remind me at").font(.sans(15)).foregroundStyle(T.muted)
                    Spacer()
                    DatePicker("", selection: Binding(get: { time(at.wrappedValue) }, set: { at.wrappedValue = hhmm($0) }), displayedComponents: .hourAndMinute).labelsHidden()
                }
                .padding(.leading, 32).padding(.trailing, 16).frame(minHeight: 44)
            }
        }
    }
    private func time(_ s: String) -> Date { let p = s.split(separator: ":").compactMap { Int($0) }; return Calendar.current.date(bySettingHour: p.first ?? 7, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date() }
    private func hhmm(_ d: Date) -> String { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0) }
}

private struct DraftsSheet: View {
    @ObservedObject var m: SettingsModel
    let open: (String) -> Void
    @State private var deleting: Draft?
    var body: some View {
        SheetBody {
            let sched = m.drafts.filter(\.scheduled), drafts = m.drafts.filter { !$0.scheduled }
            if !sched.isEmpty {
                SheetEyebrow(t: "Scheduled")
                Card14 { ForEach(Array(sched.enumerated()), id: \.element.id) { k, d in if k > 0 { GroupLine() }; row(d, d.when.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())) { deleting = d } } }
            }
            SheetEyebrow(t: "Drafts").padding(.top, 8)
            Card14 {
                if drafts.isEmpty { Text("No drafts.").font(.sans(15)).foregroundStyle(T.muted).padding(16).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(Array(drafts.enumerated()), id: \.element.id) { k, d in if k > 0 { GroupLine() }; row(d, ago(d.when)) { open(d.id) } }
            }
        }
        .confirmationDialog("Delete this scheduled post?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let d = deleting { Task { await m.deleteScheduled(d) } } }
        }
    }
    private func row(_ d: Draft, _ sub: String, _ run: @escaping () -> Void) -> some View {
        Button { Haptic.tap(); run() } label: {
            HStack { Text(d.title).font(.serif(16)).foregroundStyle(T.ink).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading); Text(sub).font(.sans(13)).foregroundStyle(T.muted) }
                .padding(.horizontal, 16).frame(minHeight: 50).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

private struct MutesSheet: View {
    @ObservedObject var m: SettingsModel
    let people: [String: Person]
    var body: some View {
        SheetBody {
            Card14 {
                if m.mutes.isEmpty { Text("You haven’t blocked anyone.").font(.sans(15)).foregroundStyle(T.muted).padding(16).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(Array(m.mutes.enumerated()), id: \.element) { k, id in
                    if k > 0 { GroupLine() }
                    Button { Haptic.tap(); Task { await m.unmute(id) } } label: {
                        HStack(spacing: 14) { Face(people[id], s: 30); Text(people[id]?.name ?? "Member").font(.sans(15)).foregroundStyle(T.ink).frame(maxWidth: .infinity, alignment: .leading); Text("Unmute").font(.sans(13)).foregroundStyle(T.muted) }
                            .padding(.horizontal, 16).frame(minHeight: 50).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }
        }
    }
}

private struct ReportsSheet: View {
    @ObservedObject var m: SettingsModel
    let people: [String: Person]
    let openPost: (String) -> Void
    @State private var removing: Report?
    var body: some View {
        SheetBody {
            VStack(spacing: 10) {
                if m.reports.isEmpty { Text("No open reports.").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(m.reports) { r in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(people[r.reporter]?.name ?? "A member") · \(r.created.formatted(date: .numeric, time: .omitted))").font(.sans(13)).foregroundStyle(T.muted)
                        Text(r.reason.isEmpty ? "(no reason given)" : r.reason).font(.sans(15)).foregroundStyle(T.ink)
                        if let p = r.post { Button("View post") { openPost(p) }.font(.sans(15)).foregroundStyle(T.ticker) }
                        HStack(spacing: 8) {
                            Button("Dismiss") { Task { await m.resolve(r, removePost: false) } }.buttonStyle(SolidButton(ghost: true, h: 34))
                            if r.post != nil { Button("Delete post") { removing = r }.buttonStyle(SolidButton(h: 34)) }
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14).background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
                }
            }
            .padding(.horizontal, 16)
        }
        .confirmationDialog("Delete the reported post for everyone?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Delete post", role: .destructive) { if let r = removing { Task { await m.resolve(r, removePost: true) } } }
        }
    }
}

// MARK: - Saved posts

private struct SavedHit: Identifiable { let id: String, userId: String, title: String, text: String, created: Date; var key = ""; var uid: String { key.isEmpty ? id : key } }

struct SavedScreen: View {
    @ObservedObject var feed: FeedModel
    @Environment(\.closeScreen) private var close
    @State private var items: [SavedHit] = []
    @State private var loaded = false
    var body: some View {
        VStack(spacing: 0) {
            PageBar(title: "Saved posts", back: "Settings") { close() }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(items, id: \.uid) { h in HitRow(person: feed.people[h.userId], title: h.title, text: h.text, created: h.created) { feed.open(h.id, false) } }
                    if loaded && items.isEmpty { Text("Nothing saved yet.").font(.serif(17)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
                    if !loaded { Text("Loading…").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
                }
            }
            .refreshable { await load() }
        }
        .background(T.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await load() }
    }
    @MainActor private func load() async {
        guard let a = await feed.auth() else { loaded = true; return }; let db = Supa(a: a)
        let ids = ((try? await db.rows("/rest/v1/saved_posts?user_id=eq.\(a.me)&select=aside_id")) ?? []).compactMap { $0["aside_id"] as? String }
        let saved = (try? await db.rows("/rest/v1/saved_comments?user_id=eq.\(a.me)&select=comments(id,aside_id,user_id,body,created_at)&order=created_at.desc")) ?? []
        let comments: [SavedHit] = saved.compactMap { $0["comments"] as? [String: Any] }.map { c in
            SavedHit(id: c["aside_id"] as? String ?? "", userId: c["user_id"] as? String ?? "", title: "Reply", text: c["body"] as? String ?? "", created: parseDate(c["created_at"]), key: "c" + (c["id"] as? String ?? ""))
        }
        if ids.isEmpty { items = comments; loaded = true; return }
        let rows = (try? await db.rows("/rest/v1/asides?id=in.(\(ids.joined(separator: ",")))&select=id,user_id,title,body,created_at&order=created_at.desc")) ?? []
        items = comments + rows.map { r in
            let title = r["title"] as? String ?? "", body = r["body"] as? String ?? ""
            return SavedHit(id: r["id"] as? String ?? "", userId: r["user_id"] as? String ?? "", title: body.lowercased().hasPrefix(title.lowercased().prefix(20)) ? "" : title, text: body, created: parseDate(r["created_at"]))
        }
        items.sort { $0.created > $1.created }
        loaded = true
    }
}

/// A post in a list (search results, saved posts): face, name and time, title, a few lines of the writing.
struct HitRow: View {
    let person: Person?, title: String, text: String, created: Date
    let tap: () -> Void
    var body: some View {
        Button { Haptic.tap(); tap() } label: {
            HStack(alignment: .top, spacing: 12) {
                Face(person, s: 36)
                VStack(alignment: .leading, spacing: 3) {
                    (Text(person?.name ?? "Member").font(.sans(14, .semibold)).foregroundColor(T.ink) + Text(" · \(ago(created))").font(.sans(14)).foregroundColor(T.muted))
                    if !title.isEmpty { Text(title).font(.serif(18, .semibold)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.leading) }
                    Text(text).font(.serif(17)).foregroundStyle(T.ink).lineLimit(4).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.vertical, 14).overlay(alignment: .bottom) { T.rule.frame(height: 1) }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
