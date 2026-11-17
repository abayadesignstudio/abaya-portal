import Foundation
import UserNotifications

/// The morning schedule notification on the lock screen ("Today · Tue Nov 17" with the day's items).
/// It is a local notification, re-written every time the widget or the app loads the feed, so it carries
/// the latest schedule. One pending request at a time (same identifier replaces the old one).
enum DailyBrief {
    static let hour = 7, minute = 0
    static let id = "abaya-daily-brief"

    static func schedule(from feed: Feed) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let cal = Calendar.current
            let now = Date()
            guard var fire = cal.date(bySettingHour: hour, minute: minute, second: 0, of: now) else { return }
            if fire <= now { fire = cal.date(byAdding: .day, value: 1, to: fire) ?? fire }

            let f = DateFormatter()
            f.calendar = cal; f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
            let day = f.string(from: fire)
            // That day's items, plus open tasks from before it (they'll be overdue by then).
            let all = (feed.items ?? []).filter { $0.day == day || ($0.kind == "task" && $0.day < day) }
            let timed = all.filter { $0.time != nil }.sorted { ($0.time ?? "") < ($1.time ?? "") }
            let untimed = all.filter { $0.time == nil }

            let content = UNMutableNotificationContent()
            let pretty = DateFormatter(); pretty.dateFormat = "EEE MMM d"
            content.title = "Today · " + pretty.string(from: fire)
            if all.isEmpty {
                content.body = "Nothing scheduled today."
            } else {
                content.subtitle = summary(all)
                content.body = (timed.map(line) + untimed.map(line)).joined(separator: "\n")
            }
            content.sound = .default
            content.threadIdentifier = "daily-brief"
            content.interruptionLevel = .active
            content.userInfo = ["url": "abaya://action/calendar"]

            let when = cal.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            center.add(UNNotificationRequest(identifier: id, content: content,
                                             trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false)))
        }
    }

    private static func line(_ it: Feed.Item) -> String {
        let mark: String
        switch it.kind {
        case "task": mark = "○"
        case "milestone": mark = "⚑"
        case "deliverable": mark = "➤"
        default: mark = "•"
        }
        var s = mark + " "
        if let t = clock12(it.time) { s += t + "  " }
        s += it.title
        if it.overdue == true { s += " (overdue)" }
        return s
    }

    private static func summary(_ items: [Feed.Item]) -> String {
        let meetings = items.filter { $0.kind == "meeting" || $0.kind == "event" }.count
        let tasks = items.filter { $0.kind == "task" }.count
        let other = items.count - meetings - tasks
        var parts: [String] = []
        if meetings > 0 { parts.append("\(meetings) meeting\(meetings == 1 ? "" : "s")") }
        if tasks > 0 { parts.append("\(tasks) task\(tasks == 1 ? "" : "s")") }
        if other > 0 { parts.append("\(other) due") }
        return parts.joined(separator: " · ")
    }

    private static func clock12(_ t: String?) -> String? {
        guard let t, t.count >= 5, let h = Int(t.prefix(2)), let m = Int(t.dropFirst(3).prefix(2)) else { return nil }
        return "\(((h + 11) % 12) + 1)" + (m == 0 ? "" : String(format: ":%02d", m)) + (h < 12 ? "a" : "p")
    }
}
