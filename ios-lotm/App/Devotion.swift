import SwiftUI
import AVFoundation

// The devotion, native: the painted opening with its wheels of days and offices, and the liturgy itself — sections,
// rubrics, paintings framed as they were set, the day's Scripture in the ESV, hymn tunes, and the choice of confession.
// The text is the same light markup the website reads (# day, ## section, > rubric, — attribution, 🖼 painting, ♪ tune).

// MARK: - The text

struct DBlock: Identifiable { let id: String; var kind: String; var lines: [String]; var verse = false }
struct DFrame { var x = 50.0, y = 50.0, z = 1.0, h = 0.0
    init(_ f: String) {
        let p = f.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
        if p.count > 0, let v = p[0] { x = v }; if p.count > 1, let v = p[1] { y = v }
        if p.count > 2, let v = p[2], v > 0 { z = max(1, min(5, v)) }; if p.count > 3, let v = p[3], v > 0 { h = max(20, min(220, v)) }
    }
}
struct DDate { var size = 100.0, y = 9.0, align = "center", look = "plain", weekday = false, hide = false
    init(_ body: String) {
        guard let l = body.split(separator: "\n").first(where: { $0.hasPrefix("⚙") && $0.contains("date") }) else { return }
        var o: [String: String] = [:]
        for kv in l.split(separator: "|").dropFirst() { let p = kv.split(separator: "=").map { $0.trimmingCharacters(in: .whitespaces) }; if p.count == 2 { o[p[0]] = p[1] } }
        if let v = o["size"].flatMap(Double.init) { size = max(40, min(200, v)) }; if let v = o["y"].flatMap(Double.init) { y = max(0, min(90, v)) }
        if let a = o["align"], a == "left" || a == "right" { align = a }
        if let k = o["look"], ["italic", "caps", "smallcaps"].contains(k) { look = k }
        weekday = o["weekday"] == "1"; hide = o["hide"] == "1"
    }
}
private func dparse(_ body: String) -> [DBlock] {
    var out: [DBlock] = [], para: [String] = []
    func flush() { if !para.isEmpty { out.append(DBlock(id: "b\(out.count)", kind: "para", lines: para)); para = [] } }
    func add(_ k: String, _ l: [String]) { flush(); out.append(DBlock(id: (k == "day" ? "d" : "b") + "\(out.count)", kind: k, lines: l)) }
    for raw in body.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n") {
        var l = raw; while let c = l.last, c.isWhitespace { l.removeLast() }
        let t = l.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { flush(); continue }
        if l.hasPrefix("⚙") { continue }
        if l.hasPrefix("### ") { add("office", [String(l.dropFirst(4)).trimmingCharacters(in: .whitespaces)]) }
        else if l.hasPrefix("## ") { add("head", [String(l.dropFirst(3)).trimmingCharacters(in: .whitespaces)]) }
        else if l.hasPrefix("# ") { add("day", [String(l.dropFirst(2)).trimmingCharacters(in: .whitespaces)]) }
        else if l.hasPrefix(">") { add("rubric", [String(l.dropFirst(1)).trimmingCharacters(in: .whitespaces)]) }
        else if l.hasPrefix("🖼") { var p = String(l.dropFirst(1)).components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }; while p.count < 4 { p.append("") }; add("art", p) }
        else if l.hasPrefix("♪") { add("tune", [String(l.dropFirst(1)).trimmingCharacters(in: .whitespaces)]) }
        else if l.hasPrefix("— ") || l.hasPrefix("-- ") { add("attr", [String(l.dropFirst(l.hasPrefix("— ") ? 2 : 3))]) }
        else { para.append(l) }
    }
    flush(); return out
}
private func noWeekday(_ t: String) -> String { t.replacingOccurrences(of: #"^(mon|tues|wednes|thurs|fri|satur|sun)day,?\s*"#, with: "", options: [.regularExpression, .caseInsensitive]) }
private func dayDate(_ t: String) -> Date? {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "MMMM d, yyyy"
    return f.date(from: "\(noWeekday(t)), \(Calendar.current.component(.year, from: Date()))")
}
private func plainHead(_ t: String) -> String { t.replacingOccurrences(of: "[’‘]", with: "'", options: .regularExpression).lowercased().trimmingCharacters(in: .whitespaces) }
private func isRef(_ t: String) -> Bool {
    t.trimmingCharacters(in: .whitespaces).range(of: #"^((?:[1-3]\s)?[A-Z][A-Za-z]+(?:\s(?:of\s)?[A-Z][a-z]+)*\.?\s\d+(?::\d+)?(?:\s?[–—-]\s?\d+(?::\d+)?)?(?:,\s?\d+(?:[–-]\d+)?)*)(?:;\s?(?:[1-3]\s)?[A-Z][A-Za-z]+(?:\s[A-Z][a-z]+)*\.?\s\d+(?::\d+)?(?:\s?[–—-]\s?\d+(?::\d+)?)?)*$"#, options: .regularExpression) != nil
}
private func tuneOf(_ raw: String) -> (name: String, url: String) { let p = raw.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }; return (p.first ?? "", p.count > 1 ? p[1] : "") }
private typealias Pal = T
private let OFFICES = ["Morning", "Noon", "Evening"]
private let NOON = ["call to worship", "scripture reading", "lord's prayer", "benediction"]
private let EVENING = ["confession of sin", "assurance of pardon", "prayer of intercession", "lord's prayer", "benediction"]

struct DTheme { let bg: Color, fg: Color, red: Color, mut: Color, dark: Bool }
private let DTHEMES: [String: DTheme] = [
    "lotm": DTheme(bg: Color(rgb: 0x3b3e2a), fg: Color(rgb: 0xf1eedd), red: Color(rgb: 0xec8f82), mut: Color(rgb: 0xb9b99c), dark: true),
    "black": DTheme(bg: Color(rgb: 0x050403), fg: Color(rgb: 0xe9e0c9), red: Color(rgb: 0xcf6f5d), mut: Color(rgb: 0x8f8571), dark: true),
    "sepia": DTheme(bg: Color(rgb: 0xf4ecd8), fg: Color(rgb: 0x3b2f22), red: Color(rgb: 0xa3281d), mut: Color(rgb: 0x8c7b63), dark: false),
    "paper": DTheme(bg: .white, fg: Color(rgb: 0x1a1a1a), red: Color(rgb: 0xa3281d), mut: Color(rgb: 0x8a8a8e), dark: false),
]
/// The reading face, at any size and weight.
struct DFace {
    let family: String
    func font(_ s: CGFloat, bold: Bool = false, italic: Bool = false) -> Font {
        switch family {
        case "garamond": return .serif(s, bold ? .bold : .regular, italic: italic)
        case "sans": var f = Font.system(size: s, weight: bold ? .bold : .regular); if italic { f = f.italic() }; return f
        default:
            var f = Font.custom(family == "georgia" ? "Georgia" : "Iowan Old Style", fixedSize: s)
            if bold { f = f.bold() }; if italic { f = f.italic() }; return f
        }
    }
}
/// **bold**, *italic* and [[red]] inside a line.
private func dinline(_ t: String, face: DFace, size: CGFloat, red: Color, bold: Bool = false, italic: Bool = false) -> Text {
    var out = Text(""); let ns = t as NSString
    let re = try! NSRegularExpression(pattern: #"(\*\*[^*]+\*\*|\*[^*]+\*|\[\[[^\]]+\]\])"#)
    var last = 0
    func plain(_ s: String) -> Text { Text(s).font(face.font(size, bold: bold, italic: italic)) }
    for m in re.matches(in: t, range: NSRange(location: 0, length: ns.length)) {
        if m.range.location > last { out = out + plain(ns.substring(with: NSRange(location: last, length: m.range.location - last))) }
        let s = ns.substring(with: m.range)
        if s.hasPrefix("**") { out = out + Text(String(s.dropFirst(2).dropLast(2))).font(face.font(size, bold: true, italic: italic)) }
        else if s.hasPrefix("[[") { out = out + Text(String(s.dropFirst(2).dropLast(2))).font(face.font(size, bold: bold, italic: italic)).foregroundColor(red) }
        else { out = out + Text(String(s.dropFirst(1).dropLast(1))).font(face.font(size, bold: bold, italic: true)) }
        last = m.range.location + m.range.length
    }
    if last < ns.length { out = out + plain(ns.substring(from: last)) }
    return out
}

// MARK: - Hymn tunes: a recording as it is, or a MIDI file through a soft organ voice

@MainActor
final class TunePlayer {
    static let shared = TunePlayer()
    private var player: AVPlayer?, engine: AVAudioEngine?, node: AVAudioPlayerNode?, watch: Any?, token = 0
    func stop() {
        token += 1; player?.pause(); player = nil
        if let w = watch { NotificationCenter.default.removeObserver(w); watch = nil }
        node?.stop(); engine?.stop(); node = nil; engine = nil
    }
    func play(_ url: String, onEnd: @escaping () -> Void) async throws {
        stop(); let mine = token
        guard let u = URL(string: url) else { throw NSError(domain: "tune", code: 1) }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default); try? AVAudioSession.sharedInstance().setActive(true)
        if url.range(of: #"\.midi?(\?|$)"#, options: [.regularExpression, .caseInsensitive]) == nil {
            let item = AVPlayerItem(url: u); let p = AVPlayer(playerItem: item); player = p
            watch = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in Task { @MainActor in if self?.token == mine { self?.stop(); onEnd() } } }
            p.play(); return
        }
        let (data, _) = try await URLSession.shared.data(from: u)
        let buf = try await Task.detached(priority: .userInitiated) { try Self.render(Self.notes([UInt8](data))) }.value
        guard token == mine else { return }
        let e = AVAudioEngine(), n = AVAudioPlayerNode()
        e.attach(n); e.connect(n, to: e.mainMixerNode, format: buf.format)
        try e.start(); engine = e; node = n
        n.scheduleBuffer(buf, at: nil, options: []) { Task { @MainActor [weak self] in if self?.token == mine { self?.stop(); onEnd() } } }
        n.play()
    }
    private struct Note { let t: Double, d: Double, k: Int, v: Double }
    nonisolated private static func notes(_ b: [UInt8]) throws -> [Note] {
        var p = 0
        func u8() -> Int { defer { p += 1 }; return p < b.count ? Int(b[p]) : 0 }
        func u16() -> Int { (u8() << 8) | u8() }
        func u32() -> Int { (u16() << 16) | u16() }
        func tag() -> String { defer { p += 4 }; return p + 4 <= b.count ? String(bytes: b[p..<p + 4], encoding: .ascii) ?? "" : "" }
        func vlq() -> Int { var v = 0; while true { let c = u8(); v = (v << 7) | (c & 0x7f); if c & 0x80 == 0 || p >= b.count { break } }; return v }
        guard tag() == "MThd" else { throw NSError(domain: "tune", code: 2) }
        let hl = u32(); _ = u16(); let tracks = u16(), div = u16(); p += hl - 6
        guard div & 0x8000 == 0, div > 0 else { throw NSError(domain: "tune", code: 3) }
        struct Ev { let tick: Int; var on: (Int, Int, Int)? = nil; var off: (Int, Int)? = nil; var tempo: Int? = nil }
        var evs: [Ev] = []
        for _ in 0..<tracks where p < b.count {
            guard tag() == "MTrk" else { break }
            let l = u32(), stop = min(b.count, p + l); var tick = 0, run = 0
            while p < stop {
                tick += vlq()
                var st = p < b.count ? Int(b[p]) : 0
                if st & 0x80 != 0 { p += 1; if st < 0xf0 { run = st } } else { st = run }
                let type = st & 0xf0, ch = st & 0x0f
                if st == 0xff { let mt = u8(), n = vlq(); if mt == 0x51, p + 2 < b.count { evs.append(Ev(tick: tick, tempo: (Int(b[p]) << 16) | (Int(b[p + 1]) << 8) | Int(b[p + 2]))) }; p += n }
                else if st == 0xf0 || st == 0xf7 { p += vlq() }
                else if type == 0x90 || type == 0x80 {
                    let k = u8(), v = u8()
                    if ch == 9 { continue }
                    if type == 0x90 && v > 0 { evs.append(Ev(tick: tick, on: (ch, k, v))) } else { evs.append(Ev(tick: tick, off: (ch, k))) }
                } else if type == 0xc0 || type == 0xd0 { p += 1 } else { p += 2 }
            }
            p = stop
        }
        let keyed = evs.enumerated().map { (i, e) in (e.tick, e.tempo == nil ? 1 : 0, i, e) }
        let sorted = keyed.sorted { a, c in a.0 != c.0 ? a.0 < c.0 : a.1 != c.1 ? a.1 < c.1 : a.2 < c.2 }.map { $0.3 }
        var tempo = 500_000.0, last = 0, sec = 0.0, open: [Int: (Double, Double)] = [:], out: [Note] = []
        for e in sorted {
            sec += Double(e.tick - last) * tempo / 1e6 / Double(div); last = e.tick
            if let t = e.tempo { tempo = Double(t) }
            else if let o = e.on { open[o.0 * 128 + o.1] = (sec, Double(o.2) / 127) }
            else if let f = e.off, let o = open.removeValue(forKey: f.0 * 128 + f.1) { out.append(Note(t: o.0, d: max(0.05, sec - o.0), k: f.1, v: o.1)) }
        }
        return out
    }
    /// A gentle flue-pipe organ: fundamental, octave and a soft twelfth.
    nonisolated private static func render(_ notes: [Note]) throws -> AVAudioPCMBuffer {
        let sr = 44_100.0, total = (notes.map { $0.t + $0.d }.max() ?? 0) + 0.8
        guard total < 900, let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1), let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(total * sr)), let ch = buf.floatChannelData?[0] else { throw NSError(domain: "tune", code: 4) }
        let n = Int(total * sr); buf.frameLength = AVAudioFrameCount(n)
        for i in 0..<n { ch[i] = 0 }
        for x in notes {
            let f = 440 * pow(2, Double(x.k - 69) / 12), s = Int((x.t + 0.15) * sr), len = Int((x.d + 0.12) * sr), amp = 0.09 * (0.5 + x.v / 2)
            let w = 2 * Double.pi * f / sr, att = 0.03 * sr, hold = x.d * sr, rel = 0.12 * sr
            for i in 0..<len where s + i < n {
                let t = Double(i), env = t < att ? t / att : t < hold ? 1 : max(0, 1 - (t - hold) / rel)
                ch[s + i] += Float(amp * env * (sin(w * t) + 0.32 * sin(2 * w * t) + 0.1 * sin(3 * w * t)))
            }
        }
        return buf
    }
}

// MARK: - The devotion itself

@MainActor
final class DevotionModel: ObservableObject {
    let slug: String
    weak var feed: FeedModel?
    @Published var loaded = false
    @Published var title = ""
    @Published var blocks: [DBlock] = []
    @Published var date = DDate("")
    @Published var prayers: [(title: String, blocks: [DBlock])] = []
    @Published var recs: [String: String] = [:]
    @Published var confession = UserDefaults.standard.string(forKey: "lotm.confession") ?? "" { didSet { UserDefaults.standard.set(confession, forKey: "lotm.confession") } }
    @Published var size = UserDefaults.standard.object(forKey: "reader.size") as? Double ?? 20 { didSet { UserDefaults.standard.set(size, forKey: "reader.size") } }
    @Published var theme = UserDefaults.standard.string(forKey: "reader.theme") ?? "black" { didSet { UserDefaults.standard.set(theme, forKey: "reader.theme") } }
    @Published var family = UserDefaults.standard.string(forKey: "reader.font") ?? "garamond" { didSet { UserDefaults.standard.set(family, forKey: "reader.font") } }
    @Published var playing = ""
    @Published var note: String?
    @Published var esv: [String: (canonical: String, text: String)?] = [:]
    @Published var admin = false
    init(slug: String) { self.slug = slug }
    var T: DTheme { DTHEMES[theme] ?? DTHEMES["black"]! }
    var face: DFace { DFace(family: family) }
    var days: [DBlock] { blocks.filter { $0.kind == "day" } }
    private func db() async -> Supa? { guard let a = await feed?.auth() else { return nil }; return Supa(a: a) }
    func say(_ s: String) { note = s; Task { try? await Task.sleep(nanoseconds: 3_000_000_000); if note == s { note = nil } } }

    func load() async {
        guard let db = await db() else { loaded = true; return }
        async let D = db.rows("/rest/v1/devotionals?slug=eq.\(slug)&select=title,body")
        async let V = db.rows("/rest/v1/devotionals?slug=eq.valley-of-vision&select=body")
        async let H = db.rows("/rest/v1/hymn_tunes?select=name,url")
        async let P = db.rows("/rest/v1/profiles?id=eq.\(db.a.me)&select=role")
        if let d = (try? await D)?.first { title = d["title"] as? String ?? ""; let body = d["body"] as? String ?? ""; blocks = dparse(body); date = DDate(body) }
        var out: [(title: String, blocks: [DBlock])] = []
        for b in dparse(((try? await V)?.first?["body"] as? String) ?? "") {
            if b.kind == "day" { out.append((b.lines[0], [])) } else if !out.isEmpty { var x = b; x.verse = b.kind == "para"; out[out.count - 1].blocks.append(DBlock(id: "v" + x.id, kind: x.kind, lines: x.lines, verse: x.verse)) }
        }
        prayers = out
        var r: [String: String] = [:]; for x in (try? await H) ?? [] { if let n = x["name"] as? String, let u = x["url"] as? String { r[n] = u } }; recs = r
        admin = (try? await P)?.first?["role"] as? String == "administrator"
        loaded = true
    }
    /// The day to open on: today's date if there is one, else the latest day already reached, else the first.
    var today: DBlock? {
        let t0 = Calendar.current.startOfDay(for: Date())
        let dated = days.compactMap { d in dayDate(d.lines[0]).map { (d, $0) } }
        return (dated.first(where: { $0.1 == t0 }) ?? dated.last(where: { $0.1 <= t0 }) ?? dated.first)?.0 ?? days.first
    }
    private func dayBlocks(_ id: String) -> [DBlock] {
        var on = false, out: [DBlock] = []
        for b in blocks { if b.kind == "day" { if on { break }; on = b.id == id } else if on { out.append(b) } }
        return out
    }
    /// Each day has three offices. A day can mark them with '### Morning' and so on; until it does, Morning is the whole
    /// liturgy (less the Catechism, the closing Praise and the Benediction) and Noon and Evening are drawn from its sections.
    func office(_ dayId: String, _ o: String) -> [DBlock] {
        let bs = dayBlocks(dayId).filter { $0.kind != "art" || $0.lines[2].isEmpty || $0.lines[2].lowercased() == o.lowercased() }
        if bs.contains(where: { $0.kind == "office" }) { var on = false; return bs.filter { b in if b.kind == "office" { on = b.lines[0].lowercased().hasPrefix(o.lowercased()); return false }; return on } }
        if o == "Morning" {
            let praises = bs.indices.filter { bs[$0].kind == "head" && plainHead(bs[$0].lines[0]) == "praise" }
            var skip = false, out: [DBlock] = []
            for (k, b) in bs.enumerated() {
                if b.kind == "head" { let h = plainHead(b.lines[0]); skip = h == "catechism" || h == "benediction" || (praises.count > 1 && k == praises.last) }
                if !skip { out.append(b) }
            }
            return out
        }
        let want = o == "Noon" ? NOON : EVENING; var on = false, out: [DBlock] = []
        for b in bs { if b.kind == "head" { on = want.contains(plainHead(b.lines[0])) }; if on { out.append(b) } }
        return out
    }
    func minutes(_ dayId: String, _ o: String) -> Int { max(1, Int((Double(office(dayId, o).reduce(0) { $0 + $1.lines.joined(separator: " ").split(whereSeparator: \.isWhitespace).count }) / 150).rounded())) }
    /// What is read: the office, with the confession that was chosen, and a painting lifted above its section's heading.
    func shown(_ dayId: String, _ o: String) -> [DBlock] {
        var bs = office(dayId, o)
        if let at = bs.firstIndex(where: { $0.kind == "head" && plainHead($0.lines[0]) == "confession of sin" }), !prayers.isEmpty {
            let end = bs.indices.first { $0 > at && bs[$0].kind == "head" } ?? bs.count
            var k = at + 1; while k < end && bs[k].kind == "rubric" { k += 1 }
            let sec = Array(bs[k..<end]), arts = sec.filter { $0.kind == "art" }, rest = sec.filter { $0.kind != "art" }
            let pr = prayers.first { $0.title == confession }
            let body = pr.map { $0.blocks + [DBlock(id: "vov", kind: "attr", lines: ["The Valley of Vision"])] } ?? rest
            bs = Array(bs[..<k]) + arts + [DBlock(id: "choice", kind: "choice", lines: [])] + body + Array(bs[end...])
        }
        var i = 0
        while i < bs.count { if bs[i].kind == "head" { var j = i + 1; while j < bs.count && bs[j].kind == "rubric" { j += 1 }; if j < bs.count, bs[j].kind == "art" { let a = bs.remove(at: j); bs.insert(a, at: i); i += 1 } }; i += 1 }
        return bs
    }
    func loadESV(_ q: String) async {
        guard esv[q] == nil, let db = await db() else { return }
        let ref = q.replacingOccurrences(of: "[–—]", with: "-", options: .regularExpression).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? q
        if let d = try? await db.req("GET", "/functions/v1/esv?q=\(ref)"), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], let t = j["text"] as? String, !t.isEmpty {
            esv[q] = .some((j["canonical"] as? String ?? q, t))
        } else { esv[q] = .some(nil) }
    }
    func toggle(_ name: String, _ url: String) {
        if playing == name { TunePlayer.shared.stop(); playing = ""; return }
        let u = url.isEmpty ? (recs[name] ?? "") : url
        guard !u.isEmpty else { say("The music for \(name) isn’t added yet."); return }
        playing = name; Haptic.tap()
        Task { do { try await TunePlayer.shared.play(u) { [weak self] in if self?.playing == name { self?.playing = "" } } } catch { playing = ""; say("That tune couldn’t be played.") } }
    }
}

/// Open the devotion over the app.
@MainActor func openDevotion(_ web: WebModel, slug: String, office: String? = nil) {
    let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
    var top = root; while let p = top?.presentedViewController { top = p }
    guard let top, !(top is DevotionHost) else { return }
    let m = DevotionModel(slug: slug); m.feed = web.feed
    let vc = DevotionHost(rootView: AnyView(EmptyView()))
    vc.rootView = AnyView(DevotionScreen(m: m, web: web, office: office, close: { [weak vc] then in TunePlayer.shared.stop(); vc?.dismiss(animated: true) { then?() } }))
    vc.modalPresentationStyle = .fullScreen; vc.modalTransitionStyle = .crossDissolve; vc.overrideUserInterfaceStyle = .dark
    vc.view.backgroundColor = UIColor(red: 0.055, green: 0.059, blue: 0.035, alpha: 1)
    top.present(vc, animated: true)
}
final class DevotionHost: UIHostingController<AnyView> {}

private let adorationArt: UIImage = Bundle.main.path(forResource: "adoration", ofType: "jpg").flatMap(UIImage.init(contentsOfFile:)) ?? UIImage()
private struct TopY: PreferenceKey { static var defaultValue: CGFloat = 0; static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() } }

struct DevotionScreen: View {
    @StateObject var m: DevotionModel
    @ObservedObject var web: WebModel
    let close: ((() -> Void)?) -> Void
    @State private var stage = "pick"
    @State private var intro = 0                  // 0 dark, 1 the painting, 2 title, 3 rule and date, 4 title fades, 5 the menu
    @State private var dayId: String?
    @State private var office: String?
    @State private var veil = 0.0
    @State private var entry = 0
    @State private var chrome = false
    @State private var sheet = ""                 // "", toc, search, type, reminders
    @State private var armed = true
    @State private var hint = false
    @State private var q = ""

    init(m: DevotionModel, web: WebModel, office: String?, close: @escaping ((() -> Void)?) -> Void) {
        _m = StateObject(wrappedValue: m); self.web = web; self.close = close
        let h = Calendar.current.component(.hour, from: Date())
        _office = State(initialValue: office.flatMap { OFFICES.contains($0) ? $0 : nil } ?? (h < 11 ? "Morning" : h < 16 ? "Noon" : "Evening"))
    }
    private var T: DTheme { m.T }
    private var day: DBlock? { m.days.first { $0.id == dayId } ?? m.today }
    private var off: String { office ?? "Morning" }

    var body: some View {
        ZStack {
            Color(rgb: 0x0e0f09).ignoresSafeArea()
            if stage == "pick" { cover.transition(.opacity) } else { reading.transition(.opacity) }
            Color.black.ignoresSafeArea().opacity(veil).allowsHitTesting(veil > 0.01)
            if let n = m.note { VStack { Spacer(); Text(n).font(.sans(13.5)).foregroundStyle(Color(rgb: 0xf4f1e2)).multilineTextAlignment(.center).padding(.horizontal, 14).padding(.vertical, 9).background(RoundedRectangle(cornerRadius: 18).fill(Color(rgb: 0x141410, 0.9))).padding(.bottom, 90) }.transition(.opacity) }
        }
        .animation(.easeOut(duration: 0.25), value: m.note)
        .statusBarHidden(stage == "read" && !chrome)
        .preferredColorScheme(stage == "read" && !T.dark ? .light : .dark)
        .task {
            await m.load(); if dayId == nil { dayId = m.today?.id }
        }
        .task {
            // Slow and quiet: the painting comes up first, the title over it, then the date; held, then the menu.
            for (n, wait) in [(1, 0.15), (2, 1.15), (3, 1.3), (4, 2.8), (5, 1.1)] { try? await Task.sleep(nanoseconds: UInt64(wait * 1e9)); if intro < n { intro = n } }
        }
        .sheet(isPresented: Binding(get: { !sheet.isEmpty }, set: { if !$0 { sheet = "" } })) { panel.presentationDetents(sheet == "type" ? [.height(330)] : [.medium, .large]) }
    }

    /// Everything slowly goes to black, a breath of darkness, then what follows fades in out of it.
    private func throughDark(slow: Bool = true, _ change: @escaping () -> Void) {
        guard veil == 0 else { return }
        withAnimation(.easeIn(duration: slow ? 1.2 : 0.7)) { veil = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + (slow ? 1.6 : 0.95)) { change(); entry += 1; withAnimation(.easeOut(duration: 1.8)) { veil = 0 } }
    }
    private func begin() { Haptic.tap(); throughDark { stage = "read"; chrome = false; armed = false; hint = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { armed = true }; DispatchQueue.main.asyncAfter(deadline: .now() + 6.5) { hint = false } } }
    private func toMenu() { Haptic.tap(); TunePlayer.shared.stop(); m.playing = ""; intro = 5; withAnimation(.easeInOut(duration: 0.45)) { stage = "pick" } }

    // MARK: the painted opening

    private var cover: some View {
        GeometryReader { g in
            let W = g.size.width, H = g.size.height, ty = H * 0.56
            let IW: CGFloat = 1800, IH: CGFloat = 1737, FY: CGFloat = 945
            // The painting is placed so the Christ child's face is level with the chosen office.
            let s = max(W / IW, H / IH, ty / FY, (H - ty) / (IH - FY)), y = min(0, max(H - IH * s, ty - FY * s))
            ZStack {
                Image(uiImage: adorationArt).resizable().frame(width: IW * s, height: IH * s).offset(x: -0.71 * (IW * s - W), y: y)
                    .frame(width: W, height: H, alignment: .topLeading).clipped()
                    .overlay(LinearGradient(colors: [Color(rgb: 0x0e0f09, 0.66), Color(rgb: 0x0e0f09, 0.8)], startPoint: .top, endPoint: .bottom))
                    .overlay(RadialGradient(colors: [Color(rgb: 0x0a0b06, 0.55), .clear], center: .center, startRadius: 0, endRadius: W * 0.6))
                    .opacity(intro >= 1 ? 1 : 0).scaleEffect(intro >= 1 ? 1 : 1.04).animation(.easeOut(duration: 2.4), value: intro >= 1)
                if intro < 5 {
                    VStack(spacing: 0) {
                        Text("LOTM").font(.serif(16, .medium)).tracking(5).foregroundStyle(Color(rgb: 0xe2c37a)).opacity(intro >= 2 ? 1 : 0)
                        Text("Liturgical Devotion for Advent").font(.serif(32)).foregroundStyle(Color(rgb: 0xf4f1e2)).multilineTextAlignment(.center).frame(maxWidth: 320).shadow(color: .black.opacity(0.6), radius: 9, y: 2).padding(.top, 8).opacity(intro >= 2 ? 1 : 0)
                        Color(rgb: 0x8a8d6a).frame(width: 44, height: 1).padding(.top, 12).opacity(intro >= 3 ? 1 : 0)
                        Text((m.today.map { "\($0.lines[0]), " } ?? "") + String(Calendar.current.component(.year, from: Date()))).font(.serif(19, italic: true)).foregroundStyle(Color(rgb: 0xec8f82)).padding(.top, 12).opacity(intro >= 3 ? 1 : 0)
                    }
                    .padding(24).opacity(intro >= 4 ? 0 : 1).animation(.easeInOut(duration: 1.5), value: intro)
                }
                if day != nil { picker.opacity(intro >= 5 ? 1 : 0).allowsHitTesting(intro >= 5).animation(.easeOut(duration: 0.5), value: intro >= 5) }
                if intro >= 5 {
                    Button { close(nil) } label: { Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundStyle(Color(rgb: 0xf4f1e2)).frame(width: 38, height: 38).background(Circle().fill(Color(rgb: 0xf4f1e2, 0.16))) }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(.trailing, 14).padding(.top, 6).accessibilityLabel("Close the devotion").transition(.opacity)
                }
            }
            .contentShape(Rectangle()).onTapGesture { if intro < 5 { withAnimation { intro = 5 } } }
        }
        .ignoresSafeArea(edges: .bottom)
    }

    private var picker: some View {
        let fg = Color(rgb: 0xf4f1e2), mut = Color(rgb: 0xd6d1b8), W = UIScreen.main.bounds.width
        let desc = ["Morning": "The full liturgy", "Noon": "A shorter liturgy for midday", "Evening": "Confession, intercession and blessing"][off] ?? ""
        return VStack(spacing: 0) {
            Spacer()
            Text("ADVENT").font(.serif(13, .medium)).tracking(4).foregroundStyle(Color(rgb: 0xe2c37a))
            // the days, as a sideways wheel
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(m.days) { d in
                        let dt = dayDate(d.lines[0])
                        VStack(spacing: 4) {
                            if let dt {
                                Text(dt.formatted(.dateTime.weekday(.wide)).uppercased()).font(.sans(11, .bold)).tracking(1.6).foregroundStyle(mut)
                                Text(noWeekday(d.lines[0])).font(.serif(34)).foregroundStyle(fg).lineLimit(1).minimumScaleFactor(0.6)
                            } else { Text(d.lines[0]).font(.sans(12, .semibold)).foregroundStyle(fg) }
                        }
                        .frame(width: 176, height: 74).contentShape(Rectangle())
                        .scrollTransition(.interactive, axis: .horizontal) { c, ph in c.scaleEffect(1 - min(abs(ph.value), 2) * 0.4).opacity(max(0.12, 1 - abs(ph.value) * 0.55)) }
                        .onTapGesture { withAnimation(.snappy) { dayId = d.id } }
                        .id(d.id)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, max(0, (W - 176) / 2), for: .scrollContent)
            .scrollTargetBehavior(.viewAligned).scrollPosition(id: $dayId, anchor: .center)
            .frame(height: 82).padding(.top, 2)
            .mask(LinearGradient(stops: [.init(color: .clear, location: 0.02), .init(color: .black, location: 0.24), .init(color: .black, location: 0.76), .init(color: .clear, location: 0.98)], startPoint: .leading, endPoint: .trailing))
            mut.opacity(0.6).frame(width: 44, height: 1).padding(.top, 14).padding(.bottom, 10)
            // the three offices, as a wheel: the one in the middle is chosen
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    ForEach(OFFICES, id: \.self) { o in
                        Text(o).font(.serif(30)).foregroundStyle(fg).frame(width: 260, height: 64).contentShape(Rectangle())
                            .scrollTransition(.interactive, axis: .vertical) { c, ph in c.scaleEffect(1 - min(1, abs(ph.value)) * 0.12).opacity(max(0.18, 1 - abs(ph.value) * 0.72)).rotation3DEffect(.degrees(-ph.value * 28), axis: (1, 0, 0), perspective: 0.6) }
                            .onTapGesture { if o == off { begin() } else { withAnimation(.snappy) { office = o } } }
                            .id(o)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.vertical, 64, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned).scrollPosition(id: $office, anchor: .center)
            .frame(width: 260, height: 192)
            .overlay { VStack(spacing: 0) { mut.opacity(0.33).frame(height: 1); Spacer().frame(height: 62); mut.opacity(0.33).frame(height: 1) }.allowsHitTesting(false) }
            Text("\(desc) · about \(day.map { m.minutes($0.id, off) } ?? 1) min").font(.serif(17, italic: true)).foregroundStyle(mut).padding(.top, 10)
            Button { begin() } label: { Text("Begin").font(.sans(16, .bold)).foregroundStyle(Color(rgb: 0x1d1f14)).padding(.horizontal, 34).frame(height: 46).background(Capsule().fill(fg)) }.buttonStyle(Press(scale: 0.96)).padding(.top, 22)
            Spacer()
            Text("Adoration of the Magi, Beuronese mural by the monks of Conception Abbey, 1896. Basilica of the Immaculate Conception, Conception, Missouri.").font(.serif(12, italic: true)).foregroundStyle(mut.opacity(0.75)).multilineTextAlignment(.center).padding(.horizontal, 24).padding(.bottom, 30)
        }
        .shadow(color: .black.opacity(0.65), radius: 7, y: 1)
        .onChange(of: dayId) { _, _ in Haptic.tap() }.onChange(of: office) { _, _ in Haptic.tap() }
    }

    // MARK: the reading

    private var reading: some View {
        let size = CGFloat(m.size), bs = day.map { m.shown($0.id, off) } ?? [], hero = bs.first?.kind == "art" ? bs.first : nil
        let W = UIScreen.main.bounds.width, SH = UIScreen.main.bounds.height
        return ZStack(alignment: .bottomTrailing) {
            T.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let h = hero {
                        Painting(src: h.lines[0], caption: h.lines[1], frame: DFrame(h.lines[3]), T: T, size: size, hero: true)
                            .overlay(alignment: .top) { title(size).padding(.horizontal, 24).padding(.top, max(54, SH * CGFloat(m.date.y) / 100 * 0.56 + 44)).shadow(color: .black.opacity(0.75), radius: 11, y: 2) }
                            .padding(.bottom, size * 1.4)
                    } else {
                        title(size).padding(.horizontal, 28).padding(.top, SH * 0.14 + size * 1.2).padding(.bottom, size * 1.8)
                    }
                    if bs.isEmpty { Text(m.loaded ? "This office isn’t written for this day yet." : "Opening…").font(m.face.font(size, italic: true)).foregroundStyle(T.mut).frame(maxWidth: .infinity).padding(.top, 40) }
                    ForEach(Array(bs.enumerated()), id: \.element.id) { i, b in
                        if !(i == 0 && hero != nil) { block(b, i, bs, size).padding(.horizontal, b.kind == "art" ? 0 : 28) }
                    }
                    Text("☩").font(.system(size: size * 1.5)).foregroundStyle(T.red).frame(maxWidth: .infinity).padding(.top, size * 2.2).padding(.bottom, size)
                    Text("Swipe up to close").font(.sans(11)).tracking(0.9).foregroundStyle(T.mut.opacity(0.55)).frame(maxWidth: .infinity).padding(.top, 14)
                    Color.clear.frame(height: SH * 0.3)
                }
                .frame(width: W)
                // A pull down past the top, or up past the end, brings back the devotion menu.
                .background(PullWatch(distance: 80, top: { if armed, stage == "read" { armed = false; toMenu() } }, bottom: { if armed, stage == "read" { armed = false; toMenu() } }))
            }
            .id(entry)
            .coordinateSpace(name: "devotion")
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .top)
            // Nothing is read under the clock: the page fades out beneath it.
            .overlay(alignment: .top) { LinearGradient(colors: [T.bg.opacity(0.92), T.bg.opacity(0.8), T.bg.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 10).ignoresSafeArea(edges: .top).allowsHitTesting(false) }
            .onTapGesture { withAnimation(.easeOut(duration: 0.25)) { chrome.toggle() } }
            // The reading rises out of the dark below and sinks into it above, as by candlelight.
            VStack { Spacer(); LinearGradient(stops: [.init(color: T.bg.opacity(0), location: 0), .init(color: T.bg.opacity(0.6), location: 0.45), .init(color: T.bg.opacity(0.9), location: 0.8), .init(color: T.bg, location: 1)], startPoint: .top, endPoint: .bottom).frame(height: SH * 0.3) }.ignoresSafeArea().allowsHitTesting(false)
            Text("Swipe down for the devotion menu").font(.sans(11)).tracking(0.9).foregroundStyle(T.mut).opacity(hint ? 0.45 : 0).animation(.easeInOut(duration: 1.2), value: hint).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).padding(.top, 4).allowsHitTesting(false)
            if chrome {
                Menu {
                    Button { sheet = "toc" } label: { Label("Contents", systemImage: "list.bullet") }
                    Button { sheet = "search" } label: { Label("Search", systemImage: "magnifyingglass") }
                    Button { sheet = "type" } label: { Label("Themes & Settings", systemImage: "textformat.size") }
                    Button { sheet = "reminders" } label: { Label("Reminders", systemImage: "bell") }
                    Button { toMenu() } label: { Label("Devotion menu", systemImage: "chevron.down") }
                    if m.admin { Button { let s = m.slug, d = (day?.lines[0] ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""; close { web.allowWebReader = true; web.go("/read/\(s)?edit=1&day=\(d)") } } label: { Label("Edit the devotion", systemImage: "pencil") } }
                } label: { Image(systemName: "line.3.horizontal").font(.system(size: 16, weight: .bold)).foregroundStyle(T.fg).frame(width: 40, height: 40).background(Circle().fill(Color(rgb: 0x787880, T.dark ? 0.36 : 0.18))) }
                .padding(.trailing, 14).padding(.bottom, 8).transition(.opacity)
            }
        }
    }

    @ViewBuilder private func title(_ size: CGFloat) -> some View {
        if let d = day, !m.date.hide {
            let bare = noWeekday(d.lines[0]), dt = dayDate(d.lines[0])
            let text = m.date.weekday && dt != nil ? "\(dt!.formatted(.dateTime.weekday(.wide))), \(bare)" : bare
            let s = size * 2.1 * CGFloat(m.date.size) / 100, look = m.date.look
            dinline(look == "caps" || look == "smallcaps" ? text.uppercased() : text, face: m.face, size: look == "smallcaps" ? s * 0.8 : s, red: T.red, italic: look == "italic")
                .tracking(look == "caps" ? s * 0.08 : look == "smallcaps" ? s * 0.06 : 0)
                .foregroundColor(T.fg).multilineTextAlignment(m.date.align == "left" ? .leading : m.date.align == "right" ? .trailing : .center)
                .frame(maxWidth: .infinity, alignment: m.date.align == "left" ? .leading : m.date.align == "right" ? .trailing : .center)
        }
    }

    /// The tune of the section a block belongs to, and that section's heading.
    private func section(_ i: Int, _ bs: [DBlock]) -> (tune: (name: String, url: String)?, head: String, chip: Bool) {
        var s = i; while s > 0 && bs[s].kind != "head" { s -= 1 }
        var e = i + 1; while e < bs.count && bs[e].kind != "head" { e += 1 }
        let sec = Array(bs[s..<e]), head = bs[s].kind == "head" ? plainHead(bs[s].lines[0]) : ""
        if let t = sec.first(where: { $0.kind == "tune" }) { let x = tuneOf(t.lines[0]); return ((x.name, x.url.isEmpty ? (m.recs[x.name] ?? "") : x.url), head, false) }
        if let fp = sec.firstIndex(where: { $0.kind == "para" }), let n = tuneForLine(sec[fp].lines.first ?? "") { return ((n, m.recs[n] ?? ""), head, s + fp == i) }
        return (nil, head, false)
    }
    private func chip(_ t: (name: String, url: String), _ size: CGFloat) -> some View {
        let on = m.playing == t.name
        return Button { m.toggle(t.name, t.url) } label: {
            HStack(spacing: 7) { Image(systemName: on ? "stop.fill" : "play.fill").font(.system(size: 9)); Text(t.name.uppercased()).font(.sans(12, .semibold)).tracking(0.7) }
                .foregroundStyle(on ? .white : T.red).padding(.horizontal, 13).frame(height: 30).background(Capsule().fill(on ? T.red : .clear)).overlay(Capsule().stroke(T.red.opacity(0.4)))
        }
        .buttonStyle(.plain).frame(maxWidth: .infinity).padding(.bottom, size * 0.7)
    }
    private func lines(_ b: DBlock, _ size: CGFloat) -> some View {
        return VStack(alignment: .leading, spacing: size * 0.12) {
            ForEach(Array(b.lines.enumerated()), id: \.offset) { _, l in
                let ind = l.prefix { $0.isWhitespace }.count
                dinline(l.trimmingCharacters(in: .whitespaces), face: m.face, size: size, red: T.red).foregroundStyle(T.fg).lineSpacing(size * 0.3)
                    .padding(.leading, CGFloat(ind > 0 ? min(4, (ind + 1) / 2) : 0) * size * 1.2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, size * 0.6)
    }
    @ViewBuilder private func block(_ b: DBlock, _ i: Int, _ bs: [DBlock], _ size: CGFloat) -> some View {
        switch b.kind {
        case "head": dinline(b.lines[0], face: m.face, size: size, red: T.red, bold: true, italic: true).foregroundStyle(T.fg).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, size * 1.6)
        case "rubric": dinline(b.lines[0], face: m.face, size: size, red: T.red, italic: true).foregroundStyle(T.red).multilineTextAlignment(.center).lineSpacing(size * 0.25).frame(maxWidth: .infinity).padding(.bottom, size * 0.7)
        case "attr": dinline(b.lines[0], face: m.face, size: size, red: T.red, italic: true).foregroundStyle(T.fg.opacity(0.9)).multilineTextAlignment(.trailing).frame(maxWidth: .infinity, alignment: .trailing).padding(.top, -size * 0.3).padding(.bottom, size * 0.6)
        case "art": Painting(src: b.lines[0], caption: b.lines[1], frame: DFrame(b.lines[3]), T: T, size: size, hero: false).padding(.top, size * 2.4).padding(.bottom, size * 1.6)
        case "tune": let s = section(i, bs); chip(s.tune ?? tuneOf(b.lines[0]), size)
        case "choice":
            Flow(spacing: 8) {
                ForEach([""] + m.prayers.map(\.title), id: \.self) { v in
                    let cur = m.prayers.contains { $0.title == m.confession } ? m.confession : "", on = cur == v
                    Button { Haptic.tap(); m.confession = v } label: { Text(v.isEmpty ? "Today’s" : v).font(.sans(12.5, .semibold)).foregroundStyle(on ? .white : T.red).padding(.horizontal, 13).frame(height: 30).background(Capsule().fill(on ? T.red : .clear)).overlay(Capsule().stroke(T.red.opacity(0.4))) }.buttonStyle(.plain)
                }
            }.padding(.bottom, size * 0.9)
        case "para":
            let s = section(i, bs)
            if s.head.hasPrefix("scripture reading"), b.lines.count == 1, isRef(b.lines[0]) { ESV(q: b.lines[0].trimmingCharacters(in: .whitespaces), m: m, size: size) }
            else if let t = s.tune {
                if s.chip { chip(t, size) }
                lines(b, size).background(RoundedRectangle(cornerRadius: 8).fill(m.playing == t.name ? T.red.opacity(0.08) : .clear).padding(-6)).contentShape(Rectangle()).onTapGesture { m.toggle(t.name, t.url) }
            } else { lines(b, size) }
        default: EmptyView()
        }
    }

    // MARK: contents, search, type, reminders

    @ViewBuilder private var panel: some View {
        switch sheet {
        case "toc":
            SheetBody { VStack(alignment: .leading, spacing: 0) {
                Text("Contents").font(.serif(18, .semibold)).foregroundStyle(Pal.ink).padding(.horizontal, 20).padding(.bottom, 8)
                ForEach(m.days) { d in Button { jump(d.id) } label: { HStack { Text(d.lines[0]).font(.serif(17)).foregroundStyle(Pal.ink); Spacer(); if d.id == day?.id { Image(systemName: "checkmark").foregroundStyle(Pal.muted) } }.padding(.horizontal, 20).frame(height: 46).contentShape(Rectangle()) }.buttonStyle(.plain) }
            } }.background(Pal.card.ignoresSafeArea()).preferredColorScheme(.dark)
        case "search":
            SheetBody { VStack(alignment: .leading, spacing: 8) {
                TextField("", text: $q, prompt: Text("Search the devotion").foregroundColor(Pal.muted)).font(.sans(16)).foregroundStyle(Pal.ink).autocorrectionDisabled().padding(.horizontal, 14).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Pal.paper))
                ForEach(Array(hits.enumerated()), id: \.offset) { _, h in Button { jump(h.id) } label: { VStack(alignment: .leading, spacing: 2) { Text(h.day).font(.sans(12, .bold)).foregroundStyle(Pal.muted); Text(h.text).font(.serif(16)).foregroundStyle(Pal.ink).multilineTextAlignment(.leading) }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6).contentShape(Rectangle()) }.buttonStyle(.plain) }
                if q.count >= 2 && hits.isEmpty { Text("No matches.").font(.sans(15)).foregroundStyle(Pal.muted) }
            }.padding(.horizontal, 16) }.background(Pal.card.ignoresSafeArea()).preferredColorScheme(.dark)
        case "type":
            SheetBody { VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button { m.size = max(14, m.size - 1); Haptic.tap() } label: { Text("A").font(.sans(15, .semibold)).frame(maxWidth: .infinity).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Pal.group)) }
                    Button { m.size = min(34, m.size + 1); Haptic.tap() } label: { Text("A").font(.sans(22, .semibold)).frame(maxWidth: .infinity).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Pal.group)) }
                }.foregroundStyle(Pal.ink).buttonStyle(.plain)
                HStack(spacing: 10) {
                    ForEach(["black", "lotm", "sepia", "paper"], id: \.self) { k in let t = DTHEMES[k]!
                        Button { m.theme = k; Haptic.tap() } label: { Text("Aa").font(.serif(18)).foregroundStyle(t.fg).frame(maxWidth: .infinity).frame(height: 54).background(RoundedRectangle(cornerRadius: 12).fill(t.bg)).overlay(RoundedRectangle(cornerRadius: 12).stroke(m.theme == k ? Pal.ink : Pal.softBd, lineWidth: m.theme == k ? 2 : 1)) }.buttonStyle(.plain)
                    }
                }
                Seg(options: ["Garamond", "Iowan", "Georgia", "Sans"], value: Binding(get: { ["garamond": "Garamond", "original": "Iowan", "georgia": "Georgia", "sans": "Sans"][m.family] ?? "Garamond" }, set: { m.family = ["Garamond": "garamond", "Iowan": "original", "Georgia": "georgia", "Sans": "sans"][$0] ?? "garamond" }))
            }.padding(.horizontal, 16) }.background(Pal.card.ignoresSafeArea()).preferredColorScheme(.dark)
        default: DevotionReminders(feed: web.feed)
        }
    }
    private var hits: [(id: String, day: String, text: String)] {
        let n = q.trimmingCharacters(in: .whitespaces).lowercased(); guard n.count >= 2 else { return [] }
        var day = "Beginning", did = m.days.first?.id ?? "", out: [(String, String, String)] = []
        for b in m.blocks {
            if b.kind == "day" { day = b.lines[0]; did = b.id; continue }
            let t = b.lines.joined(separator: " ")
            if let r = t.lowercased().range(of: n) { let at = t.distance(from: t.startIndex, to: r.lowerBound); let s = t.index(t.startIndex, offsetBy: max(0, at - 30)), e = t.index(t.startIndex, offsetBy: min(t.count, at + 60)); out.append((did, day, (at > 30 ? "…" : "") + String(t[s..<e]) + "…")) }
            if out.count >= 40 { break }
        }
        return out.map { (id: $0.0, day: $0.1, text: $0.2) }
    }
    private func jump(_ id: String) { sheet = ""; throughDark(slow: false) { dayId = id; office = "Morning"; stage = "read"; chrome = false } }
}

/// A painting in the liturgy, framed as it was set in the editor (place, zoom, height). It rises out of the dark once
/// it is both loaded and in view, and its edges melt into the page.
private struct Painting: View {
    let src: String, caption: String, frame: DFrame, T: DTheme, size: CGFloat, hero: Bool
    @State private var img: UIImage?
    @State private var seen = false
    private static let cache = NSCache<NSString, UIImage>()
    /// Where the painting sits: the frame's size, the painting's size inside it, and how far it is moved up and left.
    private var box: (fw: CGFloat, fh: CGFloat, iw: CGFloat, ih: CGFloat, dx: CGFloat, dy: CGFloat) {
        let W = Double(UIScreen.main.bounds.width), SH = Double(UIScreen.main.bounds.height)
        var r = 0.7
        if let img, img.size.width > 0 { r = Double(img.size.height) / Double(img.size.width) }
        // Without a set frame: the whole painting, up to most of a screen.
        let H: Double = frame.h > 0 ? frame.h / 100 : min(r, SH * (hero ? 0.7 : 0.88) / W)
        let w: Double = frame.z * max(1, H / r)
        let h: Double = w * r
        return (CGFloat(W), CGFloat(W * H), CGFloat(W * w), CGFloat(W * h), CGFloat(-W * (w - 1) * frame.x / 100), CGFloat(-W * (h - H) * frame.y / 100))
    }
    private var shade: LinearGradient {
        LinearGradient(stops: [.init(color: T.bg.opacity(hero ? 0.33 : 1), location: 0), .init(color: T.bg.opacity(0), location: 0.15), .init(color: T.bg.opacity(0), location: 0.74), .init(color: T.bg, location: 1)], startPoint: .top, endPoint: .bottom)
    }
    @ViewBuilder private var picture: some View {
        let b = box, on = seen && img != nil
        ZStack(alignment: .topLeading) {
            if let img {
                Image(uiImage: img).resizable().frame(width: b.iw, height: b.ih).offset(x: b.dx, y: b.dy)
                    .opacity(on ? 1 : 0).scaleEffect(on ? 1 : 1.06).brightness(on ? 0 : -0.5).animation(.easeOut(duration: 2), value: on)
            }
        }
        .frame(width: b.fw, height: b.fh, alignment: .topLeading).clipped()
    }
    var body: some View {
        VStack(spacing: 0) {
            picture.overlay(shade.padding(-1))
                .overlay(alignment: .bottom) { if hero && !caption.isEmpty { cap.padding(.bottom, size * 0.6) } }
            if !hero && !caption.isEmpty { cap.padding(.top, size * 0.5) }
        }
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + (hero ? 0.9 : 0.2)) { seen = true } }
        .task(id: src) {
            if let c = Self.cache.object(forKey: src as NSString) { img = c; return }
            guard let u = URL(string: src), let (d, _) = try? await URLSession.shared.data(from: u), let i = UIImage(data: d) else { return }
            Self.cache.setObject(i, forKey: src as NSString); img = i
        }
        .accessibilityLabel(caption.isEmpty ? "Painting" : caption)
    }
    private var cap: some View { Text(caption).font(.serif(max(11, size * 0.58), italic: true)).foregroundStyle(T.mut).multilineTextAlignment(.center).padding(.horizontal, 32).opacity(seen && img != nil ? 0.8 : 0).animation(.easeOut(duration: 1.4).delay(1.2), value: seen) }
}

/// The day's Scripture written out in the ESV (Crossway's API, through our server so the key stays private).
private struct ESV: View {
    let q: String
    @ObservedObject var m: DevotionModel
    let size: CGFloat
    var body: some View {
        let T = m.T
        Group {
            switch m.esv[q] {
            case .none: Text(q).font(m.face.font(size, italic: true)).foregroundStyle(T.mut).frame(maxWidth: .infinity).padding(.bottom, size * 0.6)
            case .some(.none):
                VStack(spacing: 4) { Text(q).font(m.face.font(size)).foregroundStyle(T.fg)
                    Button("Read it in the ESV ›") { if let u = URL(string: "https://www.esv.org/" + (q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")) { UIApplication.shared.open(u) } }.font(m.face.font(size * 0.85, italic: true)).foregroundStyle(T.red) }.frame(maxWidth: .infinity).padding(.bottom, size * 0.6)
            case .some(.some(let res)):
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(res.text.components(separatedBy: "\n\n").enumerated()), id: \.offset) { _, para in
                        let ls = para.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }, poem = ls.count > 1 || para.hasPrefix("  ")
                        if poem {
                            VStack(alignment: .leading, spacing: size * 0.12) { ForEach(Array(ls.enumerated()), id: \.offset) { _, l in let ind = l.prefix { $0 == " " }.count
                                verse(l.trimmingCharacters(in: .whitespaces), T).padding(.leading, ind > 3 ? size * 2.4 : ind > 0 ? size * 1.2 : 0).fixedSize(horizontal: false, vertical: true) } }.padding(.bottom, size * 0.6)
                        } else { verse(ls.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " "), T).fixedSize(horizontal: false, vertical: true).padding(.bottom, size * 0.6) }
                    }
                    Text("— \(res.canonical) (ESV)").font(m.face.font(size, italic: true)).foregroundStyle(T.fg.opacity(0.9)).frame(maxWidth: .infinity, alignment: .trailing).padding(.top, -size * 0.3).padding(.bottom, size * 0.3)
                    Text("Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.").font(.sans(max(10, size * 0.55))).foregroundStyle(T.mut).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.bottom, size * 0.8)
                }
            }
        }
        .task { await m.loadESV(q) }
    }
    /// Verse numbers ([12]) are set small and red, raised.
    private func verse(_ l: String, _ T: DTheme) -> Text {
        var out = Text(""); let ns = l as NSString; var last = 0
        let re = try! NSRegularExpression(pattern: #"\[(\d+)\]\s?"#)
        for mt in re.matches(in: l, range: NSRange(location: 0, length: ns.length)) {
            if mt.range.location > last { out = out + Text(ns.substring(with: NSRange(location: last, length: mt.range.location - last))).font(m.face.font(size)) }
            out = out + Text(ns.substring(with: mt.range(at: 1)) + " ").font(.sans(size * 0.6, .semibold)).foregroundColor(T.red).baselineOffset(size * 0.3)
            last = mt.range.location + mt.range.length
        }
        if last < ns.length { out = out + Text(ns.substring(from: last)).font(m.face.font(size)) }
        return out.foregroundColor(T.fg)
    }
}

/// Chips that wrap onto as many lines as they need, centred.
private struct Flow: Layout {
    var spacing: CGFloat = 8
    private func rows(_ w: CGFloat, _ subs: Subviews) -> [[(Int, CGSize)]] {
        var out: [[(Int, CGSize)]] = [[]], x: CGFloat = 0
        for (i, s) in subs.enumerated() { let z = s.sizeThatFits(.unspecified); if x + z.width > w, !out[out.count - 1].isEmpty { out.append([]); x = 0 }; out[out.count - 1].append((i, z)); x += z.width + spacing }
        return out
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w: CGFloat = proposal.width ?? 320
        let r = rows(w, subviews)
        var total: CGFloat = 0
        for row in r { var h: CGFloat = 0; for it in row { h = max(h, it.1.height) }; total += h }
        total += spacing * CGFloat(max(0, r.count - 1))
        return CGSize(width: w, height: total)
    }
    func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = b.minY
        for row in rows(b.width, subviews) {
            var rw: CGFloat = spacing * CGFloat(max(0, row.count - 1)), h: CGFloat = 0
            for it in row { rw += it.1.width; h = max(h, it.1.height) }
            var x: CGFloat = b.minX + (b.width - rw) / 2
            for (i, z) in row { subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(z)); x += z.width + spacing }
            y += h + spacing
        }
    }
}

/// Morning, Noon and Evening Prayer reminders: a notification when each office is ready to pray (sent by the server).
struct DevotionReminders: View {
    weak var feed: FeedModel?
    @State private var on = [false, false, false]
    @State private var at = [Date(), Date(), Date()]
    @State private var loaded = false
    private let keys = ["morning", "noon", "evening"], names = ["Morning Prayer", "Noonday Prayer", "Evening Prayer"], defaults = ["07:00", "12:00", "19:00"]
    private func time(_ s: String) -> Date { let p = s.split(separator: ":").compactMap { Int($0) }; return Calendar.current.date(bySettingHour: p.first ?? 7, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date() }
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 0) {
                Text("Devotion reminders").font(.serif(18, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 20).padding(.bottom, 8)
                VStack(spacing: 0) {
                    ForEach(0..<3, id: \.self) { i in
                        Toggle(isOn: Binding(get: { on[i] }, set: { on[i] = $0; save() })) { Text(names[i]).font(.sans(15, .semibold)).foregroundStyle(T.ink) }.tint(T.green).padding(.horizontal, 16).padding(.vertical, 10)
                        if on[i] { DatePicker("Time", selection: Binding(get: { at[i] }, set: { at[i] = $0; save() }), displayedComponents: .hourAndMinute).font(.sans(15)).foregroundStyle(T.ink).padding(.horizontal, 16).padding(.bottom, 8) }
                        if i < 2 { T.groupLine.frame(height: 1) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(T.group)).padding(.horizontal, 16)
                Text("A notification on the lock screen when each office is ready to pray.").font(.sans(13)).foregroundStyle(T.muted).padding(.horizontal, 20).padding(.top, 10)
            }
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .task {
            guard let a = await feed?.auth() else { return }
            if let r = try? await Supa(a: a).rows("/rest/v1/devotion_reminders?user_id=eq.\(a.me)&select=morning,noon,evening,morning_at,noon_at,evening_at").first {
                for i in 0..<3 { on[i] = r[keys[i]] as? Bool ?? false; at[i] = time(String((r[keys[i] + "_at"] as? String ?? defaults[i]).prefix(5))) }
            } else { for i in 0..<3 { at[i] = time(defaults[i]) } }
            loaded = true
        }
    }
    private func save() {
        guard loaded else { return }
        Haptic.tap()
        var row: [String: Any] = ["tz": TimeZone.current.identifier, "updated_at": ISO8601DateFormatter().string(from: Date())]
        for i in 0..<3 { let c = Calendar.current.dateComponents([.hour, .minute], from: at[i]); row[keys[i]] = on[i]; row[keys[i] + "_at"] = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0) }
        Task { guard let a = await feed?.auth() else { return }; row["user_id"] = a.me; _ = try? await Supa(a: a).req("POST", "/rest/v1/devotion_reminders?on_conflict=user_id", json: row, prefer: "resolution=merge-duplicates,return=minimal") }
    }
}
