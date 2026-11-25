import SwiftUI
import PassKit
import QuickLook

// Free concert tickets the club gives away (the "christmas" function; lotmstudy.org/christmas is the public page).
// A member reserves from the event's card under Upcoming Events; their tickets then sit at the top of My Library.

struct TicketRes: Identifiable, Equatable { let token: String, tickets: [Int]; var id: String { token } }

@MainActor final class TicketsModel: ObservableObject {
    static let shared = TicketsModel()
    static let max = 4
    @Published var eventId: String?
    @Published var free = 0
    @Published var total = 0
    @Published var mine: [TicketRes] = []
    @Published var wallet = false
    var auth: (() async -> SupaAuth?)?

    private func call(_ method: String, _ query: String, body: [String: Any]? = nil) async -> (Int, Data) {
        guard let a = await auth?(), let url = URL(string: a.url + "/functions/v1/christmas" + query) else { return (0, Data()) }
        var r = URLRequest(url: url); r.httpMethod = method; r.timeoutInterval = 40
        r.setValue(a.key, forHTTPHeaderField: "apikey"); r.setValue("Bearer \(a.token)", forHTTPHeaderField: "Authorization")
        if let body { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        guard let (d, resp) = try? await URLSession.shared.data(for: r) else { return (0, Data()) }
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, d)
    }
    private func obj(_ d: Data) -> [String: Any] { ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any]) ?? [:] }

    func load() async {
        let (c1, d1) = await call("GET", "?action=list")
        if c1 == 200, let t = obj(d1)["tickets"] as? [[String: Any]] {
            eventId = (obj(d1)["event_id"] as? String)?.lowercased(); total = t.count; free = t.filter { $0["free"] as? Bool == true }.count
        }
        let (c2, d2) = await call("GET", "?action=mine")
        if c2 == 200, let rs = obj(d2)["reservations"] as? [[String: Any]] {
            wallet = obj(d2)["wallet"] as? Bool ?? false
            mine = rs.compactMap { r in (r["token"] as? String).map { TicketRes(token: $0, tickets: (r["tickets"] as? [Int]) ?? []) } }
        }
    }
    /// Reserves n tickets; returns what to tell the member.
    func reserve(_ n: Int) async -> (ok: Bool, say: String) {
        let (code, d) = await call("POST", "", body: ["action": "reserve", "count": n])
        let o = obj(d)
        await load()
        if code == 200, let t = o["tickets"] as? [Int] {
            let mailed = (o["delivery"] as? [String: Any])?["email"] as? String == "sent"
            return (true, (t.count == 1 ? "Ticket" : "\(t.count) tickets") + " reserved: in My Library" + (mailed ? ", and emailed to you" : ""))
        }
        switch o["error"] as? String {
        case "taken": return (false, "Someone just reserved the last of those. Try a smaller number.")
        case "limit_reached": return (false, "You already hold the limit of \(Self.max) tickets.")
        default: return (false, "Could not reserve. Please try again.")
        }
    }
    func release(_ r: TicketRes) async -> Bool {
        let (code, _) = await call("POST", "", body: ["action": "release", "t": r.token])
        await load(); return code == 200
    }
    /// A ticket's PDF, or its Apple Wallet pass.
    func file(_ r: TicketRes, _ id: Int, pass: Bool) async -> Data? {
        let (code, d) = await call("GET", "?t=\(r.token)&id=\(id)" + (pass ? "&pass=1" : ""))
        return code == 200 && !d.isEmpty ? d : nil
    }
}

/// Under the event that has tickets: Reserve, how many are left, and the sheet that asks how many.
struct ReserveTickets: View {
    @ObservedObject var t = TicketsModel.shared
    let say: (String) -> Void
    @State private var open = false
    @State private var n = 1
    @State private var busy = false
    var body: some View {
        HStack(spacing: 12) {
            Button { n = 1; open = true } label: {
                HStack(spacing: 6) { Image(systemName: "ticket"); Text(t.free > 0 ? "Reserve tickets" : "All reserved") }
                    .font(.sans(14, .bold)).foregroundStyle(T.paper).padding(.horizontal, 16).frame(height: 38).background(Capsule().fill(T.ink)).opacity(t.free > 0 ? 1 : 0.5)
            }.buttonStyle(.plain).disabled(t.free == 0)
            Text("\(t.free) of \(t.total) left").font(.sans(13)).foregroundStyle(T.muted)
            Spacer(minLength: 0)
        }
        .sheet(isPresented: $open) { sheet.presentationDetents([.height(300)]).presentationBackground(T.card) }
    }
    private var cap: Int { min(TicketsModel.max, t.free) }
    private var sheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reserve tickets").font(.serif(22, .semibold)).foregroundStyle(T.ink)
            Text("General admission, Sanctuary. One ticket per person attending, up to \(TicketsModel.max). They’ll be saved to My Library and emailed to you.").font(.sans(14)).foregroundStyle(T.muted).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            HStack {
                Text("How many?").font(.sans(16)).foregroundStyle(T.ink)
                Spacer()
                step("minus", n > 1) { n -= 1 }
                Text("\(n)").font(.serif(28, .semibold)).foregroundStyle(T.ink).frame(minWidth: 34)
                step("plus", n < cap) { n += 1 }
            }
            Button {
                busy = true
                Task { let r = await t.reserve(n); busy = false; if r.ok { open = false }; say(r.say) }
            } label: {
                Text(busy ? "Reserving…" : n > 1 ? "Reserve \(n) tickets" : "Reserve ticket").font(.sans(15, .bold)).foregroundStyle(T.paper).frame(maxWidth: .infinity).frame(height: 46).background(Capsule().fill(T.ink))
            }.buttonStyle(.plain).disabled(busy || cap == 0)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.top, 24).preferredColorScheme(.dark)
    }
    private func step(_ icon: String, _ on: Bool, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(T.ink).frame(width: 40, height: 40).overlay(Circle().stroke(T.rule)).contentShape(Circle()) }
            .buttonStyle(.plain).disabled(!on).opacity(on ? 1 : 0.35)
    }
}

/// My Library: the member's reserved tickets, each to open, add to Apple Wallet, or give back.
struct MyTickets: View {
    @ObservedObject var t = TicketsModel.shared
    let say: (String) -> Void
    @State private var preview: URL?
    @State private var busy: String?
    @State private var releasing: TicketRes?
    private let gold = Color(rgb: 0xd9b26a)
    var body: some View {
        let all = t.mine.flatMap { r in r.tickets.enumerated().map { (r, $0.element, $0.offset) } }
        if !all.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Tickets").font(.serif(22, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 4)
                ForEach(all, id: \.1) { r, id, i in
                    HStack(spacing: 0) {
                        Color(rgb: 0x1b1a19).frame(width: 86).overlay(NetImage(url: URL(string: "https://lotmstudy.org/christmas/candlelight.jpg")) { $0.resizable().scaledToFill() } placeholder: { Color.clear }).clipped()
                        VStack(alignment: .leading, spacing: 3) {
                            Text("MON, DEC 14 · 7:00 PM").font(.sans(12, .bold)).tracking(0.7).foregroundStyle(gold)
                            Text("Rejoice! · PCPC Christmas Concert").font(.serif(18, .semibold)).foregroundStyle(T.ink).fixedSize(horizontal: false, vertical: true)
                            Text("Ticket \(i + 1) of \(r.tickets.count) · Sanctuary GA").font(.sans(13)).foregroundStyle(T.muted)
                            HStack(spacing: 16) {
                                act("Ticket", "doc.text", "t\(id)") { await open(r, id) }
                                if t.wallet, PKAddPassesViewController.canAddPasses() { act("Add to Apple Wallet", "wallet.pass", "w\(id)") { await pass(r, id) } }
                                Spacer(minLength: 0)
                                if i == 0 { Button("Release") { releasing = r }.font(.sans(13)).foregroundStyle(T.muted).buttonStyle(.plain) }
                            }.padding(.top, 6)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 104).background(T.card).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 18)
            .quickLookPreview($preview)
            .confirmationDialog(releasing.map { $0.tickets.count == 1 ? "Release this ticket so someone else can go?" : "Release these \($0.tickets.count) tickets so someone else can go?" } ?? "", isPresented: Binding(get: { releasing != nil }, set: { if !$0 { releasing = nil } }), titleVisibility: .visible) {
                Button("Release", role: .destructive) { if let r = releasing { Task { say(await t.release(r) ? "Released. Thank you for passing them on." : "Could not release. Please try again.") } } }
            }
        }
    }
    private func act(_ label: String, _ icon: String, _ key: String, _ run: @escaping () async -> Void) -> some View {
        Button { guard busy == nil else { return }; busy = key; Task { await run(); busy = nil } } label: {
            HStack(spacing: 5) { if busy == key { ProgressView().controlSize(.small).tint(T.ink) } else { Image(systemName: icon).font(.system(size: 13, weight: .semibold)) }; Text(label) }.font(.sans(13.5, .semibold)).foregroundStyle(T.ink)
        }.buttonStyle(.plain)
    }
    private func open(_ r: TicketRes, _ id: Int) async {
        guard let d = await t.file(r, id, pass: false) else { say("Couldn’t open the ticket. Check your connection and try again."); return }
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("PCPC-Rejoice-ticket-\(id).pdf")
        do { try d.write(to: u); preview = u } catch { say("Couldn’t open the ticket.") }
    }
    private func pass(_ r: TicketRes, _ id: Int) async {
        guard let d = await t.file(r, id, pass: true), let p = try? PKPass(data: d), let vc = PKAddPassesViewController(pass: p) else { say("Couldn’t make the Wallet pass. The ticket itself still opens."); return }
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        var top = root; while let n = top?.presentedViewController { top = n }
        top?.present(vc, animated: true)
    }
}
