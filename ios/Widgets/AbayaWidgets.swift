import ActivityKit
import SwiftUI
import WidgetKit

private let navy = Color(red: 2 / 255, green: 37 / 255, blue: 61 / 255)
private let cream = Color(red: 237 / 255, green: 230 / 255, blue: 214 / 255)
private let green = Color(red: 18 / 255, green: 128 / 255, blue: 74 / 255)

@main
struct AbayaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TimerLiveActivity()
        AgendaWidget()
        QuickActionsWidget()
        TimerActionWidget()
        VoiceWidget()
        RecordWidget()
        TripWidget()
    }
}

struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(navy)
                .activitySystemActionForegroundColor(cream)
                .widgetURL(URL(string: "abaya://timer"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    CodeChip(code: context.state.code).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(state: context.state)
                        .font(.title2.monospacedDigit().weight(.semibold))
                        .foregroundColor(context.state.pausedSeconds == nil ? .green : .gray)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.title).font(.headline).lineLimit(1)
                        if !context.state.detail.isEmpty {
                            Text(context.state.detail).font(.subheadline).foregroundColor(.secondary).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Text(context.state.code).font(.caption2.weight(.bold)).foregroundColor(cream)
            } compactTrailing: {
                Clock(state: context.state)
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(context.state.pausedSeconds == nil ? .green : .gray)
                    .frame(maxWidth: 56)
            } minimal: {
                Image(systemName: context.state.pausedSeconds == nil ? "timer" : "pause.fill").foregroundColor(.green)
            }
            .widgetURL(URL(string: "abaya://timer"))
        }
    }
}

struct LockScreenView: View {
    let state: TimerAttributes.ContentState
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    CodeChip(code: state.code)
                    Text(state.title).font(.headline).foregroundColor(cream).lineLimit(1)
                }
                if !state.detail.isEmpty {
                    Text(state.detail).font(.subheadline).foregroundColor(cream.opacity(0.75)).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Clock(state: state).font(.title.monospacedDigit().weight(.semibold)).foregroundColor(.white)
                Text(state.pausedSeconds == nil ? "Running" : "Paused")
                    .font(.caption).foregroundColor(state.pausedSeconds == nil ? green : cream.opacity(0.6))
            }
        }
        .padding(16)
    }
}

struct CodeChip: View {
    let code: String
    var body: some View {
        Text(code).font(.caption.weight(.bold)).foregroundColor(navy)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 4).fill(cream))
    }
}

/// Ticks by itself while running (no updates needed); frozen while paused.
struct Clock: View {
    let state: TimerAttributes.ContentState
    var body: some View {
        if let p = state.pausedSeconds {
            Text(format(p))
        } else {
            Text(timerInterval: state.start...state.start.addingTimeInterval(60 * 60 * 24 * 7), countsDown: false)
                .multilineTextAlignment(.trailing)
        }
    }
    private func format(_ t: Double) -> String {
        let s = Int(t)
        return String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    }
}

// MARK: Home-screen and lock-screen widgets — one tap into the app's quick actions (abaya://action/<name>)

struct QuickEntry: TimelineEntry { let date: Date }
struct QuickProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickEntry { QuickEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (QuickEntry) -> Void) { completion(QuickEntry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickEntry>) -> Void) { completion(Timeline(entries: [QuickEntry(date: .now)], policy: .never)) }
}

private struct QuickAction: Identifiable {
    let id: String, label: String, symbol: String
    var url: URL { URL(string: "abaya://action/\(id)")! }
}
private let actions = [
    QuickAction(id: "timer", label: "Timer", symbol: "timer"),
    QuickAction(id: "voice", label: "Voice", symbol: "mic.fill"),
    QuickAction(id: "record", label: "Record", symbol: "record.circle"),
    QuickAction(id: "trip", label: "Trip", symbol: "car.fill"),
]

/// Home screen, medium: all four buttons.
struct QuickActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaQuick", provider: QuickProvider()) { _ in
            VStack(alignment: .leading, spacing: 8) {
                Text("ABAYA").font(.caption.weight(.bold)).tracking(2).foregroundColor(cream.opacity(0.8))
                HStack(spacing: 8) {
                    ForEach(actions) { a in
                        Link(destination: a.url) { ActionTile(action: a) }
                    }
                }
            }
            .padding(12)
            .containerBackground(for: .widget) { navy }
        }
        .configurationDisplayName("Abaya quick actions")
        .description("Timer, voice, record a conversation, track a trip.")
        .supportedFamilies([.systemMedium])
    }
}

/// One action per widget (small widgets and lock-screen widgets allow a single tap target).
private struct ActionTile: View {
    let action: QuickAction
    var big = false
    var body: some View {
        VStack(spacing: big ? 8 : 4) {
            Image(systemName: action.symbol).font(big ? .largeTitle : .title2)
                .foregroundColor(action.id == "record" ? Color(red: 0.86, green: 0.25, blue: 0.2) : cream)
            Text(action.label).font(big ? .headline : .caption.weight(.semibold)).foregroundColor(cream)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(big ? 0 : 0.1)))
    }
}

private struct ActionWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let action: QuickAction
    var body: some View {
        Group {
            if family == .accessoryCircular {
                ZStack { AccessoryWidgetBackground(); Image(systemName: action.symbol).font(.title2) }
                    .containerBackground(for: .widget) { Color.clear }
            } else {
                ActionTile(action: action, big: true).containerBackground(for: .widget) { navy }
            }
        }
        .widgetURL(action.url)
    }
}

struct TimerActionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaTimer", provider: QuickProvider()) { _ in ActionWidgetView(action: actions[0]) }
            .configurationDisplayName("Abaya timer").description("Open the timer.")
            .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}
struct VoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaVoice", provider: QuickProvider()) { _ in ActionWidgetView(action: actions[1]) }
            .configurationDisplayName("Abaya voice").description("Say a task, note or time entry.")
            .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}
struct RecordWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaRecord", provider: QuickProvider()) { _ in ActionWidgetView(action: actions[2]) }
            .configurationDisplayName("Abaya record").description("Record a client conversation.")
            .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}
struct TripWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaTrip", provider: QuickProvider()) { _ in ActionWidgetView(action: actions[3]) }
            .configurationDisplayName("Abaya trip").description("Start or stop GPS trip tracking.")
            .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

// MARK: Agenda + timer widget (medium / large): upcoming items on the left, the timer with buttons on the right.

struct AgendaEntry: TimelineEntry { let date: Date; let feed: Feed?; let linked: Bool }

struct AgendaProvider: TimelineProvider {
    func placeholder(in context: Context) -> AgendaEntry { AgendaEntry(date: .now, feed: sample, linked: true) }
    func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await load()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
        Task {
            let e = await load()
            completion(Timeline(entries: [e], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
    private func load() async -> AgendaEntry {
        do { return AgendaEntry(date: .now, feed: try await WidgetLink.call("feed"), linked: true) }
        catch WidgetLink.LinkError.notLinked { return AgendaEntry(date: .now, feed: nil, linked: false) }
        catch { return AgendaEntry(date: .now, feed: nil, linked: true) }
    }
    private var sample: Feed {
        Feed(today: nil, timer: Feed.Timer(code: "2411", title: "Lee Residence", detail: "CDs", color: "#a32d2d", elapsed: 3725, paused: false),
             recent: nil, items: [
                Feed.Item(day: "", time: "09:00", kind: "meeting", title: "Site walk", code: nil, color: "#1a73e8", overdue: nil),
                Feed.Item(day: "", time: nil, kind: "task", title: "Send elevations", code: "2411", color: "#a32d2d", overdue: nil),
                Feed.Item(day: "", time: nil, kind: "milestone", title: "Permit set", code: "2312", color: "#2b5c8a", overdue: nil),
             ], error: nil)
    }
}

struct AgendaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AbayaAgenda", provider: AgendaProvider()) { e in AgendaView(entry: e) }
            .configurationDisplayName("Abaya agenda + timer")
            .description("Your tasks, meetings, milestones and deliverables, with the timer.")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private func hex(_ s: String?) -> Color {
    guard let s, s.hasPrefix("#"), s.count == 7, let v = Int(s.dropFirst(), radix: 16) else { return .gray }
    return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
}
private func clock12(_ t: String?) -> String? {
    guard let t, t.count >= 5, let h = Int(t.prefix(2)), let m = Int(t.dropFirst(3).prefix(2)) else { return nil }
    return "\(((h + 11) % 12) + 1)" + (m == 0 ? "" : String(format: ":%02d", m)) + (h < 12 ? "a" : "p")
}
private func dayLabel(_ day: String, today: String?) -> String {
    if day == today { return "TODAY" }
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "America/Chicago")
    guard let d = f.date(from: day) else { return day }
    if let t = today, let td = f.date(from: t), Calendar.current.dateComponents([.day], from: td, to: d).day == 1 { return "TOMORROW" }
    let o = DateFormatter(); o.dateFormat = "EEE MMM d"; o.timeZone = f.timeZone
    return o.string(from: d).uppercased()
}
private func kindSymbol(_ k: String) -> String {
    switch k { case "task": return "circle"; case "milestone": return "flag.fill"; case "deliverable": return "doc.fill"; case "meeting": return "person.2.fill"; default: return "calendar" }
}

struct AgendaView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AgendaEntry
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AgendaList(entry: entry, max: family == .systemLarge ? 12 : 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            TimerPanel(entry: entry)
                .frame(width: family == .systemLarge ? 140 : 132)
        }
        .containerBackground(for: .widget) { Color(red: 0.11, green: 0.12, blue: 0.13) }
        .widgetURL(URL(string: "abaya://action/calendar"))
    }
}

private struct AgendaList: View {
    let entry: AgendaEntry
    let max: Int
    var body: some View {
        if !entry.linked {
            Text("Open the Abaya app once to link this widget.").font(.caption).foregroundColor(.secondary)
        } else if let items = entry.feed?.items {
            if items.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("TODAY").font(.caption2.weight(.bold)).foregroundColor(.secondary)
                    Text("Nothing scheduled").font(.caption).foregroundColor(.secondary)
                }
            } else {
                let shown = Array(items.prefix(max))
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(shown.enumerated()), id: \.offset) { i, it in
                        if i == 0 || shown[i - 1].day != it.day {
                            Text(dayLabel(it.day, today: entry.feed?.today)).font(.caption2.weight(.bold)).foregroundColor(.secondary)
                                .padding(.top, i == 0 ? 0 : 3)
                        }
                        HStack(spacing: 5) {
                            RoundedRectangle(cornerRadius: 1.5).fill(hex(it.color)).frame(width: 3, height: 14)
                            Image(systemName: kindSymbol(it.kind)).font(.system(size: 8)).foregroundColor(hex(it.color))
                            if let t = clock12(it.time) { Text(t).font(.caption2.monospacedDigit()).foregroundColor(.secondary) }
                            Text(it.title).font(.caption).foregroundColor(it.overdue == true ? Color(red: 1, green: 0.45, blue: 0.4) : .white).lineLimit(1)
                        }
                    }
                    if items.count > shown.count { Text("+\(items.count - shown.count) more").font(.caption2).foregroundColor(.secondary) }
                }
            }
        } else {
            Text("Couldn't load. Pull down later.").font(.caption).foregroundColor(.secondary)
        }
    }
}

private struct TimerPanel: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode
    let entry: AgendaEntry
    private var full: Bool { mode == .fullColor }
    private var large: Bool { family == .systemLarge }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let t = entry.feed?.timer {
                HStack(spacing: 4) {
                    Text(t.code).font(.caption2.weight(.bold)).foregroundColor(full ? navy : .primary)
                        .padding(.horizontal, 4).background(RoundedRectangle(cornerRadius: 3).fill(full ? cream : Color.white.opacity(0.25)))
                    Text(t.paused ? "Paused" : "Running").font(.caption2).foregroundColor(t.paused ? .secondary : green)
                }
                Text(t.title).font(.caption.weight(.semibold)).lineLimit(large ? 2 : 1)
                Group {
                    if t.paused { Text(fmt(t.elapsed)) }
                    else { Text(timerInterval: entry.date.addingTimeInterval(-t.elapsed)...entry.date.addingTimeInterval(86400 * 7), countsDown: false) }
                }
                .font(.title3.monospacedDigit().weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                HStack(spacing: 6) {
                    Button(intent: TimerControlIntent(t.paused ? "resume" : "pause")) {
                        Image(systemName: t.paused ? "play.fill" : "pause.fill").frame(maxWidth: .infinity, minHeight: 28)
                    }.tint(Color.white.opacity(0.22))
                    Button(intent: TimerControlIntent("stop")) {
                        Image(systemName: "stop.fill").frame(maxWidth: .infinity, minHeight: 28)
                    }.tint(Color(red: 0.84, green: 0.24, blue: 0.2))
                }
                .buttonStyle(.borderedProminent).foregroundColor(.white)
                if large, let picks = entry.feed?.recents?.filter({ !($0.code == t.code && $0.title == t.title) }), !picks.isEmpty {
                    Text("SWITCH TO").font(.caption2.weight(.bold)).foregroundColor(.secondary).padding(.top, 4)
                    ForEach(picks.prefix(4), id: \.self) { p in PickButton(pick: p) }
                }
            } else {
                Text("START TIMER").font(.caption2.weight(.bold)).foregroundColor(.secondary)
                if let picks = entry.feed?.recents, !picks.isEmpty {
                    ForEach(picks.prefix(large ? 6 : 3), id: \.self) { p in PickButton(pick: p) }
                } else {
                    Text("Start a timer in the app once; your recent tasks show up here.").font(.caption2).foregroundColor(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundColor(.white)
        .padding(9)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 14).fill(full ? navy : Color.white.opacity(0.1)))
    }
    private func fmt(_ t: Double) -> String { let s = Int(t); return String(format: "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) }
}

/// One recent task (project · phase · activity) as a Start button.
private struct PickButton: View {
    let pick: Feed.Pick
    var body: some View {
        Button(intent: TimerControlIntent("start|" + pick.key)) {
            HStack(spacing: 5) {
                Image(systemName: "play.fill").font(.system(size: 8))
                VStack(alignment: .leading, spacing: 0) {
                    Text(pick.code == "OH" ? "Overhead" : "\(pick.code) \(pick.title)").font(.caption2.weight(.semibold)).lineLimit(1)
                    if !pick.detail.isEmpty { Text(pick.detail).font(.system(size: 9)).opacity(0.75).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(hex(pick.color).opacity(0.55)))
        }
        .buttonStyle(.plain)
    }
}
