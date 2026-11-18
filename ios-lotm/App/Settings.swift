import SwiftUI
import PhotosUI
import WebKit

// The Settings tab, native: your profile, notifications and devotion reminders, drafts, saved posts, muted members,
// and (for administrators) members waiting for approval and reports.

private struct Row<Trailing: View>: View {
    let icon: String, label: String
    var danger = false
    let action: () -> Void
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        Button(action: { Haptic.tap(); action() }) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 18)).frame(width: 26).foregroundStyle(danger ? Color(red: 0.9, green: 0.56, blue: 0.5) : S.ink)
                Text(label).font(.system(size: 17)).foregroundStyle(danger ? Color(red: 0.9, green: 0.56, blue: 0.5) : S.ink)
                Spacer()
                trailing()
            }
            .padding(.horizontal, 16).frame(minHeight: 52).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
private extension Row where Trailing == AnyView {
    init(_ icon: String, _ label: String, count: Int? = nil, badge: Int = 0, chevron: Bool = true, danger: Bool = false, action: @escaping () -> Void) {
        self.init(icon: icon, label: label, danger: danger, action: action) {
            AnyView(HStack(spacing: 8) {
                if let count { Text("\(count)").font(.system(size: 15)).foregroundStyle(S.muted) }
                if badge > 0 { Text("\(badge)").font(.system(size: 12, weight: .bold)).foregroundStyle(.white).padding(.horizontal, 6).frame(minWidth: 20, minHeight: 20).background(Capsule().fill(Color(red: 0.88, green: 0.54, blue: 0.6))) }
                if chevron { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(S.muted.opacity(0.8)) }
            })
        }
    }
}
private struct Box<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: 16).fill(S.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(S.rule))
            .padding(.horizontal, 16)
    }
}
private struct Line: View { var body: some View { S.rule.frame(height: 0.5).padding(.leading, 56) } }
private struct Toggler: View {
    let label: String
    @Binding var on: Bool
    var body: some View {
        Toggle(isOn: $on) { Text(label).font(.system(size: 17)).foregroundStyle(S.ink) }
            .tint(Color(red: 0.2, green: 0.78, blue: 0.35)).padding(.horizontal, 16).frame(minHeight: 52)
    }
}

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
        mutes.removeAll { $0 == id }
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Settings").font(.system(size: 30, weight: .semibold, design: .serif)).foregroundStyle(S.ink).padding(.horizontal, 20).padding(.top, 8)
                Button { Haptic.tap(); sheet = .profile } label: {
                    HStack(spacing: 14) {
                        PersonFace(p: Person(name: m.me.name, avatar: m.me.avatar), size: 60)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.me.name).font(.system(size: 18, weight: .bold)).foregroundStyle(S.ink)
                            Text("\(m.me.role.capitalized)\(m.me.since.isEmpty ? "" : " · since \(m.me.since)")").font(.system(size: 14)).foregroundStyle(S.muted)
                            Text("Edit profile").font(.system(size: 14, weight: .semibold)).foregroundStyle(S.sub)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(S.muted)
                    }
                    .padding(14).background(RoundedRectangle(cornerRadius: 16).fill(S.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(S.rule))
                    .padding(.horizontal, 16)
                }.buttonStyle(.plain)

                Box {
                    Row("person.2", "Members", count: m.members.count, badge: m.admin ? m.pending.count : 0) { sheet = .members }
                    Line()
                    Row("bell", "Notifications") { sheet = .notifications }
                    Line()
                    Row("square.and.pencil", "Drafts and scheduled", count: m.drafts.count) { sheet = .drafts }
                    Line()
                    Row("bookmark", "Saved posts") { presentSlide(SavedScreen(feed: feed)) }
                }
                Box {
                    Row("speaker.slash", "Muted members", count: m.mutes.count) { sheet = .mutes }
                    if m.admin { Line(); Row("flag", "Reports", badge: m.reports.count) { sheet = .reports } }
                }
                Box {
                    Row("safari", "Open the classic site", chevron: false) { openInApp(URL(string: "https://lotmstudy.org/")!) }
                    Line()
                    Row("rectangle.portrait.and.arrow.right", "Sign out", chevron: false, danger: true) { confirmSignOut = true }
                }
                Text("Life of the Mind · version 2.0").font(.system(size: 12)).foregroundStyle(S.muted).frame(maxWidth: .infinity).padding(.top, 4)
                Color.clear.frame(height: 110)
            }
            .padding(.top, 6)
        }
        .refreshable { await m.load() }
        .background(S.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { m.feed = feed; await m.load() }
        .sheet(item: $sheet) { s in
            sheetView(s).presentationDragIndicator(.visible).presentationBackground(S.paper).presentationCornerRadius(24)
        }
        .confirmationDialog("Sign out of Life of the Mind?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                UserDefaults.standard.removeObject(forKey: "lotm.me")
                web.view.evaluateJavaScript("window.lotmSignOut && window.lotmSignOut()")
                web.select(.feed)
            }
        }
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

// MARK: - Sheets

private struct SheetTitle: View {
    let t: String
    var body: some View { Text(t).font(.system(size: 22, weight: .semibold, design: .serif)).foregroundStyle(S.ink).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 6) }
}
private struct Caption: View {
    let t: String
    var body: some View { Text(t).font(.system(size: 13)).foregroundStyle(S.muted).lineSpacing(2).padding(.horizontal, 32).padding(.top, -6) }
}
private struct Eyebrow: View {
    let t: String
    var body: some View { Text(t.uppercased()).font(.system(size: 11, weight: .bold)).tracking(0.9).foregroundStyle(S.muted).padding(.horizontal, 32).padding(.top, 10) }
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
        ScrollView {
            VStack(spacing: 16) {
                PhotosPicker(selection: $pickAvatar, matching: .images) {
                    VStack(spacing: 6) {
                        PersonFace(p: Person(name: m.me.name, avatar: m.me.avatar), size: 88)
                        Text(busy ? "Uploading…" : "Change photo").font(.system(size: 14, weight: .semibold)).foregroundStyle(S.sub)
                    }
                }
                .padding(.top, 28)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Name").font(.system(size: 13, weight: .semibold)).foregroundStyle(S.muted)
                    TextField("Your name", text: $name).font(.system(size: 17)).foregroundStyle(S.ink).padding(12).background(RoundedRectangle(cornerRadius: 12).fill(S.card))
                    Text("Bio").font(.system(size: 13, weight: .semibold)).foregroundStyle(S.muted).padding(.top, 8)
                    TextField("A line about you", text: $bio, axis: .vertical).lineLimit(3...6).font(.system(size: 17, design: .serif)).foregroundStyle(S.ink).padding(12).background(RoundedRectangle(cornerRadius: 12).fill(S.card))
                }
                .padding(.horizontal, 20)
                PhotosPicker(selection: $pickBanner, matching: .images) {
                    Text("Change banner image").font(.system(size: 16, weight: .semibold)).foregroundStyle(S.ink).frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 14).stroke(S.rule))
                }
                .padding(.horizontal, 20)
                Button {
                    Task { busy = true; error = await m.saveProfile(name: name.trimmingCharacters(in: .whitespaces), bio: bio.trimmingCharacters(in: .whitespacesAndNewlines)); busy = false; if error == nil { Haptic.tap(); dismiss() } }
                } label: {
                    Text("Save").font(.system(size: 17, weight: .semibold)).foregroundStyle(S.paper).frame(maxWidth: .infinity).frame(height: 50).background(RoundedRectangle(cornerRadius: 14).fill(S.ink))
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy).padding(.horizontal, 20)
                if let error { Text(error).font(.system(size: 14)).foregroundStyle(Color(red: 0.9, green: 0.56, blue: 0.5)) }
                Button("View my profile", action: viewProfile).font(.system(size: 15)).foregroundStyle(S.muted)
            }
            .padding(.bottom, 30)
        }
        .onAppear { name = m.me.name; bio = m.me.bio }
        .onChange(of: pickAvatar) { _, it in upload(it, "avatar_url") }
        .onChange(of: pickBanner) { _, it in upload(it, "background_url") }
        .preferredColorScheme(.dark)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if m.admin && !m.pending.isEmpty {
                    SheetTitle(t: "Waiting for approval")
                    Box {
                        ForEach(m.pending, id: \.0) { item in
                            HStack(spacing: 12) {
                                PersonFace(p: item.1, size: 38)
                                Text(item.1.name).font(.system(size: 17)).foregroundStyle(S.ink)
                                Spacer()
                                Button("Decline") { Task { await m.decide(item.0, approve: false) } }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.muted)
                                Button("Approve") { Task { await m.decide(item.0, approve: true) } }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.paper)
                                    .padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(S.ink))
                            }
                            .padding(.horizontal, 16).frame(minHeight: 56)
                        }
                    }
                }
                SheetTitle(t: "Members · \(m.members.count)")
                Box {
                    ForEach(Array(m.members.enumerated()), id: \.element.0) { k, item in
                        if k > 0 { Line() }
                        Button { open(item.0) } label: {
                            HStack(spacing: 12) {
                                PersonFace(p: item.1, size: 38)
                                Text(item.1.name).font(.system(size: 17)).foregroundStyle(S.ink)
                                Spacer()
                                if item.2 != "member" { Text(item.2.capitalized).font(.system(size: 13)).foregroundStyle(S.muted) }
                            }
                            .padding(.horizontal, 16).frame(minHeight: 54).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
            .padding(.bottom, 30)
        }
        .preferredColorScheme(.dark)
    }
}

private struct NotificationsSheet: View {
    @ObservedObject var m: SettingsModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                SheetTitle(t: "Notifications")
                Box {
                    Button { if let u = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(u) } } label: {
                        HStack { Text("On this iPhone").font(.system(size: 17)).foregroundStyle(S.ink); Spacer(); Text("iPhone Settings").font(.system(size: 15)).foregroundStyle(S.muted); Image(systemName: "arrow.up.forward").font(.system(size: 12)).foregroundStyle(S.muted) }
                            .padding(.horizontal, 16).frame(minHeight: 52).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
                Caption(t: "To turn them off or change how they look, use iPhone Settings › Notifications › LOTM.")
                Eyebrow(t: "Tell me about")
                Box {
                    Toggler(label: "When I am mentioned", on: $m.prefs.tagged); Line()
                    Toggler(label: "Likes on my posts", on: $m.prefs.likes); Line()
                    Toggler(label: "Next study reminders", on: $m.prefs.study); Line()
                    Toggler(label: "Reading changes", on: $m.prefs.reading); Line()
                    Toggler(label: "Also by email", on: $m.prefs.email)
                }
                Eyebrow(t: "Devotion")
                Box {
                    reminder("Morning Prayer", on: $m.reminders.morning, at: $m.reminders.morningAt); Line()
                    reminder("Noonday Prayer", on: $m.reminders.noon, at: $m.reminders.noonAt); Line()
                    reminder("Evening Prayer", on: $m.reminders.evening, at: $m.reminders.eveningAt)
                }
                Caption(t: "A notification arrives when each prayer is ready to be prayed, while a devotional is running. Tap it to open that office.")
            }
            .padding(.bottom, 30)
        }
        .onChange(of: m.prefs) { _, _ in Haptic.tap(); Task { await m.savePrefs() } }
        .onChange(of: m.reminders) { _, _ in Task { await m.saveReminders() } }
        .preferredColorScheme(.dark)
    }
    private func reminder(_ label: String, on: Binding<Bool>, at: Binding<String>) -> some View {
        VStack(spacing: 0) {
            Toggler(label: label, on: on)
            if on.wrappedValue {
                HStack {
                    Text("Remind me at").font(.system(size: 15)).foregroundStyle(S.muted)
                    Spacer()
                    DatePicker("", selection: Binding(get: { time(at.wrappedValue) }, set: { at.wrappedValue = hhmm($0) }), displayedComponents: .hourAndMinute).labelsHidden()
                }
                .padding(.leading, 32).padding(.trailing, 16).padding(.bottom, 8)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                let sched = m.drafts.filter(\.scheduled), drafts = m.drafts.filter { !$0.scheduled }
                if !sched.isEmpty {
                    SheetTitle(t: "Scheduled")
                    Box { ForEach(sched) { d in item(d, sub: d.when.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())) { deleting = d } } }
                    Caption(t: "Tap a scheduled post to delete it.")
                }
                SheetTitle(t: "Drafts")
                if drafts.isEmpty { Text("No drafts.").font(.system(size: 16)).foregroundStyle(S.muted).padding(.horizontal, 20) }
                else { Box { ForEach(drafts) { d in item(d, sub: ago(d.when)) { open(d.id) } } } }
            }
            .padding(.bottom, 30)
        }
        .confirmationDialog("Delete this scheduled post?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let d = deleting { Task { await m.deleteScheduled(d) } } }
        }
        .preferredColorScheme(.dark)
    }
    private func item(_ d: Draft, sub: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack { Text(d.title).font(.system(size: 17, design: .serif)).foregroundStyle(S.ink).lineLimit(1); Spacer(); Text(sub).font(.system(size: 13)).foregroundStyle(S.muted) }
                .padding(.horizontal, 16).frame(minHeight: 52).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

private struct MutesSheet: View {
    @ObservedObject var m: SettingsModel
    let people: [String: Person]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                SheetTitle(t: "Muted members")
                if m.mutes.isEmpty { Text("You haven’t muted anyone.").font(.system(size: 16)).foregroundStyle(S.muted).padding(.horizontal, 20) }
                else {
                    Box {
                        ForEach(m.mutes, id: \.self) { id in
                            HStack(spacing: 12) {
                                PersonFace(p: people[id] ?? Person(name: "", avatar: nil), size: 36)
                                Text(people[id]?.name ?? "Member").font(.system(size: 17)).foregroundStyle(S.ink)
                                Spacer()
                                Button("Unmute") { Haptic.tap(); Task { await m.unmute(id) } }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.ink)
                                    .padding(.horizontal, 12).frame(height: 32).background(Capsule().stroke(S.rule))
                            }
                            .padding(.horizontal, 16).frame(minHeight: 54)
                        }
                    }
                }
            }
            .padding(.bottom, 30)
        }
        .preferredColorScheme(.dark)
    }
}

private struct ReportsSheet: View {
    @ObservedObject var m: SettingsModel
    let people: [String: Person]
    let openPost: (String) -> Void
    @State private var removing: Report?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                SheetTitle(t: "Reports")
                if m.reports.isEmpty { Text("No open reports.").font(.system(size: 16)).foregroundStyle(S.muted).padding(.horizontal, 20) }
                ForEach(m.reports) { r in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(people[r.reporter]?.name ?? "A member") · \(r.created.formatted(date: .abbreviated, time: .omitted))").font(.system(size: 13)).foregroundStyle(S.muted)
                        Text(r.reason.isEmpty ? "(no reason given)" : r.reason).font(.system(size: 17, design: .serif)).foregroundStyle(S.ink)
                        HStack(spacing: 8) {
                            if let p = r.post { Button("View post") { openPost(p) }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.sub) }
                            Spacer()
                            Button("Dismiss") { Task { await m.resolve(r, removePost: false) } }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.ink)
                                .padding(.horizontal, 12).frame(height: 32).background(Capsule().stroke(S.rule))
                            if r.post != nil {
                                Button("Delete post") { removing = r }.font(.system(size: 14, weight: .semibold)).foregroundStyle(S.paper)
                                    .padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(S.ink))
                            }
                        }
                    }
                    .padding(14).background(RoundedRectangle(cornerRadius: 16).fill(S.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(S.rule)).padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 30)
        }
        .confirmationDialog("Delete the reported post for everyone?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Delete post", role: .destructive) { if let r = removing { Task { await m.resolve(r, removePost: true) } } }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Saved posts

private struct SavedHit: Identifiable { let id: String, userId: String, title: String, text: String, created: Date }

struct SavedScreen: View {
    @ObservedObject var feed: FeedModel
    @State private var items: [SavedHit] = []
    @State private var loaded = false
    var body: some View {
        VStack(spacing: 0) {
            ScreenBar(title: "Saved posts", back: "Settings")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(items) { h in
                        Button { feed.open(h.id, false) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                PersonFace(p: feed.people[h.userId] ?? Person(name: "", avatar: nil), size: 36)
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 4) { Text(feed.people[h.userId]?.name ?? "Member").font(.system(size: 15, weight: .semibold)).foregroundStyle(S.ink); Text("· \(ago(h.created))").font(.system(size: 14)).foregroundStyle(S.muted) }
                                    if !h.title.isEmpty { Text(h.title).font(.system(size: 17, weight: .semibold, design: .serif)).foregroundStyle(S.ink).lineLimit(2).multilineTextAlignment(.leading) }
                                    Text(h.text).font(.system(size: 16, design: .serif)).foregroundStyle(S.sub).lineLimit(4).multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 20).padding(.vertical, 12).overlay(alignment: .bottom) { S.rule.frame(height: 0.5) }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    if loaded && items.isEmpty { Text("Nothing saved yet. Tap the bookmark on a post to keep it here.").font(.system(size: 16)).foregroundStyle(S.muted).multilineTextAlignment(.center).padding(40) }
                    if !loaded { ProgressView().tint(S.muted).frame(maxWidth: .infinity).padding(.top, 60) }
                }
            }
            .refreshable { await load() }
        }
        .background(S.paper.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await load() }
    }
    @MainActor private func load() async {
        guard let a = await feed.auth() else { loaded = true; return }; let db = Supa(a: a)
        let ids = ((try? await db.rows("/rest/v1/saved_posts?user_id=eq.\(a.me)&select=aside_id")) ?? []).compactMap { $0["aside_id"] as? String }
        if ids.isEmpty { items = []; loaded = true; return }
        let rows = (try? await db.rows("/rest/v1/asides?id=in.(\(ids.joined(separator: ",")))&select=id,user_id,title,body,created_at&order=created_at.desc")) ?? []
        items = rows.map { r in
            let title = r["title"] as? String ?? "", body = r["body"] as? String ?? ""
            return SavedHit(id: r["id"] as? String ?? "", userId: r["user_id"] as? String ?? "", title: body.lowercased().hasPrefix(title.lowercased().prefix(20)) ? "" : title, text: body, created: parseDate(r["created_at"]))
        }
        loaded = true
    }
}
