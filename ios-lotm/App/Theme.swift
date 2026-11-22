import SwiftUI

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
            if let url { AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
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
/// Type something at the cursor of whichever writing box has the keyboard (the # tool).
@MainActor func insertTool(_ s: String) { NotificationCenter.default.post(name: .lotmInsert, object: s) }
/// The topics written into a text as #words, as on X: lowercased, without the #, each once.
func hashtags(_ s: String) -> [String] {
    guard s.contains("#"), let re = try? NSRegularExpression(pattern: #"(?<![\p{L}\d_#])#([\p{L}\d_-]{2,40})"#) else { return [] }
    var out: [String] = []
    for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) { if let r = Range(m.range(at: 1), in: s) { let t = s[r].lowercased(); if !out.contains(t) { out.append(t) } } }
    return out
}
extension Notification.Name { static let lotmFlushTyping = Notification.Name("lotm.flushTyping"); static let lotmList = Notification.Name("lotm.list"); static let lotmInsert = Notification.Name("lotm.insert"); static let lotmMention = Notification.Name("lotm.mention"); static let lotmTypedAtEnd = Notification.Name("lotm.typedAtEnd") }
/// Whether one of the app's writing fields has the keyboard (so a tool acts through the field, at its cursor).
enum WriteFocus { static var on = false }

struct CaretText: UIViewRepresentable {
    @Binding var text: String
    var hint = ""
    var size: CGFloat = 20
    var italic = false
    var semibold = false
    /// Apple's own text face (as in Notes and Messages) in place of Garamond.
    var plain = false
    var color: UIColor = UIColor(T.ink)
    var minHeight: CGFloat = 0
    /// Raise this number to put the cursor here.
    var focus = 0
    /// Or say outright whether the cursor is here (nil leaves it alone).
    var active: Bool? = nil
    /// The put-away bar over the keyboard (off where the screen has its own bar there).
    var bar = false
    /// Room kept between the cursor's line and whatever sits over the bottom of the page.
    var below: CGFloat = 30
    var onFocus: (Bool) -> Void = { _ in }

    private var font: UIFont { if plain { return .systemFont(ofSize: size) }; return UIFont(name: italic ? "EBGaramond-Italic" : semibold ? "EBGaramond-SemiBold" : "EBGaramond-Regular", size: size) ?? .systemFont(ofSize: size) }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITextView {
        let v = UITextView()
        v.delegate = context.coordinator; v.isScrollEnabled = false; v.backgroundColor = .clear
        v.textContainerInset = .zero; v.textContainer.lineFragmentPadding = 0
        v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        v.autocapitalizationType = .sentences; v.keyboardAppearance = .dark
        let hintLabel = UILabel(); hintLabel.numberOfLines = 0; hintLabel.tag = 7; hintLabel.textColor = UIColor(T.muted)
        hintLabel.translatesAutoresizingMaskIntoConstraints = false; v.addSubview(hintLabel)
        NSLayoutConstraint.activate([hintLabel.topAnchor.constraint(equalTo: v.topAnchor), hintLabel.leadingAnchor.constraint(equalTo: v.leadingAnchor), hintLabel.widthAnchor.constraint(equalTo: v.widthAnchor)])
        // A bar on the keyboard with a button to put it away.
        let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 40)); bar.barStyle = .black; bar.isTranslucent = true; bar.tintColor = UIColor(T.ink)
        bar.items = [UIBarButtonItem(systemItem: .flexibleSpace), UIBarButtonItem(image: UIImage(systemName: "keyboard.chevron.compact.down"), style: .plain, target: v, action: #selector(UIResponder.resignFirstResponder))]
        if self.bar { v.inputAccessoryView = bar }
        context.coordinator.seen = focus
        return v
    }
    func updateUIView(_ v: UITextView, context: Context) {
        context.coordinator.parent = self
        // While words typed here are still on their way to the page, the page's older copy must not overwrite them.
        if context.coordinator.local == nil, v.text != text { v.text = text }
        // Styled once (and again only if the look changes), not on every letter typed.
        context.coordinator.view = v
        let look = "\(size)|\(italic)|\(semibold)|\(plain)|\(color.hash)"
        if context.coordinator.look != look {
            context.coordinator.look = look
            v.font = font; v.textColor = color
            let p = NSMutableParagraphStyle(); p.lineSpacing = size * 0.16
            v.typingAttributes = [.font: font, .foregroundColor: color, .paragraphStyle: p]
            (v.viewWithTag(7) as? UILabel)?.font = font
        }
        if let l = v.viewWithTag(7) as? UILabel { if l.text != hint { l.text = hint }; l.isHidden = !text.isEmpty }
        if focus != context.coordinator.seen { context.coordinator.seen = focus; DispatchQueue.main.async { v.becomeFirstResponder() } }
        if let active {
            let c = context.coordinator
            if active != c.wasActive {
                c.wasActive = active
                if active { c.take(v, tries: 8) }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { if c.wasActive == false, v.isFirstResponder { v.resignFirstResponder() } } }
            }
        }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView v: UITextView, context: Context) -> CGSize? {
        let w = proposal.width ?? 300
        guard w.isFinite, w > 0 else { return nil }
        let h = v.sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude)).height
        return CGSize(width: w, height: max(h, minHeight, font.lineHeight))
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CaretText; var seen = 0; var look = ""
        /// The words as typed, not yet handed to the page. Like iMessage, the field owns its text while you type: the page
        /// (counters, buttons, the draft) hears about it when you pause, or at once when the field grows a line.
        var local: String?
        private var lastHeight: CGFloat = 0
        private var pending: DispatchWorkItem?
        private var watch: NSObjectProtocol?
        init(_ p: CaretText) {
            parent = p; super.init()
            watch = NotificationCenter.default.addObserver(forName: .lotmFlushTyping, object: nil, queue: nil) { [weak self] _ in MainActor.assumeIsolated { self?.flush() } }
            inserts = NotificationCenter.default.addObserver(forName: .lotmInsert, object: nil, queue: nil) { [weak self] n in let t = n.object as? String ?? ""; MainActor.assumeIsolated { if let v = self?.view, v.isFirstResponder { v.insertText(t) } } }
            lists = NotificationCenter.default.addObserver(forName: .lotmList, object: nil, queue: nil) { [weak self] n in let k = n.object as? String ?? "bullet"; MainActor.assumeIsolated { self?.list(k) } }
        }
        deinit { if let watch { NotificationCenter.default.removeObserver(watch) }; if let lists { NotificationCenter.default.removeObserver(lists) }; if let inserts { NotificationCenter.default.removeObserver(inserts) } }
        private var inserts: NSObjectProtocol?
        weak var view: UITextView?
        private var lists: NSObjectProtocol?
        // MARK: lists
        /// The list mark a line begins with: its length, and its number if it is a numbered one.
        private static func mark(_ line: String) -> (len: Int, n: Int?)? {
            if line.hasPrefix("• ") { return (2, nil) }
            let digits = line.prefix { $0.isNumber }
            if !digits.isEmpty, digits.count < 4, line.dropFirst(digits.count).hasPrefix(". "), let n = Int(digits) { return (digits.count + 2, n) }
            return nil
        }
        private func put(_ v: UITextView, _ r: NSRange, _ s: String) {
            guard let a = v.position(from: v.beginningOfDocument, offset: r.location), let b = v.position(from: a, offset: r.length), let tr = v.textRange(from: a, to: b) else { return }
            v.replace(tr, withText: s); textViewDidChange(v)
        }
        /// The tool: turn the cursor's line into a list item of that kind, change its kind, or (the same kind again) back to plain.
        func list(_ kind: String) {
            guard let v = view, v.isFirstResponder else { return }
            let ns = v.text as NSString, lr = ns.lineRange(for: NSRange(location: min(v.selectedRange.location, ns.length), length: 0))
            let line = ns.substring(with: lr), had = Self.mark(line)
            var want = ""
            if !(had != nil && (had!.n != nil) == (kind == "number")) {
                if kind == "number" {
                    var n = 1
                    if lr.location > 0 { let prev = ns.substring(with: ns.lineRange(for: NSRange(location: lr.location - 1, length: 0))); if let p = Self.mark(prev), let k = p.n { n = k + 1 } }
                    want = "\(n). "
                } else { want = "• " }
            }
            put(v, NSRange(location: lr.location, length: had?.len ?? 0), want); Haptic.tap()
        }
        /// Return inside a list begins the next item; Return on an empty item ends the list.
        func textView(_ v: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard text == "\n", range.length == 0 else { return true }
            let ns = v.text as NSString, lr = ns.lineRange(for: NSRange(location: range.location, length: 0))
            let upto = ns.substring(with: NSRange(location: lr.location, length: range.location - lr.location))
            guard let m = Self.mark(upto) else { return true }
            if (upto as NSString).length == m.len { put(v, NSRange(location: lr.location, length: m.len), ""); return false }
            put(v, range, "\n" + (m.n.map { "\($0 + 1). " } ?? "• ")); return false
        }
        func flush() {
            pending?.cancel(); pending = nil
            guard let t = local else { return }
            local = nil
            if parent.text != t { parent.text = t }
        }
        func textViewDidChange(_ v: UITextView) {
            local = v.text
            (v.viewWithTag(7) as? UILabel)?.isHidden = !v.text.isEmpty
            let h = v.sizeThatFits(CGSize(width: v.bounds.width, height: .greatestFiniteMagnitude)).height
            if h != lastHeight {
                // A new line: the page has to make room now.
                lastHeight = h; flush(); v.invalidateIntrinsicContentSize(); follow(v)
            } else {
                pending?.cancel()
                let w = DispatchWorkItem { [weak self] in self?.flush() }
                pending = w; DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: w)
                follow(v)
            }
        }
        // The page chases the cursor only when something is typed (as in X and Notes): never because the page was
        // scrolled or the cursor was placed by hand, so a finger moving the page is left alone.
        func textViewDidBeginEditing(_ v: UITextView) { parent.onFocus(true); follow(v, after: [0.45]) }
        var endedAt = Date.distantPast
        var wasActive: Bool?
        /// Take the keyboard once the box is on screen (it may not be yet when its turn begins).
        func take(_ v: UITextView, tries: Int) {
            DispatchQueue.main.asyncAfter(deadline: .now() + (v.window == nil ? 0.08 : 0)) { [weak self, weak v] in
                guard let self, let v, self.wasActive == true, !v.isFirstResponder else { return }
                if v.window != nil { v.becomeFirstResponder() } else if tries > 0 { self.take(v, tries: tries - 1) }
            }
        }
        func textViewDidEndEditing(_ v: UITextView) { endedAt = Date(); flush(); parent.onFocus(false) }
        private var following: [DispatchWorkItem] = []
        /// Where the cursor's line is, in the text view's own space. At the very end of the writing (where typing nearly
        /// always is) the system's answer can be empty or sit at the top just after Return, so the end is measured instead.
        private func caret(_ v: UITextView) -> CGRect? {
            guard let r = v.selectedTextRange else { return nil }
            let line = (v.font?.lineHeight ?? 24) + 4
            if v.compare(r.end, to: v.endOfDocument) == .orderedSame {
                let h = v.sizeThatFits(CGSize(width: max(1, v.bounds.width), height: .greatestFiniteMagnitude)).height
                return CGRect(x: 0, y: max(0, h - line), width: 2, height: line)
            }
            let c = v.caretRect(for: r.end)
            guard c.origin.y.isFinite, c.height.isFinite, c.height > 0, c.height < 200 else { return nil }
            if c.minY <= 0.5, v.offset(from: v.beginningOfDocument, to: r.end) > 0, !(v.text ?? "").prefix(v.offset(from: v.beginningOfDocument, to: r.end)).contains("\n"), v.bounds.height > line * 1.6 {
                // claimed to be on the first line: believe it only if the first line really reaches that far
                let first = v.firstRect(for: v.textRange(from: v.beginningOfDocument, to: r.end) ?? r)
                if !first.minY.isFinite || first.height > line * 1.5 { return nil }
            }
            return c
        }
        /// Bring the cursor's line into view with one small move. Tried a few times over a third of a second, since the
        /// page takes a moment to make room for a new line; each try does nothing if the line is already in view.
        private func follow(_ v: UITextView, after: [Double] = [0.02, 0.12, 0.32]) {
            following.forEach { $0.cancel() }; following = []
            for t in after {
                let w = DispatchWorkItem { [weak self, weak v] in
                    guard let self, let v, v.isFirstResponder, let c = self.caret(v) else { return }
                    var s: UIView? = v.superview
                    while let x = s, !(x is UIScrollView) { s = x.superview }
                    guard let scroll = s as? UIScrollView, !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return }
                    let at = v.convert(c, to: scroll)
                    let top = scroll.contentOffset.y + scroll.adjustedContentInset.top + 12
                    let bottom = scroll.contentOffset.y + scroll.bounds.height - scroll.adjustedContentInset.bottom - self.parent.below
                    var y = scroll.contentOffset.y
                    if at.maxY > bottom { y += at.maxY - bottom } else if at.minY < top { y -= top - at.minY } else { return }
                    let lo = -scroll.adjustedContentInset.top, hi = max(lo, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
                    y = max(lo, min(hi, y))
                    if abs(y - scroll.contentOffset.y) > 1 { UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState]) { scroll.contentOffset.y = y } }
                }
                following.append(w); DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: w)
            }
        }
    }
}


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
    @FocusState private var on: Bool

    var body: some View {
        TextField("", text: $local, selection: $sel, prompt: Text(hint).foregroundColor(T.muted), axis: .vertical)
            .font(.serif(size, italic: italic)).foregroundStyle(color).tint(T.ink).lineSpacing(size * 0.16)
            .focused($on)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .contentShape(Rectangle()).onTapGesture { on = true }
            .onAppear { local = text; if active == true { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { on = true } } }
            .onChange(of: text) { _, v in if v != local { local = v; sel = TextSelection(insertionPoint: v.endIndex) } }
            .onChange(of: local) { old, new in carryList(old, new); later(); if on, new.count >= old.count, caret == local.endIndex { NotificationCenter.default.post(name: .lotmTypedAtEnd, object: nil) } }
            .onChange(of: on) { _, v in WriteFocus.on = v; onFocus(v); if !v { flush() } }
            .onReceive(NotificationCenter.default.publisher(for: .lotmMention)) { n in if on, let s = n.object as? String { mention(s) } }
            .onChange(of: active) { _, v in if let v, v != on { on = v } }
            .onChange(of: focus) { _, _ in on = true }
            .onReceive(NotificationCenter.default.publisher(for: .lotmFlushTyping)) { _ in flush() }
            .onReceive(NotificationCenter.default.publisher(for: .lotmList)) { n in if on { list(n.object as? String ?? "bullet") } }
            .onReceive(NotificationCenter.default.publisher(for: .lotmInsert)) { n in if on, let s = n.object as? String { put(s) } }
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
