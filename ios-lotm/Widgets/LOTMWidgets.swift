import WidgetKit
import SwiftUI

// Home-screen and Lock Screen widgets for LOTM: today's reading against the daily page goal, the next event,
// the book in hand, and (largest size) a Commonplace box that opens the app ready to write.
// Data comes from the snapshot the app leaves in the shared keychain (WidgetStore).

// MARK: - Palette

/// Full colour normally; in the tinted / clear Home Screen styles iOS paints every shape in one tint, so solid
/// fills turn into white slabs. There the widget uses see-through shades instead (alpha survives the tint).
struct Palette {
    var bg, bg2, card, cream, muted, track, green: Color
    static let full = Palette(
        bg: Color(red: 0.247, green: 0.259, blue: 0.180), bg2: Color(red: 0.200, green: 0.212, blue: 0.141),
        card: Color(red: 0.302, green: 0.314, blue: 0.220), cream: Color(red: 0.945, green: 0.933, blue: 0.867),
        muted: Color(red: 0.776, green: 0.765, blue: 0.682), track: Color(red: 0.290, green: 0.298, blue: 0.208),
        green: Color(red: 0.365, green: 0.608, blue: 0.420))
    static let tinted = Palette(bg: .clear, bg2: .white.opacity(0.08), card: .white.opacity(0.14), cream: .white,
        muted: .white.opacity(0.62), track: .white.opacity(0.22), green: .white)
}
private struct PaletteKey: EnvironmentKey { static let defaultValue = Palette.full }
extension EnvironmentValues { var pal: Palette { get { self[PaletteKey.self] } set { self[PaletteKey.self] = newValue } } }

/// Book covers keep their own colours (greyed) instead of being flattened into the tint.
extension View {
    @ViewBuilder func keepImage() -> some View {
        if #available(iOS 18.0, *) { self.widgetAccentedRenderingMode(.desaturated) } else { self }
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot
    let cover: UIImage?
    var isToday: Bool { snap.day == Entry.dayString(date) || snap.day.isEmpty }
    /// Pages read today (a snapshot from yesterday means nothing read yet today).
    var done: Int { isToday ? snap.done : 0 }
    var frac: Double { min(1, Double(done) / Double(max(1, snap.goal))) }
    var upcoming: [WidgetSnapshot.Event] {
        snap.events.filter { (Entry.parse($0.start) ?? .distantPast) > date.addingTimeInterval(-2 * 3600) }
    }
    static func dayString(_ d: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
    static func parse(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: s) { return d }
        // Postgres style: 2026-11-19 19:00:00+00
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.dateFormat = "yyyy-MM-dd HH:mm:ssXXXXX"
        return p.date(from: s) ?? { p.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"; return p.date(from: s) }()
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snap: .sample, cover: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        let snap = WidgetStore.load() ?? .sample
        loadCover(snap) { completion(Entry(date: Date(), snap: snap, cover: $0)) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let snap = WidgetStore.load() ?? .sample
        loadCover(snap) { img in
            let now = Date(), cal = Calendar.current
            var dates = [now]
            // Redraw at midnight (today's count resets) and as each event passes.
            if let midnight = cal.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) { dates.append(midnight) }
            for e in snap.events { if let d = Entry.parse(e.start)?.addingTimeInterval(2 * 3600), d > now { dates.append(d) } }
            let entries = dates.sorted().prefix(6).map { Entry(date: $0, snap: snap, cover: img) }
            completion(Timeline(entries: Array(entries), policy: .after(now.addingTimeInterval(3 * 3600))))
        }
    }
    private func loadCover(_ s: WidgetSnapshot, done: @escaping (UIImage?) -> Void) {
        guard let str = s.book?.cover, let url = URL(string: str), url.scheme?.hasPrefix("http") == true else { return done(nil) }
        var req = URLRequest(url: url); req.timeoutInterval = 8
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data, let img = UIImage(data: data) else { return done(nil) }
            // Widgets have a small memory budget: keep the cover small.
            let w: CGFloat = 160, h = w * img.size.height / max(1, img.size.width)
            let r = UIGraphicsImageRenderer(size: CGSize(width: w, height: h))
            done(r.image { _ in img.draw(in: CGRect(x: 0, y: 0, width: w, height: h)) })
        }.resume()
    }
}

// MARK: - Pieces

struct Ring: View {
    @Environment(\.pal) private var Ink
    let frac: Double; var width: CGFloat = 8
    var body: some View {
        ZStack {
            Circle().trim(from: 0, to: 2.0 / 3.0).stroke(Ink.track, style: StrokeStyle(lineWidth: width, lineCap: .round)).rotationEffect(.degrees(150))
            Circle().trim(from: 0, to: 2.0 / 3.0 * frac).stroke(Ink.green, style: StrokeStyle(lineWidth: width, lineCap: .round)).rotationEffect(.degrees(150))
                .opacity(frac > 0 ? 1 : 0)
        }
    }
}

struct GoalGauge: View {
    @Environment(\.pal) private var Ink
    let e: Entry; var size: CGFloat = 112; var big: CGFloat = 40
    var body: some View {
        ZStack {
            Ring(frac: e.frac, width: size * 0.075).frame(width: size, height: size)
            VStack(spacing: 0) {
                Text("\(e.done)").font(.system(size: big, weight: .medium, design: .serif)).foregroundStyle(Ink.cream).minimumScaleFactor(0.6)
                Text("of \(e.snap.goal) pages").font(.system(size: size * 0.1, weight: .semibold)).foregroundStyle(Ink.muted)
            }.offset(y: size * 0.04)
        }
    }
}

struct StreakLine: View {
    @Environment(\.pal) private var Ink
    let e: Entry
    var body: some View {
        let met = e.done >= e.snap.goal
        let n = e.snap.streak
        Text(met ? "Goal met · \(n)-day streak" : n > 0 ? "\(n)-day streak" : "Start a streak today")
            .font(.system(size: 12, weight: .semibold)).foregroundStyle(met ? Ink.green : Ink.muted).lineLimit(1)
    }
}

struct WeekDots: View {
    @Environment(\.pal) private var Ink
    let e: Entry
    var body: some View {
        let today = Calendar.current.component(.weekday, from: e.date) - 1
        HStack(spacing: 5) {
            ForEach(0..<7, id: \.self) { i in
                let on = e.isToday && i < e.snap.week.count && e.snap.week[i]
                ZStack {
                    Circle().fill(on ? Ink.green : Color.clear)
                    Circle().stroke(on ? Color.clear : (i == today ? Ink.cream : Ink.track), lineWidth: 1.5)
                    Text(String(Array("SMTWTFS")[i])).font(.system(size: 9, weight: .bold)).foregroundStyle(on ? .white : (i > today ? Ink.muted.opacity(0.6) : Ink.cream))
                }.frame(width: 18, height: 18)
            }
        }
    }
}

struct EventRow: View {
    @Environment(\.pal) private var Ink
    let ev: WidgetSnapshot.Event?; var compact = false
    var body: some View {
        if let ev, let d = Entry.parse(ev.start) {
            HStack(alignment: .center, spacing: 10) {
                VStack(spacing: 0) {
                    Text(d.formatted(.dateTime.month(.abbreviated)).uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(Ink.cream)
                        .frame(maxWidth: .infinity).padding(.vertical, 2).background(Ink.bg2)
                    Text(d.formatted(.dateTime.day())).font(.system(size: 19, weight: .medium, design: .serif)).foregroundStyle(Ink.cream).frame(maxHeight: .infinity)
                }.frame(width: 40, height: 42).background(Ink.card).clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ev.title).font(.system(size: compact ? 13 : 15, weight: .semibold, design: .serif)).foregroundStyle(Ink.cream).lineLimit(compact ? 2 : 1)
                    Text(d.formatted(.dateTime.weekday(.wide).hour().minute()) + (ev.place.isEmpty || compact ? "" : " · " + ev.place))
                        .font(.system(size: 12)).foregroundStyle(Ink.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        } else {
            Text("No events coming up").font(.system(size: 13)).foregroundStyle(Ink.muted)
        }
    }
}

struct BookRow: View {
    @Environment(\.pal) private var Ink
    let e: Entry
    var body: some View {
        if let b = e.snap.book {
            HStack(spacing: 10) {
                Group {
                    if let img = e.cover { Image(uiImage: img).resizable().aspectRatio(contentMode: .fill).keepImage() } else { Ink.card }
                }.frame(width: 34, height: 50).clipShape(RoundedRectangle(cornerRadius: 3)).shadow(color: .black.opacity(0.35), radius: 3, y: 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(b.title).font(.system(size: 14, weight: .semibold, design: .serif)).foregroundStyle(Ink.cream).lineLimit(1)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Ink.track)
                            Capsule().fill(Ink.green).frame(width: max(4, g.size.width * CGFloat(b.pct) / 100))
                        }
                    }.frame(height: 4)
                    Text(b.total > 0 ? "Page \(b.page) of \(b.total) · \(b.pct)%" : "Page \(b.page)").font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.muted)
                }
            }
        } else {
            Text("Add a book to your library").font(.system(size: 13)).foregroundStyle(Ink.muted)
        }
    }
}

struct Label2: View {
    @Environment(\.pal) private var Ink
    let t: String
    var body: some View { Text(t.uppercased()).font(.system(size: 10, weight: .heavy)).kerning(1).foregroundStyle(Ink.muted) }
}

// MARK: - Sizes

struct SmallView: View {
    @Environment(\.pal) private var Ink
    let e: Entry
    var body: some View {
        VStack(spacing: 4) {
            Label2(t: "Today’s reading")
            GoalGauge(e: e, size: 96, big: 36)
            StreakLine(e: e)
        }
    }
}

struct MediumView: View {
    @Environment(\.pal) private var Ink
    let e: Entry
    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 2) { GoalGauge(e: e, size: 100, big: 36); StreakLine(e: e) }.frame(width: 120)
            VStack(alignment: .leading, spacing: 10) {
                Label2(t: "Next")
                EventRow(ev: e.upcoming.first, compact: true)
                BookRow(e: e)
            }
        }
    }
}

struct LargeView: View {
    @Environment(\.pal) private var Ink
    let e: Entry; var wide = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Life of the Mind").font(.system(size: 15, weight: .semibold, design: .serif)).foregroundStyle(Ink.cream)
                Spacer()
                Text(e.date.formatted(.dateTime.weekday(.wide).month().day())).font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.muted)
            }
            VStack(alignment: .leading, spacing: 8) {
                Label2(t: "Next event")
                Link(destination: URL(string: "lotm://reading")!) { EventRow(ev: e.upcoming.first) }
            }
            Divider().overlay(Ink.track)
            HStack(spacing: 14) {
                GoalGauge(e: e, size: 92, big: 32)
                VStack(alignment: .leading, spacing: 8) {
                    Label2(t: "Your reading")
                    BookRow(e: e)
                    HStack { WeekDots(e: e); Spacer(minLength: 0) }
                }
            }
            Spacer(minLength: 0)
            // Widgets can't take typing; tapping the box opens Commonplace ready to write.
            Link(destination: URL(string: "lotm://notebook?new=1")!) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("COMMONPLACE").font(.system(size: 9, weight: .heavy)).kerning(1).foregroundStyle(Ink.muted)
                        Text("A thought worth keeping…").font(.system(size: 16, design: .serif)).italic().foregroundStyle(Ink.muted)
                    }
                    Spacer()
                    Image(systemName: "square.and.pencil").font(.system(size: 16, weight: .semibold)).foregroundStyle(Ink.cream)
                }
                .padding(12).frame(maxWidth: .infinity, minHeight: wide ? 70 : 64, alignment: .topLeading)
                .background(RoundedRectangle(cornerRadius: 14).fill(Ink.bg2))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Ink.track, lineWidth: 1))
            }
        }
    }
}

// Lock Screen
struct CircularView: View {
    let e: Entry
    var body: some View {
        Gauge(value: e.frac) { Text("pages") } currentValueLabel: { Text("\(e.done)") }
            .gaugeStyle(.accessoryCircular)
    }
}
struct RectangularView: View {
    let e: Entry
    var body: some View {
        if let ev = e.upcoming.first, let d = Entry.parse(ev.start) {
            VStack(alignment: .leading, spacing: 1) {
                Text(ev.title).font(.headline).lineLimit(1)
                Text(d.formatted(.dateTime.weekday(.abbreviated).hour().minute())).font(.caption)
                Text("\(e.done) of \(e.snap.goal) pages today").font(.caption).foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Text("Today’s reading").font(.headline)
                Text("\(e.done) of \(e.snap.goal) pages").font(.caption)
            }
        }
    }
}

struct LOTMWidgetView: View {
    @Environment(\.widgetRenderingMode) var mode
    let e: Entry
    var body: some View { Inner(e: e).environment(\.pal, mode == .fullColor ? .full : .tinted) }
}
private struct Inner: View {
    @Environment(\.widgetFamily) var family
    let e: Entry
    var body: some View {
        switch family {
        case .systemSmall: SmallView(e: e).widgetURL(URL(string: "lotm://reading"))
        case .systemMedium: MediumView(e: e).widgetURL(URL(string: "lotm://reading"))
        case .systemLarge: LargeView(e: e)
        case .systemExtraLarge: LargeView(e: e, wide: true)
        case .accessoryCircular: CircularView(e: e).widgetURL(URL(string: "lotm://reading"))
        case .accessoryRectangular: RectangularView(e: e).widgetURL(URL(string: "lotm://reading"))
        case .accessoryInline: Text("\(e.done)/\(e.snap.goal) pages today").widgetURL(URL(string: "lotm://reading"))
        default: SmallView(e: e)
        }
    }
}

struct LOTMWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LOTMReading", provider: Provider()) { e in
            LOTMWidgetView(e: e)
                .containerBackground(for: .widget) { LinearGradient(colors: [Palette.full.bg, Palette.full.bg2], startPoint: .top, endPoint: .bottom) }
        }
        .configurationDisplayName("Life of the Mind")
        .description("Today’s reading goal, your next event and book, and a Commonplace box.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LOTMWidgets: WidgetBundle {
    var body: some Widget { LOTMWidget() }
}
