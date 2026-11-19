import SwiftUI

// The app's own look, carried over from its stylesheet: EB Garamond and Inter, the olive palette, the cards, pills,
// groups, toggles and page bars. Native screens are drawn from these so they look like the rest of the app.

extension Font {
    /// EB Garamond (the app's serif).
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        let heavy = weight == .semibold || weight == .bold || weight == .heavy || weight == .black
        if italic { return .custom(heavy ? "EBGaramond-SemiBoldItalic" : "EBGaramond-Italic", size: size) }
        switch weight {
        case .medium: return .custom("EBGaramond-Medium", size: size)
        case .semibold: return .custom("EBGaramond-SemiBold", size: size)
        case .bold, .heavy, .black: return .custom("EBGaramond-Bold", size: size)
        default: return .custom("EBGaramond-Regular", size: size)
        }
    }
    /// Inter (the app's sans).
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        switch weight {
        case .medium: return .custom("Inter-Medium", size: size)
        case .semibold: return .custom("Inter-SemiBold", size: size)
        case .bold, .heavy, .black: return .custom("Inter-Bold", size: size)
        default: return .custom("Inter-Regular", size: size)
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
    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { o in
                Button { Haptic.tap(); value = o } label: {
                    Text(o).font(.sans(13, value == o ? .semibold : .regular)).foregroundStyle(T.ink).frame(maxWidth: .infinity).frame(height: 30)
                        .background(RoundedRectangle(cornerRadius: 7).fill(value == o ? T.card : .clear).shadow(color: .black.opacity(value == o ? 0.12 : 0), radius: 1.5, y: 1))
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
struct Paras: View {
    let text: String
    var size: CGFloat = 18
    var leading: CGFloat = 1.4
    var gap: CGFloat = 6
    var body: some View {
        let ps = text.replacingOccurrences(of: "\r", with: "").split(separator: #/\n[ \t]*\n+/#).map { String($0).trimmingCharacters(in: .newlines) }.filter { !$0.isEmpty }
        VStack(alignment: .leading, spacing: gap) {
            ForEach(Array(ps.enumerated()), id: \.offset) { _, p in
                Text(linked(p)).font(.serif(size)).foregroundStyle(T.ink).lineSpacing(max(0, size * leading - size * 1.305))
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
