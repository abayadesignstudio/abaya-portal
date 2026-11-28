import SwiftUI
import ImageIO
import UniformTypeIdentifiers
import QuickLook

// The app's own look, carried over from its stylesheet: EB Garamond and Inter, the olive palette, the cards, pills,
// groups, toggles and page bars. Native screens are drawn from these so they look like the rest of the app.

extension Font {
    /// EB Garamond (the app's serif).
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        let heavy = weight == .semibold || weight == .bold || weight == .heavy || weight == .black
        if italic { return .custom(heavy ? "EBGaramond-SemiBoldItalic" : "EBGaramond-Italic", fixedSize: size) }
        switch weight {
        case .medium: return .custom("EBGaramond-Medium", fixedSize: size)
        case .semibold: return .custom("EBGaramond-SemiBold", fixedSize: size)
        case .bold, .heavy, .black: return .custom("EBGaramond-Bold", fixedSize: size)
        default: return .custom("EBGaramond-Regular", fixedSize: size)
        }
    }
    /// Inter (the app's sans).
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .medium: return .custom("Inter-Medium", fixedSize: size)
        case .semibold: return .custom("Inter-SemiBold", fixedSize: size)
        case .bold, .heavy, .black: return .custom("Inter-Bold", fixedSize: size)
        default: return .custom("Inter-Regular", fixedSize: size)
        }
    }
}

extension Color {
    init(rgb: UInt32, _ a: Double = 1) { self.init(.sRGB, red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255, opacity: a) }
}

/// The palette (the stylesheet's :root).
enum T {
    static let paper = Color(rgb: 0x3b3e2a), card = Color(rgb: 0x414530), ink = Color(rgb: 0xf1eedd), muted = Color(rgb: 0xc3c3a6)
    static let rule = Color(rgb: 0x4d4f37), tan = Color(rgb: 0x2d301f), cream = Color(rgb: 0xf4f1e2), soft = Color(rgb: 0x434530), softBd = Color(rgb: 0x50533a)
    static let like = Color(rgb: 0xc9566d), maroon = Color(rgb: 0x6a2231), green = Color(rgb: 0x2f6b45), danger = Color(rgb: 0xe7907f), sub = Color(rgb: 0xcdcbb4), chev = Color(rgb: 0xb9b696)
    static let group = Color(rgb: 0x444530), groupLine = Color(rgb: 0x4a4c35), border = Color(rgb: 0x54563c), av = Color(rgb: 0x5a5d40), avInk = Color(rgb: 0xdad8c7)
    static let ticker = Color(rgb: 0xd0ceb9)
    /// Feed and post pages are drawn one step larger (the stylesheet's .readscale zoom).
    static let z: CGFloat = 1.07
}

/// .av — a member's round photo, or their initials.
struct Face: View {
    let name: String, url: URL?
    var s: CGFloat = 44
    var body: some View {
        ZStack {
            Circle().fill(T.av)
            Text(name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased())
                .font(.sans(s * 0.36, .semibold)).foregroundStyle(T.avInk)
            if let url { NetImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
        }
        .frame(width: s, height: s).clipShape(Circle())
    }
}
extension Face { init(_ p: Person?, s: CGFloat = 44) { self.init(name: p?.name ?? "", url: p?.avatar, s: s) } }

/// .pill — the soft rounded buttons under each post (reply, heart, save, share).
struct PillStyle: ButtonStyle {
    var liked = false, big = false
    func makeBody(configuration c: Configuration) -> some View {
        c.label
            .font(.sans(14, .semibold))
            .foregroundStyle(liked ? Color(rgb: 0xf3dfe2) : T.ink)
            .frame(maxWidth: .infinity).frame(height: big ? 46 : 40)
            .background(Capsule().fill(liked ? T.maroon : T.soft))
            .overlay(Capsule().stroke(liked ? Color(rgb: 0x93384b) : T.softBd, lineWidth: 1))
            .overlay(Capsule().inset(by: 1).trim(from: 0.55, to: 0.95).stroke(.white.opacity(0.16), lineWidth: 1).rotationEffect(.degrees(0)).opacity(0))
            .shadow(color: Color(rgb: 0x0c0e08, 0.08), radius: 2, y: 2)
            .scaleEffect(c.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.1), value: c.isPressed)
    }
}

/// Buttons that shrink a little under the finger, as everything tappable does in the app.
struct Press: ButtonStyle {
    var scale: CGFloat = 0.96
    func makeBody(configuration c: Configuration) -> some View { c.label.scaleEffect(c.isPressed ? scale : 1).animation(.easeOut(duration: 0.1), value: c.isPressed) }
}

/// .page .bar — Back on the left, the title in the middle, an optional control on the right.
struct PageBar<Right: View>: View {
    let title: String
    var back = "Back"
    let onBack: () -> Void
    @ViewBuilder var right: () -> Right
    var body: some View {
        // The title sits in the true centre of the bar, whatever is on either side.
        ZStack {
            Text(title).font(.sans(16, .semibold)).foregroundStyle(T.ink).lineLimit(1).padding(.horizontal, 96)
            HStack(spacing: 4) {
                Button(action: onBack) {
                    HStack(spacing: 2) { GlyphView(n: "back", s: 24); Text(back).font(.sans(16)) }.foregroundStyle(T.ink).padding(.vertical, 8).padding(.trailing, 10).contentShape(Rectangle())
                }
                Spacer(minLength: 0)
                right()
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color(rgb: 0x3a3d2b, 0.96))
        .overlay(alignment: .bottom) { T.rule.frame(height: 1) }
    }
}
extension PageBar where Right == EmptyView {
    init(title: String, back: String = "Back", onBack: @escaping () -> Void) { self.init(title: title, back: back, onBack: onBack, right: { EmptyView() }) }
}

/// .group — the rounded lists in Settings and the sheets.
struct Card14<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: 14).fill(T.group))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 14)
    }
}
struct GroupLine: View { var body: some View { T.groupLine.frame(height: 1) } }

/// A row in a .group: icon, label, and whatever sits on the right.
struct GroupRow<Right: View>: View {
    var icon: String? = nil
    let label: String
    var danger = false
    let action: () -> Void
    @ViewBuilder var right: () -> Right
    var body: some View {
        Button(action: { Haptic.tap(); action() }) {
            HStack(spacing: 14) {
                if let icon { GlyphView(n: icon, s: 22) }
                Text(label).font(.sans(15)).frame(maxWidth: .infinity, alignment: .leading)
                right()
            }
            .foregroundStyle(danger ? T.danger : T.ink)
            .padding(.horizontal, 16).frame(minHeight: 50).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
struct Chevron: View { var body: some View { Text("›").font(.sans(17)).foregroundStyle(T.chev) } }
struct CountText: View { let n: Int; var body: some View { Text("\(n)").font(.sans(14)).foregroundStyle(T.muted) } }
struct LikeBadge: View {
    let n: Int
    var body: some View {
        if n > 0 { Text("\(n)").font(.sans(11, .bold)).foregroundStyle(.white).padding(.horizontal, 6).frame(minWidth: 20, minHeight: 20).background(Capsule().fill(T.like)) }
    }
}

/// The app's switch: green when on, olive when off.
struct Switch: View {
    let on: Bool
    var body: some View {
        ZStack(alignment: on ? .trailing : .leading) {
            Capsule().fill(on ? Color(rgb: 0x34c759) : Color(rgb: 0x4d5038)).frame(width: 50, height: 30)
            Circle().fill(.white).frame(width: 26, height: 26).shadow(color: .black.opacity(0.25), radius: 2, y: 1).padding(2)
        }
        .animation(.easeOut(duration: 0.2), value: on)
    }
}

/// .eyebrow
struct Eyebrow: View {
    let t: String
    var body: some View { Text(t.uppercased()).font(.sans(11, .bold)).tracking(0.88).foregroundStyle(T.muted) }
}

/// .seg — the small segmented control.
struct Seg: View {
    let options: [String]
    @Binding var value: String
    @Namespace private var ns
    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { o in
                Button { Haptic.tap(); withAnimation(.snappy(duration: 0.26)) { value = o } } label: {
                    Text(o).font(.sans(13, value == o ? .semibold : .regular)).foregroundStyle(T.ink).frame(maxWidth: .infinity).frame(height: 30)
                        .background { if value == o { RoundedRectangle(cornerRadius: 7).fill(T.card).shadow(color: .black.opacity(0.12), radius: 1.5, y: 1).matchedGeometryEffect(id: "on", in: ns) } }
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
        .padding(2).background(RoundedRectangle(cornerRadius: 9).fill(Color(rgb: 0x0c0e08, 0.08)))
    }
}

/// The app's sheets: the card colour, rounded top, and a small grab bar.
struct SheetBody<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Capsule().fill(T.border).frame(width: 38, height: 5).frame(maxWidth: .infinity).padding(.top, 8).padding(.bottom, 10)
                content()
            }
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(T.card.ignoresSafeArea())
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(22)
        .presentationBackground(T.card)
        .preferredColorScheme(.dark)
    }
}

/// Writing laid out as the web app's .body: paragraphs (separated by a blank line) with a small gap between them, line
/// breaks kept, web addresses tappable.
/// A post's writing, paragraph by paragraph. A quoted passage (marked when the post is loaded) keeps its line down the left.
struct Paras: View { let text: String; var size: CGFloat = 18; var leading: CGFloat = 1.4; var gap: CGFloat = 6; var weight: Font.Weight = .regular
    var body: some View {
        let ps = text.replacingOccurrences(of: "\r", with: "").split(separator: #/\n[ \t]*\n+/#).map { String($0).trimmingCharacters(in: .newlines) }.filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: gap) { ForEach(Array(ps.enumerated()), id: \.offset) { _, p in
            let quote = p.hasPrefix(quoteMark)
            Text(linked(quote ? String(p.dropFirst()) : p)).font(quote ? .serif(size, italic: true) : .serif(size, weight)).foregroundStyle(T.ink).lineSpacing(max(0, size * leading - size * 1.305))
                .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, quote ? 12 : 0)
                .overlay(alignment: .leading) { if quote { T.ink.frame(width: 3) } }
                .padding(.vertical, quote ? 2 : 0)
        } } }
}
let quoteMark = "\u{E000}"
/// The post's text with its quoted passages marked, read from the formatted copy (where a quote is a <blockquote>).
func quoteMarked(_ body: String, _ html: String?) -> String {
    guard let html, html.contains("<blockquote") else { return body }
    func paras(_ h: String, _ q: Bool) -> [String] {
        var t = h.replacingOccurrences(of: #"</p>|</div>|</h[1-6]>|</li>"#, with: "\n\n", options: .regularExpression)
            .replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        for (a, b) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] { t = t.replacingOccurrences(of: a, with: b) }
        return t.components(separatedBy: "\n\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.map { q ? quoteMark + $0 : $0 }
    }
    var out: [String] = []
    for (i, part) in html.components(separatedBy: "<blockquote").enumerated() {
        if i == 0 { out += paras(part, false); continue }
        let seg = part.components(separatedBy: "</blockquote>")
        let inner = seg[0].firstIndex(of: ">").map { String(seg[0][seg[0].index(after: $0)...]) } ?? seg[0]
        out += paras(inner, true)
        if seg.count > 1 { out += paras(seg.dropFirst().joined(), false) }
    }
    return out.isEmpty ? body : out.joined(separator: "\n\n")
}


// MARK: - Writing that keeps the cursor in view

/// A text field that grows with what is written and, as in Notes, keeps the line being typed in view: when the cursor
/// moves under the keyboard or off the top, the page scrolls to it. The keyboard has a button to put it away, and a
/// drag down the page takes it along.
/// Hand every text field's latest words to its page now (before posting, saving or leaving).
@MainActor func flushTyping() { NotificationCenter.default.post(name: .lotmFlushTyping, object: nil) }
/// Start or end a list on the line being written, in whichever writing box has the keyboard: "bullet" or "number".
@MainActor func listTool(_ kind: String) { NotificationCenter.default.post(name: .lotmList, object: kind) }
/// Make the paragraph being written a quoted passage, or plain again, in whichever writing box has the keyboard.
/// A quoted paragraph is kept in the words themselves as a line that begins "> ", and is shown set apart (italic, a
/// rule down its left) wherever the note is read. It is a way of setting a paragraph, not a kind of note.
@MainActor func quoteTool() { NotificationCenter.default.post(name: .lotmQuote, object: nil) }
/// A note's words with its quoted paragraphs (lines that begin ">") marked for `Paras`.
func quoteLines(_ s: String) -> String {
    guard s.hasPrefix(">") || s.contains("\n>") else { return s }
    var out: [String] = [], quote: [String] = [], plain: [String] = []
    func close() {
        if !quote.isEmpty { out.append(quoteMark + quote.joined(separator: "\n")); quote = [] }
        if !plain.isEmpty { out.append(plain.joined(separator: "\n")); plain = [] }
    }
    for line in s.components(separatedBy: "\n") {
        if line.hasPrefix(">") { if !plain.isEmpty { close() }; quote.append(String(line.dropFirst()).trimmingCharacters(in: .whitespaces)) }
        else if line.trimmingCharacters(in: .whitespaces).isEmpty { close() }
        else { if !quote.isEmpty { close() }; plain.append(line) }
    }
    close()
    return out.joined(separator: "\n\n")
}
/// Type something at the cursor of whichever writing box has the keyboard (the # tool).
@MainActor func insertTool(_ s: String) { NotificationCenter.default.post(name: .lotmInsert, object: s) }
/// The topics written into a text as #words, as on X: lowercased, without the #, each once.
func hashtags(_ s: String) -> [String] {
    guard s.contains("#"), let re = try? NSRegularExpression(pattern: #"(?<![\p{L}\d_#])#([\p{L}\d_-]{2,40})"#) else { return [] }
    var out: [String] = []
    for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) { if let r = Range(m.range(at: 1), in: s) { let t = s[r].lowercased(); if !out.contains(t) { out.append(t) } } }
    return out
}
extension Notification.Name { static let lotmFlushTyping = Notification.Name("lotm.flushTyping"); static let lotmQuote = Notification.Name("lotm.quote"); static let lotmList = Notification.Name("lotm.list"); static let lotmInsert = Notification.Name("lotm.insert"); static let lotmMention = Notification.Name("lotm.mention"); static let lotmTypedAtEnd = Notification.Name("lotm.typedAtEnd") }
/// Whether one of the app's writing fields has the keyboard (so a tool acts through the field, at its cursor).
enum WriteFocus { static var on = false }



/// Chips (or anything) that wrap onto as many lines as they need.
struct Wrap: Layout {
    var spacing: CGFloat = 6
    var centered = false
    private func rows(_ w: CGFloat, _ subs: Subviews) -> [[(Int, CGSize)]] {
        var out: [[(Int, CGSize)]] = [[]], x: CGFloat = 0
        for (i, s) in subs.enumerated() {
            let z = s.sizeThatFits(ProposedViewSize(width: w, height: nil))
            if x + z.width > w, !out[out.count - 1].isEmpty { out.append([]); x = 0 }
            out[out.count - 1].append((i, z)); x += z.width + spacing
        }
        return out
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w: CGFloat = proposal.width ?? 320
        let r = rows(w, subviews)
        var total: CGFloat = spacing * CGFloat(max(0, r.count - 1))
        for row in r { var h: CGFloat = 0; for it in row { h = max(h, it.1.height) }; total += h }
        return CGSize(width: w, height: total)
    }
    func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = b.minY
        for row in rows(b.width, subviews) {
            var rw: CGFloat = spacing * CGFloat(max(0, row.count - 1)), h: CGFloat = 0
            for it in row { rw += it.1.width; h = max(h, it.1.height) }
            var x: CGFloat = centered ? b.minX + (b.width - rw) / 2 : b.minX
            for (i, z) in row { subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(z)); x += z.width + spacing }
            y += h + spacing
        }
    }
}

/// Watches the scroll view it sits in for a pull past either end (put it in the scrolling content's background).
struct PullWatch: UIViewRepresentable {
    var distance: CGFloat = 90
    var top: () -> Void = {}
    var bottom: () -> Void = {}
    func makeUIView(context: Context) -> Probe { let v = Probe(); v.set(distance, top, bottom); return v }
    func updateUIView(_ v: Probe, context: Context) { v.set(distance, top, bottom) }
    final class Probe: UIView {
        private var distance: CGFloat = 90, top: () -> Void = {}, bottom: () -> Void = {}
        private var watch: NSKeyValueObservation?
        private var fired = false
        func set(_ d: CGFloat, _ t: @escaping () -> Void, _ b: @escaping () -> Void) { distance = d; top = t; bottom = b }
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false; backgroundColor = .clear }
        required init?(coder: NSCoder) { fatalError() }
        override func didMoveToWindow() {
            super.didMoveToWindow(); watch = nil
            guard window != nil else { return }
            var s: UIView? = superview
            while let x = s, !(x is UIScrollView) { s = x.superview }
            guard let scroll = s as? UIScrollView else { return }
            scroll.alwaysBounceVertical = true
            watch = scroll.observe(\.contentOffset) { [weak self] sc, _ in
                guard let self else { return }
                let over = -(sc.contentOffset.y + sc.adjustedContentInset.top)
                let under = sc.contentOffset.y + sc.bounds.height - sc.adjustedContentInset.bottom - max(sc.contentSize.height, sc.bounds.height - sc.adjustedContentInset.top - sc.adjustedContentInset.bottom)
                if !sc.isTracking && over < 4 && under < 4 { self.fired = false }
                guard sc.isTracking, !self.fired else { return }
                if over > self.distance { self.fired = true; DispatchQueue.main.async { self.top() } }
                else if under > self.distance { self.fired = true; DispatchQueue.main.async { self.bottom() } }
            }
        }
    }
}


// MARK: - Tagging a member with @

/// The members' names, for @ tags (kept from the last time the feed loaded).
enum Roster {
    static var names: [String] = (UserDefaults.standard.dictionary(forKey: "lotm.people") as? [String: [String: String]])?.values.compactMap { $0["name"] }.filter { !$0.isEmpty } ?? []
    /// name → member id, so a tagged name can open that member's profile
    static var ids: [String: String] = Dictionary(((UserDefaults.standard.dictionary(forKey: "lotm.people") as? [String: [String: String]]) ?? [:]).compactMap { k, v in v["name"].flatMap { $0.isEmpty ? nil : ($0, k) } }, uniquingKeysWith: { a, _ in a })
    static weak var web: WebModel?
}
/// What has been typed after an @ at the end of the writing ("" just after the @), or nil when no tag is being typed.
func mentionQuery(_ s: String) -> String? {
    guard let at = s.lastIndex(of: "@") else { return nil }
    if at > s.startIndex, let b = s[s.index(before: at)].unicodeScalars.first, !CharacterSet.whitespacesAndNewlines.contains(b) { return nil }
    let q = String(s[s.index(after: at)...])
    if q.count > 30 || q.contains("\n") || q.hasSuffix("  ") || q.split(separator: " ", omittingEmptySubsequences: false).count > 3 { return nil }
    return q
}
/// The members whose names match what is being typed after an @: tap one to write the name in.
struct MentionBar: View {
    @Binding var text: String
    var body: some View {
        let q = mentionQuery(text), low = (q ?? "").lowercased()
        let hits = q == nil ? [] : Roster.names.filter { n in let l = n.lowercased(); return low.isEmpty || l.hasPrefix(low) || l.split(separator: " ").contains { $0.hasPrefix(low) } }.filter { $0.lowercased() != low.trimmingCharacters(in: .whitespaces) }.sorted()
        if !hits.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(hits.prefix(14), id: \.self) { n in
                        Button {
                            if WriteFocus.on { NotificationCenter.default.post(name: .lotmMention, object: n); Haptic.tap(); return }
                            flushTyping(); let t = text
                            if let cur = mentionQuery(t) { text = String(t.dropLast(cur.count)) + n + " "; Haptic.tap() }
                        } label: { Text("@" + n).font(.sans(14, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(T.ink.opacity(0.1))) }
                        .buttonStyle(.plain)
                    }
                }.padding(.horizontal, 12)
            }
            .frame(height: 40)
        }
    }
}


// MARK: - The writing field (Apple's own SwiftUI text field)

/// The list mark a line begins with ("• " or "12. "): its length, and its number if it is a numbered one.
func listMark(_ line: Substring) -> (len: Int, n: Int?)? {
    if line.hasPrefix("• ") { return (2, nil) }
    let digits = line.prefix { $0.isNumber }
    if !digits.isEmpty, digits.count < 4, line.dropFirst(digits.count).hasPrefix(". "), let n = Int(digits) { return (digits.count + 2, n) }
    return nil
}

/// Every place words are written. It is Apple's standard text field, so the keyboard, the cursor, selection and
/// scrolling are the system's own; this view only sets the face (EB Garamond, as the words will be published), keeps
/// the typing in its own small state (so a keystroke redraws nothing else, and typing stays quick), and answers the
/// list, # and @ tools.
struct WriteField: View {
    @Binding var text: String
    var hint = ""
    var size: CGFloat = 20
    var italic = false
    var color: Color = T.ink
    var minHeight: CGFloat = 0
    /// Bump to bring the keyboard here.
    var focus = 0
    /// When set, the field takes the keyboard as this turns true and gives it up as it turns false.
    var active: Bool? = nil
    var onFocus: (Bool) -> Void = { _ in }

    @State private var local = ""
    @State private var sel: TextSelection?
    @State private var push: DispatchWorkItem?
    @State private var justDeleted = false
    @FocusState private var on: Bool

    var body: some View {
        TextField("", text: $local, selection: $sel, prompt: Text(hint).foregroundColor(T.muted), axis: .vertical)
            .font(.serif(size, italic: italic)).foregroundStyle(color).tint(T.ink).lineSpacing(size * 0.16)
            .textInputAutocapitalization(.sentences)
            .focused($on)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .contentShape(Rectangle()).onTapGesture { on = true }
            .onAppear { local = text; if active == true { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { on = true } } }
            .onChange(of: text) { _, v in if v != local { local = v; sel = TextSelection(insertionPoint: v.endIndex) } }
            .onChange(of: local) { old, new in if capitalLine(old, new) { return }; carryList(old, new); later(); if on, new.count >= old.count, caret == local.endIndex { NotificationCenter.default.post(name: .lotmTypedAtEnd, object: nil) } }
            .onChange(of: on) { _, v in WriteFocus.on = v; onFocus(v); if !v { flush() } }
            .onReceive(NotificationCenter.default.publisher(for: .lotmMention)) { n in if on, let s = n.object as? String { mention(s) } }
            .onChange(of: active) { _, v in if let v, v != on { on = v } }
            .onChange(of: focus) { _, _ in on = true }
            .onReceive(NotificationCenter.default.publisher(for: .lotmFlushTyping)) { _ in flush() }
            .onReceive(NotificationCenter.default.publisher(for: .lotmList)) { n in if on { list(n.object as? String ?? "bullet") } }
            .onReceive(NotificationCenter.default.publisher(for: .lotmInsert)) { n in if on, let s = n.object as? String { put(s) } }
            .onReceive(NotificationCenter.default.publisher(for: .lotmQuote)) { _ in if on { quote() } }
    }
    /// What has been typed reaches the rest of the screen when the typing pauses (or at once, before a save).
    private func later() {
        push?.cancel()
        let w = DispatchWorkItem { if text != local { text = local } }
        push = w; DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: w)
    }
    private func flush() { push?.cancel(); if text != local { text = local } }
    /// Where the cursor is (the end, if the system has not said).
    private var caret: String.Index {
        if let s = sel, case let .selection(r) = s.indices, r.lowerBound <= local.endIndex { return r.lowerBound }
        return local.endIndex
    }
    private func lineStart(_ i: String.Index) -> String.Index { local[..<i].lastIndex(of: "\n").map { local.index(after: $0) } ?? local.startIndex }
    /// A member chosen from the @ list: the name replaces what was typed after the @.
    private func mention(_ name: String) {
        let i = caret
        guard let at = local[..<i].lastIndex(of: "@") else { return }
        local.replaceSubrange(at..<i, with: "@" + name + " ")
        sel = TextSelection(insertionPoint: local.index(at, offsetBy: name.count + 2)); flush()
    }
    private func put(_ s: String) {
        let i = caret; local.insert(contentsOf: s, at: i)
        sel = TextSelection(insertionPoint: local.index(i, offsetBy: s.count))
    }
    /// The quote tool: the cursor's paragraph becomes a quoted passage ("> " before it), or plain again.
    private func quote() {
        let a = lineStart(caret)
        if local[a...].hasPrefix("> ") { local.removeSubrange(a..<local.index(a, offsetBy: 2)) }
        else if local[a...].hasPrefix(">") { local.remove(at: a) }
        else { local.insert(contentsOf: "> ", at: a) }
        let end = local[a...].firstIndex(of: "\n") ?? local.endIndex
        sel = TextSelection(insertionPoint: end); Haptic.tap(); later()
    }
    /// The list tools: make the cursor's line an item of that kind, change its kind, or (the same kind again) plain.
    private func list(_ kind: String) {
        let a = lineStart(caret), had = listMark(local[a...])
        var want = ""
        if !(had != nil && (had!.n != nil) == (kind == "number")) {
            if kind == "number" {
                var n = 1
                if a > local.startIndex { let p = lineStart(local.index(before: a)); if let m = listMark(local[p...]), let k = m.n { n = k + 1 } }
                want = "\(n). "
            } else { want = "• " }
        }
        let b = local.index(a, offsetBy: had?.len ?? 0)
        local.replaceSubrange(a..<b, with: want)
        let end = local[a...].firstIndex(of: "\n") ?? local.endIndex
        sel = TextSelection(insertionPoint: end); Haptic.tap()
    }
    /// Return inside a list begins the next item; Return on an empty item ends the list.
    /// A new line, bullet or numbered item begins with a capital: the first letter typed on an empty line (or an
    /// empty list item) is raised. Delete it and type again to have it small.
    private func capitalLine(_ old: String, _ new: String) -> Bool {
        if new.count < old.count { justDeleted = true; return false }
        defer { justDeleted = false }
        guard new.count == old.count + 1, !justDeleted else { return false }
        var p = new.startIndex, q = old.startIndex                    // where the one new character went in
        while q < old.endIndex, new[p] == old[q] { p = new.index(after: p); q = old.index(after: q) }
        guard p < new.endIndex, new[p].isLetter, new[p].isLowercase else { return false }
        let a = new[..<p].lastIndex(of: "\n").map { new.index(after: $0) } ?? new.startIndex
        guard a != new.startIndex else { return false }               // the very first line is the keyboard's own business
        let mark = listMark(new[a...])?.len ?? 0
        guard new.distance(from: a, to: p) == mark else { return false }   // the letter opens the line's words
        let next = new.index(after: p)
        guard next == new.endIndex || new[next] == "\n" else { return false }   // and the line had no words yet
        let up = String(new[p]).uppercased(); guard up.count == 1 else { return false }
        var t = new; t.replaceSubrange(p...p, with: up)
        local = t; sel = TextSelection(insertionPoint: t.index(after: p)); later()
        return true
    }
    private func carryList(_ old: String, _ new: String) {
        guard new.count == old.count + 1 else { return }
        var p = new.startIndex, q = old.startIndex                    // where the one new character went in
        while q < old.endIndex, new[p] == old[q] { p = new.index(after: p); q = old.index(after: q) }
        guard p < new.endIndex, new[p] == "\n" else { return }
        let a = new[..<p].lastIndex(of: "\n").map { new.index(after: $0) } ?? new.startIndex
        guard let m = listMark(new[a..<p]) else { return }
        var t = new
        if new.distance(from: a, to: p) == m.len {
            t.removeSubrange(a...p)                                   // an empty item: the list ends here
            local = t; sel = TextSelection(insertionPoint: min(a, t.endIndex))
        } else {
            let mark = m.n.map { "\($0 + 1). " } ?? "• ", at = t.index(after: p)
            t.insert(contentsOf: mark, at: at)
            local = t; sel = TextSelection(insertionPoint: t.index(at, offsetBy: mark.count))
        }
    }
}


// MARK: - Saving a shared picture

extension View {
    /// Hold a picture that someone has posted to save it, copy it or pass it on.
    func imageMenu(_ url: URL?) -> some View {
        contextMenu {
            if let url {
                Button { Task { await savePicture(url) } } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
                Button { Task { if let d = try? await URLSession.shared.data(from: url).0, let i = UIImage(data: d) { UIPasteboard.general.image = i } } } label: { Label("Copy", systemImage: "doc.on.doc") }
                ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
            }
        }
    }
    func imageMenu(image: UIImage) -> some View {
        contextMenu {
            Button { UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil); Haptic.tap() } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
            Button { UIPasteboard.general.image = image } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
    }
}
func savePicture(_ url: URL) async {
    guard let d = try? await URLSession.shared.data(from: url).0, let img = UIImage(data: d) else { return }
    await MainActor.run { UIImageWriteToSavedPhotosAlbum(img, nil, nil, nil); Haptic.tap() }
}

// MARK: - Polls

/// When a poll closes: a day, three days, a week, or a moment of the writer's choosing.
struct PollEndPicker: View {
    @Binding var days: Int; @Binding var custom: Date?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Poll ends").font(.sans(13, .semibold)).foregroundStyle(T.muted)
            HStack(spacing: 6) {
                ForEach([(1, "1 day"), (3, "3 days"), (7, "1 week")], id: \.0) { d, t in chip(t, custom == nil && days == d) { custom = nil; days = d } }
                chip("Custom", custom != nil) { if custom == nil { custom = Date().addingTimeInterval(Double(days) * 86400) } }
            }
            if custom != nil {
                DatePicker("Ends", selection: Binding(get: { custom ?? Date() }, set: { custom = $0 }), in: Date().addingTimeInterval(600)...Date().addingTimeInterval(90 * 86400))
                    .font(.sans(15)).foregroundStyle(T.ink).tint(T.ink)
            }
        }
    }
    private func chip(_ t: String, _ on: Bool, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Text(t).font(.sans(14, on ? .semibold : .regular)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 34)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? T.maroon : Color.clear)).overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? T.ink : T.rule))
        }.buttonStyle(.plain)
    }
}
func pollEndsText(_ d: Date) -> String {
    d < Date() ? "Final results" : "Ends " + d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
}

// MARK: - Files attached to a study or an event

struct EventFile: Identifiable, Equatable { let id: String, name: String, path: String }

/// The files an administrator has attached to a study or an event. Members open them here; administrators add and remove them.
struct EventFiles: View {
    let type: String, id: String
    let auth: () async -> SupaAuth?
    @State private var files: [EventFile] = []
    @State private var admin = false
    @State private var picking = false
    @State private var busy = false
    @State private var opening: String?
    @State private var preview: URL?
    @State private var problem: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !files.isEmpty || admin { Text("FILES").font(.sans(11.5, .bold)).tracking(1.1).foregroundStyle(T.muted) }
            ForEach(files) { f in
                Button { Task { await open(f) } } label: {
                    HStack(spacing: 10) {
                        if opening == f.id { ProgressView().tint(T.ink).frame(width: 22) } else { Image(systemName: "doc.text").font(.system(size: 18)).foregroundStyle(T.ink).frame(width: 22) }
                        Text(f.name).font(.sans(15, .semibold)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).frame(minHeight: 46).background(RoundedRectangle(cornerRadius: 12).fill(T.paper)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.rule)).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu { if admin { Button("Remove file", role: .destructive) { Task { await remove(f) } } } }
            }
            if admin {
                Button { picking = true } label: {
                    HStack(spacing: 8) { if busy { ProgressView().tint(T.ink) } else { Image(systemName: "paperclip") }; Text(busy ? "Uploading…" : "Attach a file") }.font(.sans(14, .semibold)).foregroundStyle(T.ink)
                }.buttonStyle(.plain).disabled(busy).padding(.top, 2)
            }
            if let problem { Text(problem).font(.sans(13)).foregroundStyle(T.like) }
        }
        .task(id: id) { await load() }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            if case .success(let urls) = r { Task { await add(urls) } }
        }
        .quickLookPreview($preview)
    }
    private func load() async {
        guard let a = await auth() else { return }
        let db = Supa(a: a)
        let rows = (try? await db.rows("/rest/v1/event_files?target_type=eq.\(type)&target_id=eq.\(id)&select=id,name,path&order=created_at")) ?? []
        files = rows.map { EventFile(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "File", path: $0["path"] as? String ?? "") }
        if let d = try? await db.req("POST", "/rest/v1/rpc/is_administrator", json: [String: Any]()) { admin = String(data: d, encoding: .utf8)?.contains("true") ?? false }
    }
    private func open(_ f: EventFile) async {
        guard opening == nil, let a = await auth() else { return }
        opening = f.id; defer { opening = nil }
        let enc = f.path.split(separator: "/").map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
        guard let d = try? await Supa(a: a).req("GET", "/storage/v1/object/authenticated/event-files/\(enc)") else { problem = "Couldn’t open that file. Check your connection and try again."; return }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("event-" + f.id, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let u = dir.appendingPathComponent(f.name)
        do { try d.write(to: u); problem = nil; preview = u } catch { problem = "Couldn’t open that file." }
    }
    private func add(_ urls: [URL]) async {
        guard let a = await auth() else { return }
        busy = true; problem = nil; defer { busy = false }
        let db = Supa(a: a)
        for u in urls {
            let ok = u.startAccessingSecurityScopedResource(); defer { if ok { u.stopAccessingSecurityScopedResource() } }
            guard let d = try? Data(contentsOf: u) else { problem = "Couldn’t read \(u.lastPathComponent)."; continue }
            if d.count > 50 * 1024 * 1024 { problem = "\(u.lastPathComponent) is over 50 MB."; continue }
            let ext = u.pathExtension.isEmpty ? "" : "." + u.pathExtension.lowercased()
            let path = "\(type)/\(id.lowercased())/\(UUID().uuidString.lowercased())\(ext)"
            let mime = UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            do {
                try await db.req("POST", "/storage/v1/object/event-files/\(path)", raw: d, type: mime, prefer: nil)
                try await db.req("POST", "/rest/v1/event_files", json: ["target_type": type, "target_id": id, "name": u.lastPathComponent, "path": path, "size_bytes": d.count, "created_by": a.me])
            } catch { problem = "Couldn’t upload \(u.lastPathComponent): \(error.localizedDescription)" }
        }
        await load()
    }
    private func remove(_ f: EventFile) async {
        guard let a = await auth() else { return }
        let db = Supa(a: a)
        _ = try? await db.req("DELETE", "/rest/v1/event_files?id=eq.\(f.id)")
        _ = try? await db.req("DELETE", "/storage/v1/object/event-files/\(f.path)")
        await load()
    }
}


// MARK: - Pictures from the network, remembered

/// Pictures already shown are kept decoded in memory, so a row scrolling back into view shows its picture at once
/// instead of flashing its placeholder and loading again.
enum Pictures {
    static let cache: NSCache<NSURL, UIImage> = { let c = NSCache<NSURL, UIImage>(); c.countLimit = 400; c.totalCostLimit = 160 << 20; return c }()
    private static var loading: [URL: Task<UIImage?, Never>] = [:]
    static func have(_ url: URL) -> UIImage? { cache.object(forKey: url as NSURL) }
    @MainActor static func load(_ url: URL) async -> UIImage? {
        if let i = have(url) { return i }
        if let t = loading[url] { return await t.value }
        let t = Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let (d, _) = try? await URLSession.shared.data(from: url) else { return nil }
            // decoded off the main thread, no larger than a screen needs
            let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true, kCGImageSourceThumbnailMaxPixelSize: 1800]
            if let src = CGImageSourceCreateWithData(d as CFData, nil), let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) { return UIImage(cgImage: cg) }
            return UIImage(data: d)
        }
        loading[url] = t
        let img = await t.value
        loading[url] = nil
        if let img { cache.setObject(img, forKey: url as NSURL, cost: Int(img.size.width * img.size.height * img.scale * img.scale * 4)) }
        return img
    }
}

/// AsyncImage's shape (a picture and a placeholder), drawing from the remembered pictures.
struct NetImage<I: View, P: View>: View {
    let url: URL?
    @ViewBuilder let content: (Image) -> I
    @ViewBuilder let placeholder: () -> P
    @State private var got: (URL, UIImage)?
    var body: some View {
        Group {
            if let url, let img = (got?.0 == url ? got?.1 : nil) ?? Pictures.have(url) { content(Image(uiImage: img)) } else { placeholder() }
        }
        .task(id: url) {
            guard let url, Pictures.have(url) == nil else { return }
            if let img = await Pictures.load(url) { got = (url, img) }
        }
    }
}
