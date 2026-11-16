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
