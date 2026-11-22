import SwiftUI
import PhotosUI

// Notes (the Commonplace), native: the private notebook in the middle pane of the Library — quick capture, search,
// the list, an entry's own page, and the index.

struct NNote: Identifiable, Equatable {
    let id: String
    var kind = "thought", title = "", body = "", html: String? = nil, quotation = ""
    var bookTitle = "", bookAuthor = "", bookCover: String? = nil, page = ""
    var tags: [String] = [], source = "", image: String? = nil, linked: [String] = [], isPrivate = true
    var created = Date(), createdRaw = ""
    init(id: String) { self.id = id }
    init?(_ r: [String: Any]) {
        guard let i = r["id"] as? String else { return nil }
        id = i; kind = r["kind"] as? String ?? "thought"; title = r["title"] as? String ?? ""; body = r["body"] as? String ?? ""; html = r["body_html"] as? String
        quotation = r["quotation"] as? String ?? ""; bookTitle = r["book_title"] as? String ?? ""; bookAuthor = r["book_author"] as? String ?? ""; bookCover = r["book_cover_url"] as? String
        page = r["page"] as? String ?? ""; tags = r["tags"] as? [String] ?? []; source = r["source_url"] as? String ?? ""; image = (r["image_url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        linked = r["linked_ids"] as? [String] ?? []; isPrivate = r["is_private"] as? Bool ?? true
        createdRaw = r["created_at"] as? String ?? ""; created = parseDate(r["created_at"])
    }
    /// The row as the database keeps it.
    var row: [String: Any] {
        func v(_ s: String) -> Any { s.isEmpty ? NSNull() as Any : s }
        return ["kind": kind, "title": title, "body": body, "body_html": kind != "quote" ? (html ?? NSNull() as Any) : NSNull(), "quotation": kind == "quote" ? v(quotation) : NSNull(),
                "book_title": v(bookTitle), "book_author": v(bookAuthor), "book_cover_url": bookCover ?? NSNull() as Any, "page": v(page), "reference_label": page.isEmpty ? NSNull() as Any : "p. \(page)",
                "tags": tags, "source_url": v(source), "image_url": image ?? NSNull() as Any, "linked_ids": linked, "is_private": isPrivate]
    }
}
struct NBook: Identifiable, Equatable { var id: String { title }; let title: String, author: String, cover: String? }
enum NFilter: Equatable { case book(String), loose, author(String), tag(String), month(String)
    var label: String {
        switch self {
        case .book(let b): return b
        case .loose: return "Not linked to a book"
        case .author(let a): return a
        case .tag(let t): return "#" + t
        case .month(let m): return monthName(m)
        }
    }
}
private let NCOLS = "id,kind,title,body,body_html,quotation,book_title,book_author,book_cover_url,page,tags,source_url,image_url,linked_ids,is_private,created_at,updated_at"
private func monthName(_ ym: String) -> String {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM"
    guard let d = f.date(from: ym) else { return ym }
    return d.formatted(.dateTime.month(.wide).year())
}
private func relDay(_ d: Date) -> String {
    let cal = Calendar.current, days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
    return days == 0 ? "Today" : days == 1 ? "Yesterday" : days < 7 ? d.formatted(.dateTime.weekday(.wide)) : d.formatted(.dateTime.month(.abbreviated).day())
}
private func tagList(_ s: String) -> [String] { s.split(whereSeparator: { $0 == "," || $0.isWhitespace }).map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "#")).lowercased() }.filter { !$0.isEmpty } }
private let NSHADES: [Color] = ([0x9c5463, 0x6f5b7d, 0xc9382f, 0xa8863f, 0x8c9469, 0x5b6b80, 0xb8752e, 0x4b3f6b] as [UInt32]).map { Color(rgb: $0) }
private struct NCover: View {
    let title: String, url: String?, w: CGFloat, h: CGFloat
    var body: some View {
        ZStack { NSHADES[title.unicodeScalars.reduce(0) { $0 + Int($1.value) } % NSHADES.count]; if let u = url.flatMap(URL.init(string:)) { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear } } }
            .frame(width: w, height: h).clipShape(RoundedRectangle(cornerRadius: 3))
    }
}
private struct TagChip: View { let t: String; var body: some View { Text("#\(t)").font(.sans(12, .semibold)).foregroundStyle(T.sub).padding(.horizontal, 9).padding(.vertical, 3).background(RoundedRectangle(cornerRadius: 10).fill(Color(rgb: 0x454832))) } }

@MainActor
final class NotesModel: ObservableObject {
    static let shared = NotesModel()
    @Published var notes: [NNote] = []
    @Published var loaded = false
    @Published var lib: [NBook] = []
    @Published var filter: NFilter?
    @Published var toast: String?
    var undo: (() -> Void)?
    weak var feed: FeedModel?
    private var doomed: [String: Task<Void, Never>] = [:]
    /// Sign-in for when the notebook is written to before its page has been opened (from the composer).
    var alt: (() async -> SupaAuth?)?
    private func db() async -> Supa? {
        if let a = await feed?.auth() { return Supa(a: a) }
        if let a = await alt?() { return Supa(a: a) }
        return nil
    }

    func say(_ s: String, undo u: (() -> Void)? = nil) {
        toast = s; undo = u
        Task { try? await Task.sleep(nanoseconds: 4_000_000_000); if toast == s { toast = nil; undo = nil } }
    }
    func load() async {
        guard let db = await db() else { return }
        if let rows = try? await db.rows("/rest/v1/private_notes?user_id=eq.\(db.a.me)&select=\(NCOLS)&order=created_at.desc") {
            notes = rows.compactMap(NNote.init).filter { doomed[$0.id] == nil }
        }
        loaded = true
    }
    func loadLib() async {
        guard lib.isEmpty, let db = await db() else { return }
        async let R = db.rows("/rest/v1/current_reads?user_id=eq.\(db.a.me)&select=custom_title,custom_author,custom_cover_url,editions(title,author,cover_url)")
        async let U = db.rows("/rest/v1/club_updates?select=book_title,book_author,cover_url&order=created_at.desc&limit=40")
        async let B = db.rows("/rest/v1/books_read?select=title,author,cover_url")
        var out: [NBook] = [], seen = Set<String>()
        func add(_ t: Any?, _ a: Any?, _ c: Any?) {
            guard let t = t as? String, !t.isEmpty else { return }
            let title = t.replacingOccurrences(of: #"^Amazon\.com:\s*"#, with: "", options: [.regularExpression, .caseInsensitive]).split(separator: ":").prefix(2).joined(separator: ":").trimmingCharacters(in: .whitespaces)
            if seen.insert(title.lowercased()).inserted { out.append(NBook(title: title, author: a as? String ?? "", cover: c as? String)) }
        }
        for x in (try? await R) ?? [] { let e = x["editions"] as? [String: Any]; add(e?["title"] ?? x["custom_title"], e?["author"] ?? x["custom_author"], e?["cover_url"] ?? x["custom_cover_url"]) }
        for x in (try? await U) ?? [] { add(x["book_title"], x["book_author"], x["cover_url"]) }
        for x in (try? await B) ?? [] { add(x["title"], x["author"], x["cover_url"]) }
        lib = out
    }
    func upload(_ img: UIImage) async -> String? {
        guard let db = await db() else { return nil }
        do { return try await db.upload(img) } catch { say(error.localizedDescription); return nil }
    }
    /// Save a new note or the changes to one. Returns whether it was kept.
    func save(_ n: NNote, new: Bool) async -> Bool {
        guard let db = await db() else { say("The app isn’t ready. Try again."); return false }
        var row = n.row
        do {
            if new {
                row["user_id"] = db.a.me
                let d = try await db.req("POST", "/rest/v1/private_notes?select=\(NCOLS)", json: row, prefer: "return=representation")
                if let r = ((try? JSONSerialization.jsonObject(with: d)) as? [[String: Any]])?.first, let made = NNote(r) { notes.insert(made, at: 0) }
            } else {
                row["updated_at"] = ISO8601DateFormatter().string(from: Date())
                _ = try await db.req("PATCH", "/rest/v1/private_notes?id=eq.\(n.id)", json: row)
                if let i = notes.firstIndex(where: { $0.id == n.id }) { notes[i] = n }
            }
            Haptic.tap(); return true
        } catch { say(error.localizedDescription); return false }
    }
    /// The note leaves the list at once; it is deleted for good only if Undo isn't tapped.
    func delete(_ n: NNote) {
        withAnimation(.snappy) { notes.removeAll { $0.id == n.id } }
        doomed[n.id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled, let self else { return }
            _ = try? await self.db()?.req("DELETE", "/rest/v1/private_notes?id=eq.\(n.id)")
            self.doomed[n.id] = nil
        }
        say("Note deleted") { [weak self] in
            guard let self else { return }
            self.doomed[n.id]?.cancel(); self.doomed[n.id] = nil
            withAnimation(.snappy) { self.notes.append(n); self.notes.sort { $0.created > $1.created } }
            self.toast = nil
        }
    }
}

/// Open an entry (or a new one, perhaps holding a passage shared from elsewhere) over the app.
@MainActor func openNote(_ web: WebModel, id: String? = nil, text: String = "", url: String = "") {
    let m = NotesModel.shared; m.feed = web.feed
    presentSlide(NoteEntry(m: m, web: web, id: id, text: text, url: url))
}

// MARK: - The pane

struct NotesPane: View {
    @ObservedObject var m: NotesModel
    @ObservedObject var feed: FeedModel
    @ObservedObject var web: WebModel
    @State private var q = ""
    @State private var kind = "all"

    private var shown: [NNote] {
        let s = q.trimmingCharacters(in: .whitespaces).lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        return m.notes.filter { n in
            guard kind == "all" || (kind == "quote") == (n.kind == "quote") else { return false }
            switch m.filter {
            case .book(let b): if n.bookTitle != b { return false }
            case .loose: if !n.bookTitle.isEmpty { return false }
            case .author(let a): if n.bookAuthor != a { return false }
            case .tag(let t): if !n.tags.contains(t) { return false }
            case .month(let ym): if !n.createdRaw.hasPrefix(ym) { return false }
            case nil: break
            }
            return s.isEmpty || ([n.title, n.body, n.quotation, n.bookTitle, n.bookAuthor] + n.tags).contains { $0.lowercased().contains(s) }
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Your private notebook").font(.sans(14)).foregroundStyle(T.muted)
                    Spacer()
                    Button { presentSlide(NoteIndex(m: m)) } label: {
                        HStack(spacing: 6) { Image(systemName: "line.3.horizontal.decrease").font(.system(size: 13, weight: .bold)); Text("Index").font(.sans(14, .semibold)) }
                            .foregroundStyle(T.ink).padding(.horizontal, 14).frame(height: 34).background(Capsule().fill(Color(rgb: 0x0c0e08, 0.08)))
                    }.buttonStyle(.plain)
                }
                .padding(.leading, 20).padding(.trailing, 16).padding(.top, 12)
                HStack(spacing: 8) {
                    GlyphView(n: "search", s: 18).foregroundStyle(T.muted)
                    TextField("", text: $q, prompt: Text("Search quotes, thoughts, books, tags").foregroundColor(T.muted)).font(.sans(14)).foregroundStyle(T.ink).autocorrectionDisabled().submitLabel(.search)
                    if !q.isEmpty { Button { q = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(T.muted) } }
                }
                .padding(.horizontal, 14).frame(height: 48).background(RoundedRectangle(cornerRadius: 18).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 18).stroke(T.rule)).padding(.horizontal, 16).padding(.top, 10)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach([("all", "All · \(m.notes.count)"), ("quote", "Quotes"), ("note", "Notes")], id: \.0) { k, l in
                            Button { Haptic.tap(); kind = k } label: {
                                Text(l).font(.sans(14, .semibold)).foregroundStyle(kind == k ? T.paper : T.ink).padding(.horizontal, 14).frame(height: 32).background(Capsule().fill(kind == k ? T.ink : Color(rgb: 0x0c0e08, 0.07)))
                            }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 16)
                }
                .padding(.top, 10)
                if let f = m.filter {
                    HStack(spacing: 8) {
                        Text("Showing").font(.sans(14)).foregroundStyle(T.muted)
                        Text(f.label).font(.serif(16, .bold)).foregroundStyle(T.ink).lineLimit(1)
                        Spacer()
                        Button("Clear ✕") { withAnimation(.snappy) { m.filter = nil } }.font(.sans(14, .semibold)).foregroundStyle(T.muted)
                    }
                    .padding(.horizontal, 20).padding(.top, 12)
                }
                ForEach(shown) { n in
                    Button { openNote(web, id: n.id) } label: { NoteCard(n: n, all: m.notes) }
                        .buttonStyle(Press(scale: 0.985))
                        .contextMenu { Button(role: .destructive) { m.delete(n) } label: { Label("Delete", systemImage: "trash") } }
                        .padding(.horizontal, 16).padding(.top, 10)
                        .transition(.opacity)
                }
                if shown.isEmpty {
                    Text(!m.loaded ? "Loading…" : m.notes.isEmpty ? "Your commonplace book is empty. Save a passage worth keeping." : "Nothing matches.")
                        .font(.serif(17)).foregroundStyle(T.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(40)
                }
                Color.clear.frame(height: 130)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await m.load() }
        .overlay(alignment: .bottom) {
            if let t = m.toast {
                HStack(spacing: 14) {
                    Text(t).font(.sans(14, .semibold)).foregroundStyle(T.paper)
                    if m.undo != nil { Button("Undo") { m.undo?() }.font(.sans(14, .bold)).foregroundStyle(T.paper).underline() }
                }
                .padding(.horizontal, 16).padding(.vertical, 10).background(Capsule().fill(T.ink)).padding(.bottom, 110).transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: m.toast)
        .task { m.feed = feed; if !m.loaded { await m.load() } }
    }
}

private struct NoteCard: View {
    let n: NNote, all: [NNote]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text((n.kind == "quote" ? "Quote" : "Note") + (n.isPrivate ? "" : " · Shared")).font(.sans(11, .bold)).tracking(0.9).textCase(.uppercase)
                Spacer()
                Text(relDay(n.created)).font(.sans(11, .medium))
            }.foregroundStyle(T.muted)
            if !n.quotation.isEmpty {
                Text(n.quotation).font(.serif(18.5, italic: true)).foregroundStyle(T.ink).lineSpacing(3).multilineTextAlignment(.leading).lineLimit(8)
                    .padding(.leading, 12).overlay(alignment: .leading) { T.ink.frame(width: 3) }.padding(.top, 8)
            }
            if !n.title.isEmpty { Text(n.title).font(.serif(18, .semibold)).foregroundStyle(T.ink).multilineTextAlignment(.leading).padding(.top, 6) }
            if !n.body.isEmpty { Text(n.body).font(.serif(n.kind == "quote" ? 17 : 18.5, .medium)).foregroundStyle(n.kind == "quote" ? T.sub : T.ink).lineSpacing(3).lineLimit(4).multilineTextAlignment(.leading).padding(.top, 6) }
            if let u = n.image.flatMap(URL.init(string:)) {
                Color(rgb: 0x2a2d1d).frame(height: 180).overlay(AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear }).clipShape(RoundedRectangle(cornerRadius: 10)).padding(.top, 8)
            }
            if let u = n.firstLink { LinkCard(url: u).id(u).padding(.top, 8) }
            if !n.bookTitle.isEmpty {
                HStack(spacing: 8) {
                    NCover(title: n.bookTitle, url: n.bookCover, w: 18, h: 26)
                    (Text(n.bookTitle).font(.serif(14, italic: true)).foregroundColor(T.ink) + Text((n.bookAuthor.isEmpty ? "" : " · \(n.bookAuthor)") + (n.page.isEmpty ? "" : " · p. \(n.page)")).font(.sans(13)).foregroundColor(T.sub)).lineLimit(2).multilineTextAlignment(.leading)
                }.padding(.top, 10)
            }
            // (a topic typed into the words as #topic already shows there)
            let chips = n.tags.filter { !(n.body + " " + n.quotation).lowercased().contains("#" + $0.lowercased()) }
            if !chips.isEmpty { Wrap(spacing: 6) { ForEach(chips, id: \.self) { TagChip(t: $0) } }.padding(.top, 8) }
            if !n.linked.isEmpty {
                let names = n.linked.compactMap { id in all.first { $0.id == id } }.map { x in (x.bookAuthor.isEmpty ? (x.bookTitle.isEmpty ? (x.title.isEmpty ? "entry" : x.title) : x.bookTitle) : x.bookAuthor).split(whereSeparator: { " ,:".contains($0) }).last.map(String.init) ?? "entry" }
                Text("Linked to \(n.linked.count) \(n.linked.count == 1 ? "entry" : "entries")" + (names.isEmpty ? "" : " · " + names.joined(separator: ", "))).font(.sans(13)).foregroundStyle(T.sub).padding(.top, 8)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}

/// Which of your books a note is from.
private struct BookPicker: View {
    @ObservedObject var m: NotesModel
    let pick: (NBook?) -> Void
    @State private var q = ""
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 8) {
                Text("Which book?").font(.serif(18, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 4)
                TextField("", text: $q, prompt: Text("Search your library").foregroundColor(T.muted)).font(.sans(16)).foregroundStyle(T.ink).autocorrectionDisabled()
                    .padding(.horizontal, 14).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(T.paper)).overlay(RoundedRectangle(cornerRadius: 12).stroke(T.softBd))
                VStack(spacing: 0) {
                    Button { pick(nil) } label: { Text("No book").font(.sans(15)).foregroundStyle(T.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).frame(height: 48).contentShape(Rectangle()) }.buttonStyle(.plain)
                    ForEach(m.lib.filter { q.isEmpty || $0.title.lowercased().contains(q.lowercased()) }) { b in
                        Button { pick(b) } label: {
                            HStack(spacing: 10) {
                                NCover(title: b.title, url: b.cover, w: 30, h: 44)
                                VStack(alignment: .leading, spacing: 1) { Text(b.title).font(.serif(16)).foregroundStyle(T.ink).multilineTextAlignment(.leading); if !b.author.isEmpty { Text(b.author).font(.sans(12)).foregroundStyle(T.muted) } }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 8).contentShape(Rectangle()).overlay(alignment: .top) { T.groupLine.frame(height: 1) }
                        }.buttonStyle(.plain)
                    }
                    if m.lib.isEmpty { Text("Loading your library…").font(.sans(15)).foregroundStyle(T.muted).padding(14).frame(maxWidth: .infinity, alignment: .leading) }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(T.group))
            }
            .padding(.horizontal, 16)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
        .task { await m.loadLib() }
    }
}

// MARK: - One entry

struct NoteEntry: View {
    /// Only a note that already has a title shows the title line.
    @State private var titled = false
    /// A note's page shows its words in Apple's text face from the start: a note already written waits for a tap
    /// before the keyboard comes up; a new one opens ready to type. (The Garamond reading view is not used.)
    @State private var editing = true
    @FocusState private var linkFocus: Bool
    private func ntool(_ g: String) -> some View { GlyphView(n: g, s: 24).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }
    @ObservedObject var m: NotesModel
    @ObservedObject var web: WebModel
    let id: String?
    @Environment(\.closeScreen) private var close
    @State private var n: NNote
    @State private var original = ""
    @State private var pick = ""              // "", book, link, tag
    @State private var newTag = ""
    @State private var camera = false
    @State private var busy = false
    @State private var confirm = false
    @State private var tick = 0
    @State private var photo: PhotosPickerItem?

    init(m: NotesModel, web: WebModel, id: String?, text: String = "", url: String = "") {
        self.m = m; self.web = web; self.id = id
        var x = id.flatMap { i in m.notes.first { $0.id == i } } ?? NNote(id: id ?? "")
        if id == nil { x.kind = text.isEmpty ? "thought" : "quote"; x.quotation = text; x.source = url }
        _n = State(initialValue: x); _original = State(initialValue: x.body)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { close() }.font(.sans(16)).foregroundStyle(T.ink)
                Spacer()
                Button { save() } label: { Text(busy ? "…" : "Save").font(.sans(14, .bold)).foregroundStyle(T.paper).padding(.horizontal, 18).frame(height: 36).background(Capsule().fill(T.ink)) }.disabled(busy)
            }
            .overlay(Text((id == nil ? "New " : "") + (n.kind == "quote" ? (id == nil ? "quote" : "Quote") : (id == nil ? "note" : "Note"))).font(.serif(18, .semibold)).foregroundStyle(T.ink))
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Seg(options: ["Quote", "Note"], value: Binding(get: { n.kind == "quote" ? "Quote" : "Note" }, set: { flushTyping(); n.kind = $0 == "Quote" ? "quote" : "thought" })).padding(.horizontal, 16).onAppear { titled = !n.title.trimmingCharacters(in: .whitespaces).isEmpty }
                    VStack(alignment: .leading, spacing: 0) {
                        if titled { WriteField(text: $n.title, hint: "Title", size: 22).padding(.bottom, 8) }
                        if !editing {
                            // A note opens to be read, in Garamond; a tap on the words begins editing them.
                            VStack(alignment: .leading, spacing: 12) {
                                if n.kind == "quote", !n.quotation.isEmpty { Text(n.quotation).font(.serif(21, italic: true)).padding(.leading, 12).overlay(alignment: .leading) { T.ink.frame(width: 3) } }
                                if !n.body.isEmpty { Text(linked(n.body)).font(.serif(20)) }
                            }
                            .foregroundStyle(T.ink).lineSpacing(5).frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading).contentShape(Rectangle())
                            .onTapGesture { editing = true; tick += 1 }
                        } else if n.kind == "quote" {
                            Text("THE PASSAGE").font(.sans(11, .bold)).tracking(0.9).foregroundStyle(T.muted)
                            WriteField(text: $n.quotation, hint: "Type or paste the passage", size: 20, italic: true, minHeight: 96, focus: tick)
                                .padding(.leading, 12).overlay(alignment: .leading) { T.ink.frame(width: 3) }.padding(.top, 6)
                            WriteField(text: $n.body, hint: "Your thought on it (optional)", size: 19, color: T.sub, minHeight: 44).padding(.top, 10)
                        } else {
                            WriteField(text: $n.body, hint: "What’s on your mind?", size: 20, minHeight: 160, focus: tick)
                        }
                        if let u = n.image.flatMap(URL.init(string:)) {
                            AsyncImage(url: u) { $0.resizable().scaledToFit() } placeholder: { T.soft.frame(height: 160) }.clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(alignment: .topTrailing) { Button { n.image = nil } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white).frame(width: 24, height: 24).background(Circle().fill(Color(rgb: 0x0a0c06, 0.72))) }.padding(6) }
                                .padding(.top, 8)
                        }
                        if let u = n.firstLink { LinkCard(url: u).id(u).padding(.top, 10) }
                        // the same tools, in the same order, as the post writer
                        HStack(spacing: 0) {
                            PhotosPicker(selection: $photo, matching: .images) { ntool("image") }.accessibilityLabel("Photo")
                            Button { camera = true } label: { ntool("camera") }.accessibilityLabel("Camera")
                            Button { linkFocus = true } label: { ntool("link") }.foregroundStyle(n.source.isEmpty ? T.muted : T.ink).accessibilityLabel("Web link")
                            Button { flushTyping(); n.kind = n.kind == "quote" ? "thought" : "quote" } label: { ntool("quote2") }.foregroundStyle(n.kind == "quote" ? T.ink : T.muted).accessibilityLabel("Quote")
                            Button { pick = "book" } label: { ntool("book") }.foregroundStyle(n.bookTitle.isEmpty ? T.muted : T.ink).accessibilityLabel("Book")
                            Button { if !editing { editing = true; tick += 1 }; insertTool("#") } label: { ntool("hash") }.accessibilityLabel("Topic")
                            Button { listTool("bullet") } label: { Image(systemName: "list.bullet").font(.system(size: 19)).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }.accessibilityLabel("Bullet list")
                            Button { listTool("number") } label: { Image(systemName: "list.number").font(.system(size: 19)).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }.accessibilityLabel("Numbered list")
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(T.muted).buttonStyle(.plain).padding(.leading, -8).padding(.top, 6)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule)).padding(.horizontal, 16).padding(.top, 14)

                    VStack(spacing: 0) {
                        Button { pick = "book" } label: {
                            HStack(spacing: 12) {
                                if n.bookTitle.isEmpty { RoundedRectangle(cornerRadius: 3).strokeBorder(Color(rgb: 0x626546), style: StrokeStyle(lineWidth: 1, dash: [4, 3])).frame(width: 30, height: 44) } else { NCover(title: n.bookTitle, url: n.bookCover, w: 30, h: 44) }
                                VStack(alignment: .leading, spacing: 1) { Text("FROM YOUR LIBRARY").font(.sans(11, .bold)).tracking(0.9).foregroundStyle(T.muted); Text(n.bookTitle.isEmpty ? "Choose a book" : n.bookTitle).font(.serif(17)).foregroundStyle(T.ink).multilineTextAlignment(.leading) }
                                Spacer(minLength: 0); Text(n.bookTitle.isEmpty ? "›" : "Change ›").font(.sans(14)).foregroundStyle(T.chev)
                            }.rowBox()
                        }.buttonStyle(.plain)
                        if !n.bookTitle.isEmpty {
                            line
                            HStack { Text("Page").font(.sans(14)).foregroundStyle(T.ink); Spacer()
                                TextField("", text: $n.page).multilineTextAlignment(.trailing).keyboardType(.numbersAndPunctuation).font(.sans(14)).foregroundStyle(T.ink).padding(.horizontal, 8).frame(width: 70, height: 32)
                                    .background(RoundedRectangle(cornerRadius: 8).fill(T.group)).overlay(RoundedRectangle(cornerRadius: 8).stroke(T.softBd)) }.rowBox()
                        }
                        line
                        HStack(spacing: 10) { Text("Web link").font(.sans(14)).foregroundStyle(T.ink)
                            TextField("", text: $n.source, prompt: Text("Where it’s from (optional)").foregroundColor(T.muted)).focused($linkFocus).multilineTextAlignment(.trailing).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().font(.sans(14)).foregroundStyle(T.ink) }.rowBox()
                        line
                        Button { pick = "link" } label: { HStack { Text("Link to another note").font(.sans(14)).foregroundStyle(T.ink); Spacer(); Text(n.linked.isEmpty ? "None ›" : "\(n.linked.count) linked ›").font(.sans(14)).foregroundStyle(T.chev) }.rowBox() }.buttonStyle(.plain)
                        line
                        Toggle(isOn: $n.isPrivate) { Text("Private").font(.sans(14)).foregroundStyle(T.ink) }.tint(T.green).rowBox()
                    }
                    .background(RoundedRectangle(cornerRadius: 16).fill(T.card)).overlay(RoundedRectangle(cornerRadius: 16).stroke(T.rule)).padding(.horizontal, 16).padding(.top, 10)
                    Text("Private notes are yours alone. Turn it off to let you share this one into the feed.").font(.sans(13)).foregroundStyle(T.muted).lineSpacing(2).padding(.horizontal, 20).padding(.top, 10)
                    if !n.isPrivate { Button("Share to the feed") { share() }.buttonStyle(PillStyle()).padding(.horizontal, 16).padding(.top, 12) }
                    if id != nil { Button("Delete note") { confirm = true }.font(.sans(15, .semibold)).foregroundStyle(T.danger).frame(maxWidth: .infinity).padding(.top, 26) }
                    Color.clear.frame(height: 60)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(T.paper.ignoresSafeArea()).preferredColorScheme(.dark).tint(T.ink)
        .onAppear { if id == nil { DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { tick += 1 } } }
        .fullScreenCover(isPresented: $camera) { CameraPicker { img in camera = false; if let img { busy = true; Task { n.image = await m.upload(img) ?? n.image; busy = false } } }.ignoresSafeArea() }
        .onChange(of: photo) { _, it in
            guard let it else { return }
            Task { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { busy = true; n.image = await m.upload(img) ?? n.image; busy = false }; photo = nil }
        }
        .sheet(isPresented: Binding(get: { pick == "book" }, set: { if !$0 { pick = "" } })) { BookPicker(m: m) { b in n.bookTitle = b?.title ?? ""; n.bookAuthor = b?.author ?? ""; n.bookCover = b?.cover; if b == nil { n.page = "" }; pick = "" } }
        .sheet(isPresented: Binding(get: { pick == "link" }, set: { if !$0 { pick = "" } })) { linker }
        .alert("Add a topic", isPresented: Binding(get: { pick == "tag" }, set: { if !$0 { pick = "" } })) {
            TextField("virtue", text: $newTag).textInputAutocapitalization(.never)
            Button("Add") { for t in tagList(newTag) where !n.tags.contains(t) { n.tags.append(t) } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this note?", isPresented: $confirm, titleVisibility: .visible) { Button("Delete", role: .destructive) { let x = n; close(); m.delete(x) } }
    }
    private var line: some View { Color(rgb: 0x444731).frame(height: 1) }
    private var linker: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 8) {
                Text("Link to another note").font(.serif(18, .semibold)).foregroundStyle(T.ink).padding(.horizontal, 4)
                VStack(spacing: 0) {
                    ForEach(m.notes.filter { $0.id != n.id }) { o in
                        let on = n.linked.contains(o.id)
                        Button { if on { n.linked.removeAll { $0 == o.id } } else { n.linked.append(o.id) }; Haptic.tap() } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(o.quotation.isEmpty ? (o.title.isEmpty ? o.body : o.title) : o.quotation).font(.serif(15)).foregroundStyle(T.ink).lineLimit(2).multilineTextAlignment(.leading)
                                    if !o.bookTitle.isEmpty { Text(o.bookTitle).font(.sans(12)).foregroundStyle(T.muted).lineLimit(1) }
                                }
                                Spacer(minLength: 0)
                                Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? T.ink : T.muted)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10).contentShape(Rectangle()).overlay(alignment: .top) { T.groupLine.frame(height: 1) }
                        }.buttonStyle(.plain)
                    }
                    if m.notes.count < 2 { Text("No other notes yet.").font(.sans(15)).foregroundStyle(T.muted).padding(14).frame(maxWidth: .infinity, alignment: .leading) }
                }
                .background(RoundedRectangle(cornerRadius: 14).fill(T.group))
            }
            .padding(.horizontal, 16)
        }
        .background(T.card.ignoresSafeArea()).preferredColorScheme(.dark)
    }
    private func save() {
        flushTyping()
        let empty = [n.quotation, n.body, n.title].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !empty else { m.say("Write something first"); close(); return }
        var x = n
        x.body = x.body.trimmingCharacters(in: .whitespacesAndNewlines); x.title = x.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if x.kind != "quote" { x.kind = x.title.isEmpty ? "thought" : "entry" }
        for h in hashtags(x.body + "\n" + x.quotation) where !x.tags.contains(h) { x.tags.append(h) }
        if x.body != original { x.html = nil }        // the words changed here, so any formatting set on the web no longer fits them
        busy = true
        Task { if await m.save(x, new: id == nil) { close() }; busy = false }
    }
    private func share() {
        flushTyping()
        let t = n.kind == "quote" ? "“\(n.quotation)”" + (n.bookTitle.isEmpty ? "" : " — \(n.bookTitle)" + (n.page.isEmpty ? "" : ", p. \(n.page)")) + (n.body.isEmpty ? "" : "\n\n\(n.body)") : n.body
        let name = web.feed?.myName ?? "", avatar = web.feed?.myAvatar
        close { web.composer.present(name: name, avatar: avatar, text: t) }
    }
}
private extension View { func rowBox() -> some View { padding(.horizontal, 16).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) } }

// MARK: - The index

struct NoteIndex: View {
    @ObservedObject var m: NotesModel
    @Environment(\.closeScreen) private var close
    @State private var tab = "Books"
    private struct Row: Identifiable { let id: String; var label: String, sub = "", cover: String? = nil, count = 1, letter: String, filter: NFilter, sort: String }
    private func key(_ s: String) -> String { s.replacingOccurrences(of: #"^(the|a|an)\s+"#, with: "", options: [.regularExpression, .caseInsensitive]).lowercased() }
    private func letter(_ s: String) -> String { let c = key(s).first.map { String($0).uppercased() } ?? "#"; return c.rangeOfCharacter(from: .letters) != nil ? c : "#" }
    private var rows: [Row] {
        var d: [String: Row] = [:]
        func bump(_ r: Row) { if d[r.id] != nil { d[r.id]!.count += 1 } else { d[r.id] = r } }
        for n in m.notes {
            switch tab {
            case "Books": if !n.bookTitle.isEmpty { bump(Row(id: n.bookTitle, label: n.bookTitle, sub: n.bookAuthor, cover: n.bookCover, letter: letter(n.bookTitle), filter: .book(n.bookTitle), sort: key(n.bookTitle))) }
            case "Authors": if !n.bookAuthor.isEmpty { let last = n.bookAuthor.split(separator: " ").last.map(String.init) ?? n.bookAuthor; bump(Row(id: n.bookAuthor, label: n.bookAuthor, letter: letter(last), filter: .author(n.bookAuthor), sort: key(last))) }
            case "Topics": for t in n.tags { bump(Row(id: t, label: "#" + t, letter: letter(t), filter: .tag(t), sort: key(t))) }
            default: let k = String(n.createdRaw.prefix(7)); if k.count == 7 { bump(Row(id: k, label: monthName(k), letter: String(k.prefix(4)), filter: .month(k), sort: k)) }
            }
        }
        return tab == "Dates" ? d.values.sorted { $0.sort > $1.sort } : d.values.sorted { $0.sort < $1.sort }
    }
    var body: some View {
        let rows = rows, loose = m.notes.filter { $0.bookTitle.isEmpty }.count
        VStack(spacing: 0) {
            PageBar(title: "Index", back: "Notes", onBack: { close() }) { EmptyView() }
            Seg(options: ["Books", "Authors", "Topics", "Dates"], value: $tab).padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 6)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                        if i == 0 || rows[i - 1].letter != r.letter { Text(r.letter).font(.sans(12, .bold)).tracking(1).foregroundStyle(T.muted).padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 4) }
                        Button { m.filter = r.filter; close() } label: {
                            HStack(spacing: 12) {
                                if tab == "Books" { NCover(title: r.label, url: r.cover, w: 26, h: 38) }
                                VStack(alignment: .leading, spacing: 1) { Text(r.label).font(.serif(17)).foregroundStyle(T.ink).multilineTextAlignment(.leading); if !r.sub.isEmpty { Text(r.sub).font(.sans(13)).foregroundStyle(T.muted) } }
                                Spacer(minLength: 0)
                                Text("\(r.count)").font(.sans(14, .semibold)).foregroundStyle(T.ink); Text("›").foregroundStyle(T.muted)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12).contentShape(Rectangle()).overlay(alignment: .bottom) { T.rule.frame(height: 1) }
                        }.buttonStyle(.plain)
                    }
                    if tab == "Books" && loose > 0 {
                        Button { m.filter = .loose; close() } label: {
                            HStack(spacing: 12) {
                                Text("—").foregroundStyle(T.ink).frame(width: 30, height: 30).background(Circle().fill(Color(rgb: 0x474a33)))
                                VStack(alignment: .leading, spacing: 1) { Text("Not linked to a book").font(.serif(17)).foregroundStyle(T.ink); Text("Thoughts and entries on their own").font(.sans(13)).foregroundStyle(T.muted) }
                                Spacer(minLength: 0)
                                Text("\(loose)").font(.sans(14, .semibold)).foregroundStyle(T.ink); Text("›").foregroundStyle(T.muted)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12).contentShape(Rectangle()).overlay(alignment: .bottom) { T.rule.frame(height: 1) }
                        }.buttonStyle(.plain)
                    }
                    if rows.isEmpty && !(tab == "Books" && loose > 0) { Text("Nothing to index yet.").font(.serif(17)).foregroundStyle(T.muted).frame(maxWidth: .infinity).padding(40) }
                }
            }
        }
        .background(T.paper.ignoresSafeArea()).preferredColorScheme(.dark)
    }
}

extension NNote {
    /// The first web link a note carries, in its Web link field or in its words: shown as a card beneath it.
    var firstLink: URL? {
        func web(_ s: String) -> URL? {
            guard let r = s.range(of: #"https?://[^\s<>\)\]]+"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
            var t = String(s[r]); while let c = t.last, ".,;:!?".contains(c) { t.removeLast() }
            return URL(string: t)
        }
        let src = source.trimmingCharacters(in: .whitespaces)
        if !src.isEmpty { return web(src) ?? (src.contains(".") && !src.contains(" ") ? URL(string: "https://" + src) : nil) }
        return web(body) ?? web(quotation)
    }
}
