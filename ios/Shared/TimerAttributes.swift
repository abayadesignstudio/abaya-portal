import ActivityKit
import Foundation

/// The running portal timer, shown as a Live Activity (Dynamic Island + lock screen).
struct TimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Project number, e.g. "VDRC" or "OH".
        var code: String
        /// Project name.
        var title: String
        /// Phase · activity, e.g. "Consultation · Administration".
        var detail: String
        /// When the clock would read 0:00:00 if it had never paused (now − elapsed).
        var start: Date
        /// Seconds on the clock while paused; nil while running.
        var pausedSeconds: Double?
    }
}
