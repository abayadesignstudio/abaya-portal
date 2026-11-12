import ActivityKit
import SwiftUI
import WidgetKit

private let navy = Color(red: 2 / 255, green: 37 / 255, blue: 61 / 255)
private let cream = Color(red: 237 / 255, green: 230 / 255, blue: 214 / 255)
private let green = Color(red: 18 / 255, green: 128 / 255, blue: 74 / 255)

@main
struct AbayaWidgetsBundle: WidgetBundle {
    var body: some Widget { TimerLiveActivity() }
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
