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
    static let like = Color(rgb: 0xe08a98), green = Color(rgb: 0x2f6b45), danger = Color(rgb: 0xe7907f), sub = Color(rgb: 0xcdcbb4), chev = Color(rgb: 0xb9b696)
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
            .foregroundStyle(liked ? Color(rgb: 0xf2b6c0) : T.ink)
            .frame(maxWidth: .infinity).frame(height: big ? 46 : 40)
            .background(Capsule().fill(liked ? Color(rgb: 0x6b4a4c) : T.soft))
            .overlay(Capsule().stroke(liked ? Color(rgb: 0xa8707a) : T.softBd, lineWidth: 1))
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
                    HStack(spacing: 2) { GlyphView(n: "back", s: 24); Text(back).font(.sans(16)) }.foregroundStyle(T.ink).padding(.vertical, 8)
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
struct Paras: View { let text: String; var size: CGFloat = 18; var leading: CGFloat = 1.4; var gap: CGFloat = 6
    var body: some View {
        let ps = text.replacingOccurrences(of: "\r", with: "").split(separator: #/\n[ \t]*\n+/#).map { String($0).trimmingCharacters(in: .newlines) }.filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: gap) { ForEach(Array(ps.enumerated()), id: \.offset) { _, p in
            let quote = p.hasPrefix(quoteMark)
            Text(linked(quote ? String(p.dropFirst()) : p)).font(.serif(size, italic: quote)).foregroundStyle(T.ink).lineSpacing(max(0, size * leading - size * 1.305))
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
struct CaretText: UIViewRepresentable {
    @Binding var text: String
    var hint = ""
    var size: CGFloat = 20
    var italic = false
    var semibold = false
    var color: UIColor = UIColor(T.ink)
    var minHeight: CGFloat = 0
    /// Raise this number to put the cursor here.
    var focus = 0
    var onFocus: (Bool) -> Void = { _ in }

    private var font: UIFont { UIFont(name: italic ? "EBGaramond-Italic" : semibold ? "EBGaramond-SemiBold" : "EBGaramond-Regular", size: size) ?? .systemFont(ofSize: size) }
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
        v.inputAccessoryView = bar
        context.coordinator.seen = focus
        return v
    }
    func updateUIView(_ v: UITextView, context: Context) {
        context.coordinator.parent = self
        if v.text != text { v.text = text }
        v.font = font; v.textColor = color
        let p = NSMutableParagraphStyle(); p.lineSpacing = size * 0.16
        v.typingAttributes = [.font: font, .foregroundColor: color, .paragraphStyle: p]
        if let l = v.viewWithTag(7) as? UILabel { l.text = hint; l.font = font; l.isHidden = !text.isEmpty }
        if focus != context.coordinator.seen { context.coordinator.seen = focus; DispatchQueue.main.async { v.becomeFirstResponder() } }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView v: UITextView, context: Context) -> CGSize? {
        let w = proposal.width ?? 300
        guard w.isFinite, w > 0 else { return nil }
        let h = v.sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude)).height
        return CGSize(width: w, height: max(h, minHeight, font.lineHeight))
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CaretText; var seen = 0
        init(_ p: CaretText) { parent = p }
        func textViewDidChange(_ v: UITextView) {
            parent.text = v.text
            (v.viewWithTag(7) as? UILabel)?.isHidden = !v.text.isEmpty
            v.invalidateIntrinsicContentSize(); follow(v)
        }
        func textViewDidChangeSelection(_ v: UITextView) { if v.isFirstResponder { follow(v) } }
        func textViewDidBeginEditing(_ v: UITextView) { parent.onFocus(true); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self.follow(v) } }
        func textViewDidEndEditing(_ v: UITextView) { parent.onFocus(false) }
        /// Bring the cursor's line into view in the page it sits in, with a little room above and below.
        private func follow(_ v: UITextView) {
            DispatchQueue.main.async {
                guard let r = v.selectedTextRange else { return }
                var s: UIView? = v.superview
                while let x = s, !(x is UIScrollView) { s = x.superview }
                guard let scroll = s as? UIScrollView else { return }
                let caret = v.convert(v.caretRect(for: r.end), to: scroll).insetBy(dx: 0, dy: -34)
                guard caret.origin.y.isFinite, caret.height.isFinite else { return }
                let top = scroll.contentOffset.y + scroll.adjustedContentInset.top, bottom = scroll.contentOffset.y + scroll.bounds.height - scroll.adjustedContentInset.bottom
                if caret.minY < top || caret.maxY > bottom { scroll.scrollRectToVisible(caret, animated: true) }
            }
        }
    }
}
