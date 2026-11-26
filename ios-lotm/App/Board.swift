import SwiftUI
import UIKit
import PDFKit

// The Drafting Board, native (stage one). A member's boards from lotmstudy.org/board/ open on a table that pans and
// zooms as Freeform does: two fingers on the glass or the trackpad to pan, pinch to zoom, a drag on a piece to move
// it, the corner dot to resize it. Writing in pieces, strings and PDF mark-up are still done on the web board; this
// screen keeps every field it does not understand exactly as it found it.

private let IN: CGFloat = 96
private let SPAN: CGFloat = 60000                       // the table: board coordinates run ±30000 around its middle
private let MID = CGPoint(x: SPAN / 2, y: SPAN / 2)
private let NOTE_COLORS: [String: UInt32] = ["yellow": 0xF2E27A, "pink": 0xF2B5B0, "blue": 0xA9CBE8, "green": 0xB9DDB0, "paper": 0xF3ECDD]
private let INK_COLORS: [String: UInt32] = ["ivory": 0xE9E2D2, "ink": 0x1E2836, "red": 0xC0392B, "gold": 0xE9C46A, "blue": 0x7FB2E5, "green": 0x8CC08A]
private let STRING_COLORS: [String: UInt32] = ["red": 0xC0392B, "ink": 0x1E2836, "ivory": 0xE9E2D2]
private func ui(_ rgb: UInt32, _ a: CGFloat = 1) -> UIColor { UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: a) }
private func hex(_ s: String?) -> UIColor? {
    guard var t = s?.trimmingCharacters(in: .whitespaces), t.hasPrefix("#") else { return nil }
    t.removeFirst(); guard t.count == 6, let v = UInt32(t, radix: 16) else { return nil }
    return ui(v)
}
private func num(_ v: Any?) -> CGFloat { if let d = v as? Double { return CGFloat(d) }; if let i = v as? Int { return CGFloat(i) }; if let n = v as? NSNumber { return CGFloat(truncating: n) }; return 0 }
private func garamond(_ size: CGFloat, bold: Bool = false, italic: Bool = false) -> UIFont {
    let name = bold ? (italic ? "EBGaramond-BoldItalic" : "EBGaramond-Bold") : (italic ? "EBGaramond-Italic" : "EBGaramond-Regular")
    return UIFont(name: name, size: size) ?? (italic ? UIFont.italicSystemFont(ofSize: size) : bold ? UIFont.boldSystemFont(ofSize: size) : UIFont.systemFont(ofSize: size))
}

/// The words of a piece, from the HTML the web board keeps: paragraphs, line breaks, bold and italic, list items.
private func words(_ html: String, size: CGFloat, color: UIColor, lineHeight: CGFloat = 1.45) -> NSAttributedString {
    let out = NSMutableAttributedString()
    let para = NSMutableParagraphStyle(); para.lineSpacing = size * (lineHeight - 1.18); para.paragraphSpacing = size * 0.55
    var bold = 0, italic = 0, list: [Int] = []          // list: 0 for bullets, n for the next number
    func add(_ s: String) {
        guard !s.isEmpty else { return }
        out.append(NSAttributedString(string: s, attributes: [.font: garamond(size, bold: bold > 0, italic: italic > 0), .foregroundColor: color, .paragraphStyle: para]))
    }
    func breakLine() { if out.length > 0, !out.string.hasSuffix("\n") { add("\n") } }
    func entity(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var t = s
        for (k, v) in ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&rdquo;": "”", "&ldquo;": "“", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…"] { t = t.replacingOccurrences(of: k, with: v) }
        return t
    }
    var i = html.startIndex
    while i < html.endIndex {
        if html[i] == "<", let close = html[i...].firstIndex(of: ">") {
            var tag = html[html.index(after: i)..<close].lowercased()
            let closing = tag.hasPrefix("/"); if closing { tag.removeFirst() }
            let name = tag.split(whereSeparator: { $0 == " " || $0 == "/" }).first.map(String.init) ?? ""
            switch name {
            case "b", "strong": bold += closing ? -1 : 1
            case "i", "em": italic += closing ? -1 : 1
            case "br": add("\n")
            case "p", "div", "h1", "h2", "h3", "blockquote": breakLine(); if !closing, name.hasPrefix("h") { bold += 1 } else if closing, name.hasPrefix("h") { bold -= 1 }
            case "ul": if closing { _ = list.popLast() } else { list.append(0) }; breakLine()
            case "ol": if closing { _ = list.popLast() } else { list.append(1) }; breakLine()
            case "li":
                if !closing { breakLine(); if let n = list.last, n > 0 { add("\(n). "); list[list.count - 1] = n + 1 } else { add("•  ") } }
            default: break
            }
            i = html.index(after: close)
        } else {
            let next = html[i...].firstIndex(of: "<") ?? html.endIndex
            add(entity(String(html[i..<next]).replacingOccurrences(of: "\n", with: " ")))
            i = next
        }
    }
    while out.string.hasSuffix("\n") { out.deleteCharacters(in: NSRange(location: out.length - 1, length: 1)) }
    return out
}

// MARK: - Model

@MainActor final class BoardModel: ObservableObject {
    struct Head: Identifiable, Equatable { let id: String, title: String }
    @Published var boards: [Head] = []
    @Published var title = ""
    @Published var state = "Loading…"
    var id: String?
    var items: [[String: Any]] = []
    var links: [[String: Any]] = []
    var view: [String: Any] = [:]
    var auth: (() async -> SupaAuth?)?
    private var saving: Task<Void, Never>?

    func db() async -> Supa? { guard let a = await auth?() else { return nil }; return Supa(a: a) }
    func loadList() async {
        guard let db = await db() else { state = "Sign in to see your boards."; return }
        let rows = (try? await db.rows("/rest/v1/boards?select=id,title&order=updated_at.desc")) ?? []
        boards = rows.map { Head(id: $0["id"] as? String ?? "", title: ($0["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled board") }
    }
    /// Opens a board (the most recent, if none is named). Returns false when there is none.
    func open(_ want: String?) async -> Bool {
        guard let db = await db() else { state = "Sign in to see your boards."; return false }
        if boards.isEmpty { await loadList() }
        guard let bid = want ?? boards.first?.id else { state = "No boards yet. Make one on lotmstudy.org/board on a computer."; return false }
        guard let row = (try? await db.rows("/rest/v1/boards?id=eq.\(bid)&select=*"))?.first else { state = "Couldn’t open that board."; return false }
        id = bid; title = row["title"] as? String ?? "Untitled board"
        items = row["items"] as? [[String: Any]] ?? []; links = row["links"] as? [[String: Any]] ?? []; view = row["view"] as? [String: Any] ?? [:]
        state = ""; UserDefaults.standard.set(bid, forKey: "lotm.board.last")
        return true
    }
    /// A moved or resized piece is kept shortly after the hand leaves it. Only the pieces are written; strings and the
    /// view the computer left are not touched.
    func saveSoon() {
        saving?.cancel(); state = "Saving…"
        saving = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled, let self, let id = self.id, let db = await self.db() else { return }
            do { _ = try await db.req("PATCH", "/rest/v1/boards?id=eq.\(id)", json: ["items": self.items]); self.state = "Saved" }
            catch { self.state = "Not saved: \(error.localizedDescription)" }
        }
    }
    /// A PDF of the board's, fetched once and kept on the device.
    func pdf(_ path: String) async -> PDFDocument? {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("board-pdf", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
        if !FileManager.default.fileExists(atPath: file.path) {
            guard let db = await db() else { return nil }
            let enc = path.split(separator: "/").map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
            guard let d = try? await db.req("GET", "/storage/v1/object/authenticated/desk/\(enc)") else { return nil }
            try? d.write(to: file)
        }
        return PDFDocument(url: file)
    }
}

// MARK: - Pieces

/// A PDF page drawn in tiles, so it is sharp at any zoom and only what is on screen is held in memory.
private final class PDFPageView: UIView {
    override class var layerClass: AnyClass { CATiledLayer.self }
    var page: PDFPage? { didSet { layer.setNeedsDisplay() } }
    override init(frame: CGRect) {
        super.init(frame: frame); backgroundColor = .white
        let t = layer as! CATiledLayer; t.levelsOfDetail = 5; t.levelsOfDetailBias = 3; t.tileSize = CGSize(width: 512, height: 512)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {}                // drawing is done in draw(_:in:), off the main thread
    override func draw(_ layer: CALayer, in ctx: CGContext) {
        guard let page else { return }
        let box = page.bounds(for: .mediaBox), size = layer.bounds.size
        ctx.setFillColor(UIColor.white.cgColor); ctx.fill(ctx.boundingBoxOfClipPath)
        ctx.saveGState()
        ctx.translateBy(x: 0, y: size.height); ctx.scaleBy(x: size.width / box.width, y: -size.height / box.height)
        ctx.translateBy(x: -box.minX, y: -box.minY)
        page.draw(with: .mediaBox, to: ctx)
        ctx.restoreGState()
    }
}

private final class PieceView: UIView {
    let id: String
    var item: [String: Any]
    let handle = UIView()
    private var shape: CAShapeLayer?
    var type: String { item["type"] as? String ?? "" }
    var locked: Bool { item["locked"] as? Bool ?? false }
    var keepsShape: Bool { ["image", "pdf", "video"].contains(type) }

    init(_ it: [String: Any], model: BoardModel) {
        id = it["id"] as? String ?? UUID().uuidString; item = it
        super.init(frame: .zero)
        layer.shadowColor = UIColor.black.cgColor; layer.shadowOpacity = 0.3; layer.shadowRadius = 7; layer.shadowOffset = CGSize(width: 0, height: 4)
        build(model)
        handle.backgroundColor = .white; handle.layer.cornerRadius = 9; handle.layer.borderWidth = 2; handle.layer.borderColor = ui(0x3B82F6).cgColor; handle.isHidden = true
        addSubview(handle)
        place()
    }
    required init?(coder: NSCoder) { fatalError() }

    /// Where the piece sits on the table.
    func place() {
        transform = .identity
        let w = max(1, num(item["w"])), h = max(1, num(item["h"]))
        frame = CGRect(x: MID.x + num(item["x"]), y: MID.y + num(item["y"]), width: w, height: h)
        layer.zPosition = num(item["z"])
        let rot = num(item["rot"]); if rot != 0 { transform = CGAffineTransform(rotationAngle: rot * .pi / 180) }
        if type != "line", type != "rect", type != "ellipse", type != "text" { layer.shadowPath = UIBezierPath(rect: CGRect(x: 0, y: 0, width: w, height: h)).cgPath }
        handle.frame = CGRect(x: w - 9, y: h - 9, width: 18, height: 18)
        drawShape()
    }
    func select(_ on: Bool) {
        layer.borderWidth = on && type != "line" ? 2 : 0; layer.borderColor = ui(0x3B82F6).cgColor
        handle.isHidden = !on || locked || type == "line" || type == "text"
        if on { bringSubviewToFront(handle) }
    }
    private func label(_ s: NSAttributedString, lines: Int = 0) -> UILabel { let l = UILabel(); l.numberOfLines = lines; l.attributedText = s; l.translatesAutoresizingMaskIntoConstraints = false; return l }
    private func pin(_ v: UIView, _ i: UIEdgeInsets, bottom: Bool = true) {
        addSubview(v)
        var c = [v.leadingAnchor.constraint(equalTo: leadingAnchor, constant: i.left), v.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -i.right), v.topAnchor.constraint(equalTo: topAnchor, constant: i.top)]
        c.append(bottom ? v.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -i.bottom) : v.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -i.bottom))
        NSLayoutConstraint.activate(c)
    }
    private func reader(_ s: NSAttributedString) -> UITextView {
        let t = UITextView(); t.isEditable = false; t.isSelectable = false; t.backgroundColor = .clear; t.textContainerInset = .zero; t.textContainer.lineFragmentPadding = 0
        t.attributedText = s; t.translatesAutoresizingMaskIntoConstraints = false; t.showsVerticalScrollIndicator = false; t.isScrollEnabled = true
        t.panGestureRecognizer.minimumNumberOfTouches = 2      // one finger moves the piece; two scroll what is in it
        return t
    }
    private func picture(_ url: URL?, into v: UIImageView) {
        guard let url else { return }
        if let i = Pictures.have(url) { v.image = i; return }
        Task { @MainActor [weak v] in v?.image = await Pictures.load(url) }
    }

    private func build(_ model: BoardModel) {
        let html = item["html"] as? String ?? "", fs = num(item["fs"])
        let dark = ui(0x1E2836)
        switch type {
        case "note":
            backgroundColor = ui(NOTE_COLORS[item["color"] as? String ?? "yellow"] ?? 0xF2E27A)
            pin(reader(words(html, size: fs > 0 ? fs : 16, color: ui(0x2A2A22))), UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12))
        case "sheet":
            backgroundColor = ui(0xF8F4EA)
            let body = NSMutableAttributedString()
            let title = item["title"] as? String ?? ""
            if !title.isEmpty, num(item["page"]) <= 1 { body.append(NSAttributedString(string: title + "\n", attributes: [.font: garamond(20, bold: true), .foregroundColor: dark])); body.append(NSAttributedString(string: "\n", attributes: [.font: garamond(6)])) }
            body.append(words(html, size: fs > 0 ? fs : 16, color: dark, lineHeight: 1.5))
            let padX = min(96, num(item["w"]) * 0.12), padY = min(72, num(item["h"]) * 0.07)
            pin(reader(body), UIEdgeInsets(top: padY, left: padX, bottom: padY, right: padX))
        case "quote":
            backgroundColor = ui(0xECE4D3)
            let bar = UIView(frame: .zero); bar.backgroundColor = ui(0x5A6779); bar.translatesAutoresizingMaskIntoConstraints = false; addSubview(bar)
            NSLayoutConstraint.activate([bar.leadingAnchor.constraint(equalTo: leadingAnchor), bar.topAnchor.constraint(equalTo: topAnchor), bar.bottomAnchor.constraint(equalTo: bottomAnchor), bar.widthAnchor.constraint(equalToConstant: 5)])
            let s = NSMutableAttributedString(attributedString: words(html, size: fs > 0 ? fs : 16, color: dark, lineHeight: 1.5))
            if let src = item["source"] as? String, !src.isEmpty { s.append(NSAttributedString(string: "\n\n" + src, attributes: [.font: garamond(13, italic: true), .foregroundColor: ui(0x5B6575)])) }
            pin(reader(s), UIEdgeInsets(top: 22, left: 44, bottom: 14, right: 22))
            let mark = label(NSAttributedString(string: "“", attributes: [.font: garamond(48), .foregroundColor: ui(0x7A1A17, 0.35)])); addSubview(mark)
            NSLayoutConstraint.activate([mark.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16), mark.topAnchor.constraint(equalTo: topAnchor, constant: 2)])
        case "text":
            layer.shadowOpacity = 0
            let size = fs > 0 ? fs : ["S": 16, "M": 24, "L": 36, "XL": 56][item["size"] as? String ?? "M"] ?? 24
            let l = label(words(html, size: size, color: ui(INK_COLORS[item["color"] as? String ?? "ivory"] ?? 0xE9E2D2), lineHeight: 1.3))
            pin(l, .zero, bottom: false)
        case "image":
            backgroundColor = ui(0x2A2D1D)
            let v = UIImageView(); v.contentMode = .scaleAspectFill; v.clipsToBounds = true; v.translatesAutoresizingMaskIntoConstraints = false
            pin(v, .zero); picture((item["url"] as? String).flatMap(URL.init(string:)), into: v)
            if let cap = item["caption"] as? String, !cap.isEmpty {
                let c = label(NSAttributedString(string: cap, attributes: [.font: garamond(13, italic: true), .foregroundColor: ui(0xE9E2D2)])); addSubview(c)
                NSLayoutConstraint.activate([c.leadingAnchor.constraint(equalTo: leadingAnchor), c.trailingAnchor.constraint(equalTo: trailingAnchor), c.topAnchor.constraint(equalTo: bottomAnchor, constant: 6)])
            }
        case "rect", "ellipse", "line":
            layer.shadowOpacity = 0
            let s = CAShapeLayer(); layer.addSublayer(s); shape = s
        case "pdf":
            backgroundColor = .white
            let bar = UIView(); bar.backgroundColor = ui(0x2A3542); bar.translatesAutoresizingMaskIntoConstraints = false; addSubview(bar)
            let t = label(NSAttributedString(string: item["title"] as? String ?? "PDF", attributes: [.font: UIFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: ui(0xE9E2D2)]), lines: 1); bar.addSubview(t)
            let stack = UIScrollView(); stack.translatesAutoresizingMaskIntoConstraints = false; stack.backgroundColor = ui(0x5B6573); stack.panGestureRecognizer.minimumNumberOfTouches = 2; addSubview(stack)
            NSLayoutConstraint.activate([bar.leadingAnchor.constraint(equalTo: leadingAnchor), bar.trailingAnchor.constraint(equalTo: trailingAnchor), bar.topAnchor.constraint(equalTo: topAnchor), bar.heightAnchor.constraint(equalToConstant: 36),
                t.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 12), t.trailingAnchor.constraint(lessThanOrEqualTo: bar.trailingAnchor, constant: -12), t.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
                stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor), stack.topAnchor.constraint(equalTo: bar.bottomAnchor), stack.bottomAnchor.constraint(equalTo: bottomAnchor)])
            let path = item["path"] as? String ?? "", single = (item["mode"] as? String ?? "page") == "page", want = max(1, Int(num(item["page"])))
            Task { @MainActor [weak self, weak stack] in
                guard let doc = await model.pdf(path), let self, let stack else { return }
                let w = self.bounds.width
                let pages: [Int] = single ? [min(want, doc.pageCount)] : Array(1...max(1, doc.pageCount))
                var y: CGFloat = 0
                for p in pages {
                    guard let pg = doc.page(at: p - 1) else { continue }
                    let box = pg.bounds(for: .mediaBox), h = w * box.height / max(1, box.width)
                    let v = PDFPageView(frame: CGRect(x: 0, y: y, width: w, height: h)); v.page = pg; stack.addSubview(v)
                    y += h + (single ? 0 : 10)
                }
                stack.contentSize = CGSize(width: w, height: y); stack.isScrollEnabled = !single
            }
        case "link":
            backgroundColor = ui(0xF6F1E6); clipsToBounds = false
            var top: CGFloat = 12
            if let img = (item["image"] as? String).flatMap(URL.init(string:)) {
                let v = UIImageView(); v.contentMode = .scaleAspectFill; v.clipsToBounds = true; v.translatesAutoresizingMaskIntoConstraints = false; addSubview(v)
                NSLayoutConstraint.activate([v.leadingAnchor.constraint(equalTo: leadingAnchor), v.trailingAnchor.constraint(equalTo: trailingAnchor), v.topAnchor.constraint(equalTo: topAnchor), v.heightAnchor.constraint(equalToConstant: 150)])
                picture(img, into: v); top = 162
            }
            let s = NSMutableAttributedString(string: (item["site"] as? String ?? "").uppercased() + "\n", attributes: [.font: UIFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: ui(0xB2342A), .kern: 1.4])
            s.append(NSAttributedString(string: (item["title"] as? String ?? item["url"] as? String ?? ""), attributes: [.font: garamond(18, bold: true), .foregroundColor: dark]))
            if let d = item["description"] as? String, !d.isEmpty { s.append(NSAttributedString(string: "\n" + d, attributes: [.font: garamond(13), .foregroundColor: ui(0x4A5566)])) }
            pin(label(s, lines: 6), UIEdgeInsets(top: top, left: 16, bottom: 12, right: 16), bottom: false)
        case "video":
            backgroundColor = ui(0x14181D)
            let v = UIImageView(); v.contentMode = .scaleAspectFill; v.clipsToBounds = true; v.translatesAutoresizingMaskIntoConstraints = false
            pin(v, UIEdgeInsets(top: 36, left: 0, bottom: 0, right: 0)); picture(URL(string: "https://i.ytimg.com/vi/\(item["vid"] as? String ?? "")/hqdefault.jpg"), into: v)
            let play = UIImageView(image: UIImage(systemName: "play.circle.fill")); play.tintColor = UIColor.white.withAlphaComponent(0.92); play.translatesAutoresizingMaskIntoConstraints = false; addSubview(play)
            let t = label(NSAttributedString(string: item["title"] as? String ?? "YouTube video", attributes: [.font: UIFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: ui(0xE9E2D2)]), lines: 1); addSubview(t)
            NSLayoutConstraint.activate([play.centerXAnchor.constraint(equalTo: v.centerXAnchor), play.centerYAnchor.constraint(equalTo: v.centerYAnchor), play.widthAnchor.constraint(equalToConstant: 64), play.heightAnchor.constraint(equalToConstant: 64),
                t.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), t.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -12), t.topAnchor.constraint(equalTo: topAnchor, constant: 10)])
        default:
            backgroundColor = ui(0xF6F1E6)
            pin(label(NSAttributedString(string: item["title"] as? String ?? "", attributes: [.font: garamond(18, bold: true), .foregroundColor: dark]), lines: 3), UIEdgeInsets(top: 14, left: 16, bottom: 14, right: 16), bottom: false)
        }
    }
    private func drawShape() {
        guard let s = shape else { return }
        let w = bounds.width, h = bounds.height, sw = max(1, num(item["weight"]) == 0 ? 2 : num(item["weight"]))
        let c = ui(INK_COLORS[item["color"] as? String ?? "ivory"] ?? 0xE9E2D2)
        s.frame = bounds; s.strokeColor = c.cgColor; s.lineWidth = sw; s.lineCap = .round
        switch item["dash"] as? String ?? "" { case "dash": s.lineDashPattern = [NSNumber(value: Double(sw * 4)), NSNumber(value: Double(sw * 3))]; case "dot": s.lineDashPattern = [NSNumber(value: 0.1), NSNumber(value: Double(sw * 2.4))]; default: s.lineDashPattern = nil }
        if type == "line" {
            let p = (item["p"] as? [Any])?.map { num($0) } ?? [0, 0, w, 0]
            let path = UIBezierPath(); if p.count == 4 { path.move(to: CGPoint(x: p[0], y: p[1])); path.addLine(to: CGPoint(x: p[2], y: p[3])) }
            s.path = path.cgPath; s.fillColor = nil
        } else {
            let r = bounds.insetBy(dx: sw / 2, dy: sw / 2)
            s.path = (type == "rect" ? UIBezierPath(rect: r) : UIBezierPath(ovalIn: r)).cgPath
            s.fillColor = (item["fill"] as? Bool ?? false) ? c.withAlphaComponent(0.14).cgColor : nil
        }
    }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        if !handle.isHidden, handle.frame.insetBy(dx: -14, dy: -14).contains(point) { return true }
        if type == "line" { return bounds.insetBy(dx: -14, dy: -14).contains(point) }
        return super.point(inside: point, with: event)
    }
}

// MARK: - The table

final class BoardViewController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let model: BoardModel
    let readOnly: Bool
    private let scroll = UIScrollView()
    private let world = UIView(frame: CGRect(x: 0, y: 0, width: SPAN, height: SPAN))
    private let gridView = UIView(frame: CGRect(x: 0, y: 0, width: SPAN, height: SPAN))
    private let strings = CAShapeLayer(), pins = CAShapeLayer()
    private var pieces: [String: PieceView] = [:]
    private var selected: PieceView?
    private var start = CGRect.zero, resizing = false
    private var opened = false

    init(model: BoardModel, readOnly: Bool) { self.model = model; self.readOnly = readOnly; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.frame = view.bounds; scroll.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scroll.delegate = self; scroll.minimumZoomScale = 0.06; scroll.maximumZoomScale = 4; scroll.bouncesZoom = true
        scroll.contentInsetAdjustmentBehavior = .never; scroll.showsHorizontalScrollIndicator = false; scroll.showsVerticalScrollIndicator = false
        scroll.contentSize = world.bounds.size; scroll.decelerationRate = .normal
        scroll.panGestureRecognizer.minimumNumberOfTouches = 1        // a finger on the bare table pans; on a piece it moves the piece
        view.addSubview(scroll); scroll.addSubview(world); world.addSubview(gridView)
        strings.fillColor = nil; strings.lineWidth = 3; strings.lineCap = .round; strings.zPosition = 1_000_000
        pins.zPosition = 1_000_001
        world.layer.addSublayer(strings); world.layer.addSublayer(pins)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:))); tap.delegate = self; scroll.addGestureRecognizer(tap)
        let twice = UITapGestureRecognizer(target: self, action: #selector(tappedTwice(_:))); twice.numberOfTapsRequired = 2; scroll.addGestureRecognizer(twice)
        tap.require(toFail: twice)
        if !readOnly {
            let drag = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:))); drag.delegate = self; drag.maximumNumberOfTouches = 1
            drag.allowedScrollTypesMask = []                              // trackpad swipes pan the table, never a piece
            scroll.addGestureRecognizer(drag)
            scroll.panGestureRecognizer.require(toFail: drag)
        }
    }

    /// Lays the opened board on the table.
    func show() {
        pieces.values.forEach { $0.removeFromSuperview() }; pieces.removeAll(); selected = nil
        let bg = model.view["bg"] as? [String: Any] ?? [:]
        let color = hex(bg["color"] as? String) ?? ui(0x3B3E2A)
        view.backgroundColor = color; scroll.backgroundColor = color
        paintGrid(kind: bg["grid"] as? String ?? "lines", size: num(bg["size"]) == 0 ? 0.25 : num(bg["size"]), on: color, strength: bg["gridOpacity"] == nil ? 1 : num(bg["gridOpacity"]))
        for it in model.items { let v = PieceView(it, model: model); pieces[v.id] = v; world.addSubview(v) }
        drawStrings()
        opened = false; view.setNeedsLayout()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard !opened, view.bounds.width > 0, !model.items.isEmpty || model.id != nil else { return }
        opened = true; fit(animated: false)
    }
    private func paintGrid(kind: String, size: CGFloat, on bg: UIColor, strength: CGFloat) {
        guard kind != "none" else { gridView.backgroundColor = .clear; return }
        var w: CGFloat = 0; bg.getWhite(&w, alpha: nil)
        let light = w > 0.55, base = light ? ui(0x1E2836) : ui(0xAAC8E6)
        let cell = IN * size, major = cell * 4
        let img = UIGraphicsImageRenderer(size: CGSize(width: major, height: major)).image { c in
            let g = c.cgContext
            for i in 0..<4 {
                let p = CGFloat(i) * cell, a = (i == 0 ? (light ? 0.2 : 0.17) : (light ? 0.08 : 0.06)) * strength
                g.setFillColor(base.withAlphaComponent(min(1, a)).cgColor)
                if kind == "dots" { for j in 0..<4 { g.fillEllipse(in: CGRect(x: p - 1, y: CGFloat(j) * cell - 1, width: 2.4, height: 2.4)) } }
                else { g.fill(CGRect(x: p, y: 0, width: 1, height: major)); g.fill(CGRect(x: 0, y: p, width: major, height: 1)) }
            }
        }
        gridView.backgroundColor = UIColor(patternImage: img)
    }
    /// Strings: a slack red thread from pin to pin, as the web board hangs them.
    private func drawStrings() {
        let path = UIBezierPath(), dots = UIBezierPath()
        var color = ui(0xC0392B)
        for l in model.links {
            guard let a = pieces[l["a"] as? String ?? ""], let b = pieces[l["b"] as? String ?? ""] else { continue }
            func pinOf(_ v: PieceView, _ f: Any?) -> CGPoint {
                let r = CGRect(x: MID.x + num(v.item["x"]), y: MID.y + num(v.item["y"]), width: num(v.item["w"]), height: num(v.item["h"]))
                if let f = f as? [Any], f.count == 2 { return CGPoint(x: r.minX + num(f[0]) * r.width, y: r.minY + num(f[1]) * r.height) }
                return CGPoint(x: r.midX, y: r.minY + 12)
            }
            let p = pinOf(a, l["pa"]), q = pinOf(b, l["pb"]), m = CGPoint(x: (p.x + q.x) / 2, y: (p.y + q.y) / 2), d = hypot(q.x - p.x, q.y - p.y)
            var apex = CGPoint(x: m.x, y: m.y + min(200, d * 0.14))
            if let bend = l["bend"] as? [String: Any] { apex = CGPoint(x: m.x + num(bend["x"]), y: m.y + num(bend["y"])) }
            path.move(to: p); path.addQuadCurve(to: q, controlPoint: CGPoint(x: 2 * apex.x - m.x, y: 2 * apex.y - m.y))
            for e in [p, q] { dots.append(UIBezierPath(ovalIn: CGRect(x: e.x - 7, y: e.y - 7, width: 14, height: 14))) }
            color = ui(STRING_COLORS[l["color"] as? String ?? "red"] ?? 0xC0392B)
        }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        strings.path = path.cgPath; strings.strokeColor = color.cgColor
        pins.path = dots.cgPath; pins.fillColor = ui(0xE9E2D2).cgColor; pins.strokeColor = ui(0x1E2836, 0.5).cgColor; pins.lineWidth = 1
        CATransaction.commit()
    }

    // ---- view
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { world }
    /// After a zoom, the words of the pieces are drawn again at the new size so they stay sharp.
    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
        let s = min(UIScreen.main.scale * 2, max(UIScreen.main.scale, UIScreen.main.scale * scale))
        func sharpen(_ v: UIView) {
            if !(v.layer is CATiledLayer), !(v is UIImageView), abs(v.contentScaleFactor - s) > 0.2 { v.contentScaleFactor = s; v.layer.contentsScale = s; v.setNeedsDisplay() }
            v.subviews.forEach(sharpen)
        }
        let seen = scrollView.convert(scrollView.bounds, to: world)
        for p in pieces.values where p.frame.intersects(seen) { sharpen(p) }
    }
    /// Everything on the board, in view.
    func fit(animated: Bool = true) {
        guard !model.items.isEmpty else { scroll.zoomScale = 1; scroll.contentOffset = CGPoint(x: MID.x - view.bounds.width / 2, y: MID.y - view.bounds.height / 2); return }
        var box = CGRect.null
        for it in model.items { box = box.union(CGRect(x: MID.x + num(it["x"]), y: MID.y + num(it["y"]), width: max(1, num(it["w"])), height: max(1, num(it["h"])))) }
        box = box.insetBy(dx: -80, dy: -80)
        let top = view.safeAreaInsets.top + 56
        let z = max(scroll.minimumZoomScale, min(1, min(view.bounds.width / box.width, (view.bounds.height - top) / box.height)))
        let go = { self.scroll.zoomScale = z; self.scroll.contentOffset = CGPoint(x: box.midX * z - self.view.bounds.width / 2, y: box.midY * z - (self.view.bounds.height + top) / 2) }
        if animated { UIView.animate(withDuration: 0.3, animations: go) } else { go() }
    }
    var zoomPercent: Int { Int((scroll.zoomScale * 100).rounded()) }
    var onZoom: ((Int) -> Void)?
    func scrollViewDidZoom(_ scrollView: UIScrollView) { onZoom?(zoomPercent) }

    // ---- hands
    private func piece(at p: CGPoint) -> PieceView? {
        pieces.values.filter { !$0.isHidden && $0.point(inside: world.convert(p, to: $0), with: nil) }.max { $0.layer.zPosition < $1.layer.zPosition }
    }
    private func select(_ v: PieceView?) { selected?.select(false); selected = v; v?.select(true) }
    @objc private func tapped(_ g: UITapGestureRecognizer) { select(piece(at: g.location(in: world))) }
    @objc private func tappedTwice(_ g: UITapGestureRecognizer) {
        guard let v = piece(at: g.location(in: world)) else { fit(); return }
        // a link or a video opens; anything else is brought up close
        if v.type == "link", let u = (v.item["url"] as? String).flatMap(URL.init(string:)) { openInApp(u); return }
        if v.type == "video", let id = v.item["vid"] as? String, let u = URL(string: "https://www.youtube.com/watch?v=\(id)") { openInApp(u); return }
        let r = v.frame.insetBy(dx: -40, dy: -40)
        scroll.zoom(to: r, animated: true)
    }
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer, pan !== scroll.panGestureRecognizer else { return true }
        guard let v = piece(at: pan.location(in: world)), !v.locked else { return false }   // the bare table pans
        select(v); return true
    }
    @objc private func dragged(_ g: UIPanGestureRecognizer) {
        guard let v = selected else { return }
        switch g.state {
        case .began:
            start = CGRect(x: num(v.item["x"]), y: num(v.item["y"]), width: num(v.item["w"]), height: num(v.item["h"]))
            resizing = !v.handle.isHidden && v.handle.frame.insetBy(dx: -14, dy: -14).contains(g.location(in: v))
            if !resizing { v.item["z"] = (model.items.map { num($0["z"]) }.max() ?? 0) + 1 }
        case .changed:
            let t = g.translation(in: world)
            if resizing {
                var w = max(48, start.width + t.x), h = max(36, start.height + t.y)
                if v.keepsShape, start.width > 0 { h = w * start.height / start.width } else if v.type == "pdf" { w = max(160, w) }
                v.item["w"] = Double(w.rounded()); v.item["h"] = Double(h.rounded())
            } else {
                v.item["x"] = Double((start.minX + t.x).rounded()); v.item["y"] = Double((start.minY + t.y).rounded())
            }
            v.place(); drawStrings()
        case .ended, .cancelled:
            if let i = model.items.firstIndex(where: { $0["id"] as? String == v.id }) {
                for k in ["x", "y", "w", "h", "z"] { model.items[i][k] = v.item[k] }
                model.saveSoon()
            }
        default: break
        }
    }
}

// MARK: - The screen

private struct BoardTable: UIViewControllerRepresentable {
    let vc: BoardViewController
    func makeUIViewController(context: Context) -> BoardViewController { vc }
    func updateUIViewController(_ vc: BoardViewController, context: Context) {}
}

struct BoardScreen: View {
    @Environment(\.closeScreen) private var close
    @StateObject private var m: BoardModel
    @State private var vc: BoardViewController
    @State private var zoom = 100
    let readOnly: Bool

    init(auth: @escaping () async -> SupaAuth?) {
        let model = BoardModel(); model.auth = auth
        let ro = UIDevice.current.userInterfaceIdiom == .phone          // the phone is a viewer
        _m = StateObject(wrappedValue: model); _vc = State(initialValue: BoardViewController(model: model, readOnly: ro)); readOnly = ro
    }
    var body: some View {
        ZStack(alignment: .top) {
            BoardTable(vc: vc).ignoresSafeArea()
            if m.id == nil { Text(m.state).font(.sans(16)).foregroundStyle(T.muted).multilineTextAlignment(.center).padding(40).frame(maxWidth: .infinity, maxHeight: .infinity) }
            HStack(spacing: 10) {
                Button { close() } label: { Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(T.ink).frame(width: 40, height: 40).background(Circle().fill(Color(rgb: 0x2d301f, 0.92))) }
                Menu {
                    ForEach(m.boards) { b in Button { Task { if await m.open(b.id) { vc.show() } } } label: { if b.id == m.id { Label(b.title, systemImage: "checkmark") } else { Text(b.title) } } }
                } label: {
                    HStack(spacing: 6) { Text(m.title.isEmpty ? "Drafting Board" : m.title).font(.serif(17, .semibold)).lineLimit(1); Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)) }
                        .foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 40).background(Capsule().fill(Color(rgb: 0x2d301f, 0.92)))
                }
                Spacer(minLength: 0)
                if !m.state.isEmpty, m.id != nil { Text(m.state).font(.sans(12)).foregroundStyle(T.muted).lineLimit(1) }
                Button { vc.fit() } label: { Text("\(zoom)%").font(.sans(13, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 12).frame(height: 40).background(Capsule().fill(Color(rgb: 0x2d301f, 0.92))) }
            }
            .padding(.horizontal, 12).padding(.top, 6)
        }
        .background(Color(rgb: 0x3B3E2A).ignoresSafeArea()).preferredColorScheme(.dark)
        .task {
            vc.onZoom = { zoom = $0 }
            await m.loadList()
            if await m.open(UserDefaults.standard.string(forKey: "lotm.board.last").flatMap { last in m.boards.contains { $0.id == last } ? last : nil }) { vc.show(); zoom = vc.zoomPercent }
        }
    }
}

@MainActor func openBoard(_ web: WebModel) {
    guard let feed = web.feed else { return }
    presentSlide(BoardScreen(auth: { await feed.auth() }))
}
