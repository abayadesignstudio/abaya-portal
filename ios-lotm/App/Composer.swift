import SwiftUI
import PhotosUI
import WebKit

// The post composer, built natively so writing feels exactly like X and Threads: Apple's own text editing (selection,
// cursor, autocorrect), a bar that rides the keyboard, and the Photos picker. The finished post goes back to the web
// app (window.lotmNativePost), which publishes it, so every post is made the same way.

private extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255) }
}
private enum C {
    static let card = Color(hex: 0x414530), paper = Color(hex: 0x3b3e2a), ink = Color(hex: 0xf1eedd)
    static let muted = Color(hex: 0xc3c3a6), rule = Color(hex: 0x4d4f37), red = Color(hex: 0xe7907f), faint = Color(hex: 0x626546)
}
private let LIMIT = 100

struct DraftPost: Identifiable, Equatable {
    let id = UUID()
    var text = ""
    var images: [UIImage] = []
    static func == (a: DraftPost, b: DraftPost) -> Bool { a.id == b.id && a.text == b.text && a.images.count == b.images.count }
}

private func words(_ t: String) -> Int { t.split(whereSeparator: { $0.isWhitespace }).count }
/// Split after the first n words, keeping the writer's own spacing and line breaks.
private func split(_ t: String, after n: Int) -> (String, String) {
    var count = 0, inWord = false, cut = t.endIndex
    for i in t.indices {
        let ws = t[i].isWhitespace
        if !ws && !inWord { count += 1; if count == n + 1 { cut = i; break } }
        inWord = !ws
    }
    let trim = { (s: Substring) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
    return (trim(t[..<cut]), trim(t[cut...]))
}
private extension UIImage {
    /// Photos go up at most 2048 px on the long side, as JPEG.
    func dataURL() -> String? {
        let longSide = max(size.width, size.height), scale = min(1, 2048 / max(longSide, 1))
        let out = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: out, format: fmt).image { _ in draw(in: CGRect(origin: .zero, size: out)) }
        return img.jpegData(compressionQuality: 0.82).map { "data:image/jpeg;base64," + $0.base64EncodedString() }
    }
}

private struct CamTarget: Identifiable { let id: UUID }
struct ComposeBook: Identifiable, Equatable { var id: String { title }; let title: String, author: String?, cover: URL? }

final class ComposeModel: ObservableObject {
    @Published var posts: [DraftPost]
    @Published var policy: String
    @Published var busy = false
    @Published var error: String?
    let name: String, avatar: URL?
    // the first post's extras, as in the web composer
    @Published var link = ""
    @Published var quote: String? = nil
    @Published var book: ComposeBook? = nil
    @Published var tags: [String] = []
    @Published var poll: [String]? = nil
    @Published var pollDays = 3
    /// Where this goes: out to the feed, or into your private notebook. One composer serves both.
    @Published var toNotes = false
    @Published var noteTitle = ""
    var auth: () async -> SupaAuth? = { nil }
    var send: (String, @escaping (String) -> Void) -> Void = { _, done in done("Not connected") }
    var close: () -> Void = {}
    var article: () -> Void = {}
    private static let key = "lotm.nativeDraft"

    init(name: String, avatar: URL?) {
        self.name = name; self.avatar = avatar
        // An unsent draft (its words; photos aren't kept) comes back the next time.
        let saved = UserDefaults.standard.dictionary(forKey: Self.key)
        let texts = (saved?["texts"] as? [String]) ?? []
        posts = texts.isEmpty ? [DraftPost()] : texts.map { DraftPost(text: $0) }
        policy = (saved?["policy"] as? String) ?? "everyone"
    }
    var hasContent: Bool { posts.contains { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !$0.images.isEmpty } || !(quote ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    var canPost: Bool { hasContent && !busy && (toNotes || !posts.contains { words($0.text) > LIMIT }) }
    func saveDraft() { UserDefaults.standard.set(["texts": posts.map(\.text), "policy": policy], forKey: Self.key) }
    func clearDraft() { UserDefaults.standard.removeObject(forKey: Self.key) }

    /// Kept in the notebook instead: the words as a thought (or, with a passage, a quote), with its photo, book, topics and link.
    private func saveNote() {
        busy = true; error = nil
        var n = NNote(id: "")
        let qt = (quote ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        n.kind = qt.isEmpty ? "thought" : "quote"; n.quotation = qt; n.title = noteTitle
        n.body = posts.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        n.bookTitle = book?.title ?? ""; n.bookAuthor = book?.author ?? ""; n.bookCover = book?.cover?.absoluteString
        n.tags = tags; n.source = link.trimmingCharacters(in: .whitespaces)
        let photo = posts.flatMap(\.images).first
        Task { @MainActor in
            let notes = NotesModel.shared
            if let photo { n.image = await notes.upload(photo) }
            if await notes.save(n, new: true) { UINotificationFeedbackGenerator().notificationOccurred(.success); self.noteTitle = ""; self.clearDraft(); self.close() }
            else { self.error = notes.toast ?? "The note couldn’t be saved." }
            self.busy = false
        }
    }
    func post() {
        guard canPost else { return }
        if toNotes { saveNote(); return }
        busy = true; error = nil
        let posts = self.posts, policy = self.policy
        var extras: [String: Any] = ["link": link, "quote": quote ?? "", "tags": tags]
        if let b = book { extras["book"] = ["title": b.title, "author": b.author ?? "", "cover": b.cover?.absoluteString ?? ""] }
        if let p = poll { extras["poll"] = ["options": p, "days": pollDays] }
        DispatchQueue.global(qos: .userInitiated).async {
            let payload: [String: Any] = ["policy": policy, "extras": extras, "posts": posts.map { ["text": $0.text, "images": $0.images.compactMap { $0.dataURL() }] }]
            let json = (try? JSONSerialization.data(withJSONObject: payload)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            DispatchQueue.main.async {
                self.send(json) { result in
                    self.busy = false
                    if result == "ok" { UINotificationFeedbackGenerator().notificationOccurred(.success); self.clearDraft(); self.close(); NotificationCenter.default.post(name: .lotmFeedChanged, object: nil) }
                    else { self.error = result }
                }
            }
        }
    }
}

struct ComposeView: View {
    @ObservedObject var m: ComposeModel
    @State private var focus: UUID?
    @State private var confirmCancel = false
    @State private var sheet: ComposeSheet?
    @State private var cameraFor: UUID?

    private var current: DraftPost { m.posts.first { $0.id == focus } ?? m.posts[0] }

    var body: some View {
        VStack(spacing: 0) {
            // top bar
            ZStack {
                // One composer for both: out to the feed, or into your private notebook.
                HStack(spacing: 0) {
                    ForEach([false, true], id: \.self) { notes in
                        let on = m.toNotes == notes
                        Button { UISelectionFeedbackGenerator().selectionChanged(); withAnimation(.snappy(duration: 0.22)) { m.toNotes = notes } } label: {
                            Text(notes ? "Note" : "Post").font(.sans(14, on ? .bold : .regular)).foregroundStyle(C.ink).frame(width: 62, height: 30)
                                .background(Capsule().fill(on ? Color(hex: 0x50533a) : .clear)).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                .padding(2).background(Capsule().fill(Color(hex: 0x0c0e08).opacity(0.18)))
                HStack {
                    Button("Cancel") { flushTyping(); if m.hasContent { confirmCancel = true } else { m.close() } }
                        .font(.sans(17)).foregroundStyle(C.ink)
                    Spacer()
                    // Longer writing — title, headings, cover — goes to the article editor.
                    Button { flushTyping(); m.saveDraft(); m.article() } label: {
                        HStack(spacing: 6) { GlyphView(n: "pencil", s: 15, w: 2); Text("Article").font(.sans(15, .semibold)) }
                            .foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 32)
                            .overlay(Capsule().stroke(Color(hex: 0x50533a), lineWidth: 1))
                    }
                    .opacity(m.toNotes ? 0 : 1).disabled(m.toNotes)
                }
            }
            .padding(.horizontal, 16).frame(height: 54)
            .overlay(alignment: .bottom) { C.rule.frame(height: 0.5) }

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach($m.posts) { $p in
                            let i = m.posts.firstIndex(where: { $0.id == p.id }) ?? 0
                            PostRow(post: $p, index: i, name: m.name, avatar: m.avatar, showLine: true, focus: $focus,
                                    remove: i > 0 ? { withAnimation(.snappy) { m.posts.removeAll { $0.id == p.id } } } : nil,
                                    splitOver: { flushTyping(); let (a, b) = split(p.text, after: LIMIT); p.text = a
                                                 let n = DraftPost(text: b); m.posts.insert(n, at: i + 1); focus = n.id },
                                    m: m, openSheet: { focus = nil; sheet = $0 }, camera: { cameraFor = p.id })
                                .id(p.id)
                        }
                        // Like Threads: a faded "Add to thread" under the last post
                        if !m.toNotes, !(m.posts.last?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) || (m.posts.last?.images.isEmpty == false) {
                            Button {
                                let n = DraftPost(); withAnimation(.snappy) { m.posts.append(n) }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { focus = n.id; withAnimation { proxy.scrollTo(n.id, anchor: .bottom) } }
                            } label: {
                                HStack(spacing: 22) {
                                    Avatar(url: m.avatar, name: m.name, size: 22).opacity(0.55).frame(width: 40)
                                    Text("Add to thread").font(.sans(16, .semibold)).foregroundStyle(C.muted)
                                    Spacer()
                                }
                            }
                            .padding(.leading, 16).padding(.top, 4).padding(.bottom, 24)
                        }
                    }
                    .padding(.top, 16)
                }
                // The keyboard stays while the page is scrolled, as in X: Cancel or Post puts it away.
                .scrollDismissesKeyboard(.never)
            }
        }
        .background(C.card.ignoresSafeArea())
        // The bottom bar sits on the keyboard and moves with it, as in X and Threads.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
            MentionBar(text: Binding(get: { current.text }, set: { v in if let k = m.posts.firstIndex(where: { $0.id == current.id }) { m.posts[k].text = v } })).background(C.card)
            HStack(spacing: 12) {
                // Who can reply: one tap switches between Anyone and No one.
                Button { UISelectionFeedbackGenerator().selectionChanged(); withAnimation(.snappy(duration: 0.2)) { m.policy = m.policy == "none" ? "everyone" : "none" } } label: {
                    let off = m.policy == "none"
                    HStack(spacing: 6) {
                        GlyphView(n: off ? "mute" : "reply", s: 15, w: 2)
                        Text(off ? "No one can reply" : "Anyone can reply").font(.sans(14, .semibold)).contentTransition(.opacity)
                    }
                    .foregroundStyle(off ? C.muted : C.ink).padding(.horizontal, 12).frame(height: 32)
                    .background(Capsule().fill(off ? .clear : Color(hex: 0x50533a)))
                    .overlay(Capsule().stroke(Color(hex: 0x50533a), lineWidth: 1))
                }
                .accessibilityLabel(m.policy == "none" ? "Replies off. Tap to let anyone reply." : "Anyone can reply. Tap to turn replies off.")
                .opacity(m.toNotes ? 0 : 1).disabled(m.toNotes)
                .overlay(alignment: .leading) { if m.toNotes { HStack(spacing: 6) { Image(systemName: "lock.fill").font(.system(size: 11)); Text("Only you see this").font(.sans(14, .semibold)) }.foregroundStyle(C.muted).fixedSize() } }
                Spacer(minLength: 8)
                let n = words(current.text)
                Text("\(n)/\(LIMIT)").font(.sans(14).monospacedDigit())
                    .foregroundStyle(n > LIMIT ? C.red : n > LIMIT - 30 ? C.ink : C.muted).opacity(m.toNotes ? 0 : 1)
                Button { flushTyping(); focus = nil; m.post() } label: {
                    Group { if m.busy { ProgressView().tint(C.paper) } else { Text(m.toNotes ? "Save" : "Post").font(.sans(16, .semibold)) } }
                        .frame(minWidth: 44).padding(.horizontal, 18).frame(height: 38)
                        .foregroundStyle(m.canPost ? C.paper : C.faint)
                        .background(Capsule().fill(m.canPost ? C.ink : .clear))
                        .overlay(Capsule().stroke(m.canPost ? .clear : Color(hex: 0x50533a), lineWidth: 1))
                }
                .disabled(!m.canPost)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(C.card)
            .overlay(alignment: .top) { C.rule.frame(height: 0.5) }            }
        }
        .tint(C.ink)
        .preferredColorScheme(.dark)
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { focus = m.posts.last?.id } }
        // The draft is kept a moment after the typing pauses, not on every letter.
        .task(id: m.posts.map(\.text)) { try? await Task.sleep(nanoseconds: 700_000_000); if !Task.isCancelled { m.saveDraft() } }
        .onChange(of: m.policy) { _, _ in m.saveDraft() }
        .confirmationDialog("", isPresented: $confirmCancel, titleVisibility: .hidden) {
            Button("Delete post", role: .destructive) { m.clearDraft(); m.close() }
            Button("Save draft") { m.saveDraft(); m.close() }
            Button("Keep writing", role: .cancel) {}
        }
        .alert(m.toNotes ? "Couldn’t save" : "Couldn’t post", isPresented: Binding(get: { m.error != nil }, set: { if !$0 { m.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(m.error ?? "") }
        .interactiveDismissDisabled(m.hasContent)
        .sheet(item: $sheet) { s in
            Group {
                switch s {
                case .link: LinkSheet(m: m)
                case .book: BookSheet(m: m)
                case .tags: TagSheet(m: m)
                }
            }
            .presentationDetents(s == .link ? [.medium] : [.medium, .large])
        }
        .fullScreenCover(item: Binding(get: { cameraFor.map { CamTarget(id: $0) } }, set: { cameraFor = $0?.id })) { t in
            CameraPicker { img in
                if let img, let k = m.posts.firstIndex(where: { $0.id == t.id }) { m.posts[k].images.append(img) }
                cameraFor = nil
            }
            .ignoresSafeArea()
        }
    }
}

private struct PostRow: View {
    @Binding var post: DraftPost
    let index: Int, name: String, avatar: URL?, showLine: Bool
    @Binding var focus: UUID?
    let remove: (() -> Void)?
    let splitOver: () -> Void
    @ObservedObject var m: ComposeModel
    let openSheet: (ComposeSheet) -> Void
    let camera: () -> Void
    @State private var picks: [PhotosPickerItem] = []
    @FocusState private var quoteFocus: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 6) {
                Avatar(url: avatar, name: name, size: 40)
                if showLine { C.rule.frame(width: 2).frame(maxHeight: .infinity).clipShape(Capsule()) }
            }
            .frame(width: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(name).font(.sans(17, .semibold)).foregroundStyle(C.ink)
                    Spacer()
                    if let remove { Button(action: remove) { Text("×").font(.sans(20)).foregroundStyle(C.muted).frame(width: 28, height: 28) } }
                }
                if index == 0, m.toNotes { TextField("", text: $m.noteTitle, prompt: Text("Title").foregroundColor(C.muted), axis: .vertical).font(.serif(23, .semibold)).foregroundStyle(C.ink).padding(.trailing, 14).padding(.top, 2) }
                // Apple's own text view: as the writing grows, the page keeps the cursor's line above the keyboard.
                CaretText(text: $post.text, hint: index == 0 ? "What’s on your mind?" : "Say more…", size: 22, active: focus == post.id, bar: false, below: 84,
                          onFocus: { on in let id = post.id; DispatchQueue.main.async { if on { focus = id } else if focus == id { focus = nil } } })
                    .padding(.trailing, 14)      // room between the words and the edge of the screen
                if index == 0 { extras }
                if !post.images.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(post.images.enumerated()), id: \.offset) { k, img in
                                Image(uiImage: img).resizable().scaledToFill()
                                    .frame(width: post.images.count > 1 ? 150 : 260, height: post.images.count > 1 ? 190 : 300).clipped()
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(C.rule, lineWidth: 1))
                                    .overlay(alignment: .topTrailing) {
                                        Button { withAnimation(.snappy) { _ = post.images.remove(at: k) } } label: {
                                            Text("×").font(.sans(16)).foregroundStyle(.white).frame(width: 26, height: 26).background(Circle().fill(Color(rgb: 0x0a0c06, 0.72)))
                                        }.padding(6)
                                    }
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                let n = words(post.text)
                if n > LIMIT && !m.toNotes {
                    Button(action: splitOver) {
                        Text("Over \(LIMIT) words — continue as a thread").font(.sans(15, .semibold)).foregroundStyle(C.red)
                    }.padding(.top, 4)
                }
                tools
            }
        }
        .padding(.horizontal, 16)
    }

    // A quoted passage, the tagged book, topics, a poll and a link card: the first post's extras.
    @ViewBuilder private var extras: some View {
        if let q = m.quote {
            HStack(alignment: .top, spacing: 0) {
                C.ink.frame(width: 3)
                TextField("Quote a passage", text: Binding(get: { q }, set: { m.quote = $0 }), axis: .vertical)
                    .font(.serif(21, italic: true)).foregroundStyle(C.ink).focused($quoteFocus).padding(.leading, 14)
                Button { withAnimation(.snappy) { m.quote = nil }; focus = post.id } label: {
                    Text("×").font(.sans(15)).foregroundStyle(C.ink).frame(width: 24, height: 24).background(Circle().fill(Color(rgb: 0x0c0e08, 0.08)))
                }
            }
            .fixedSize(horizontal: false, vertical: true).padding(.vertical, 6)
            .onAppear { if q.isEmpty { quoteFocus = true } }
        }
        if let b = m.book {
            HStack(spacing: 10) {
                AsyncImage(url: b.cover) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0xc9c7af) }.frame(width: 26, height: 38).clipShape(RoundedRectangle(cornerRadius: 3))
                VStack(alignment: .leading, spacing: 1) {
                    Text(b.title).font(.serif(14, italic: true)).foregroundStyle(C.ink)
                    Text([b.author, "tagged book"].compactMap { $0 }.joined(separator: " · ")).font(.sans(12)).foregroundStyle(C.muted)
                }
                Spacer(minLength: 0)
                Button { m.book = nil } label: { Text("×").font(.sans(16)).foregroundStyle(C.ink).frame(width: 28, height: 28).background(Circle().fill(Color(rgb: 0x0c0e08, 0.08))) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x444530))).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(rgb: 0x54563c)))
            .padding(.top, 8)
        }
        if let p = m.poll { pollEditor(p) }
        if !m.tags.isEmpty {
            HStack(spacing: 10) { ForEach(m.tags, id: \.self) { t in Button { m.tags.removeAll { $0 == t } } label: { Text("#\(t) ×").font(.sans(13)).foregroundStyle(Color(rgb: 0xd0ceb9)) } } }.padding(.top, 6)
        }
        if let u = URL(string: m.link.trimmingCharacters(in: .whitespaces)), !m.link.isEmpty {
            LinkCard(url: u).overlay(alignment: .topTrailing) {
                Button { m.link = "" } label: { Text("×").font(.sans(15)).foregroundStyle(.white).frame(width: 26, height: 26).background(Circle().fill(Color(rgb: 0x0a0c06, 0.72))) }.padding(8)
            }
            .padding(.top, 8)
        }
    }
    private func pollEditor(_ p: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(p.indices, id: \.self) { i in
                TextField("Choice \(i + 1)", text: Binding(get: { m.poll?[safe: i] ?? "" }, set: { v in if m.poll != nil, i < m.poll!.count { m.poll![i] = v } }))
                    .font(.sans(15)).foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color(rgb: 0x3b3e2a))).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(rgb: 0x50533a)))
            }
            HStack(spacing: 8) {
                if p.count < 4 { Button("Add choice") { m.poll?.append("") }.buttonStyle(SmallGhost()) }
                Menu {
                    ForEach([1, 3, 7], id: \.self) { d in Button("\(d) day\(d > 1 ? "s" : "")") { m.pollDays = d } }
                } label: { Text("\(m.pollDays) day\(m.pollDays > 1 ? "s" : "") ▾").font(.sans(14)).foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 32).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(rgb: 0x50533a))) }
                Spacer()
                Button("Remove") { withAnimation(.snappy) { m.poll = nil } }.buttonStyle(SmallGhost())
            }
        }
        .padding(12).overlay(RoundedRectangle(cornerRadius: 14).stroke(C.rule)).padding(.top, 8)
    }

    // The web composer's toolbar: photo, camera, link, quote, book, topics, poll (the extras belong to the first post).
    private var tools: some View {
        HStack(spacing: 2) {
            PhotosPicker(selection: $picks, maxSelectionCount: max(1, 10 - post.images.count), matching: .images) { tool("image") }
                .disabled(post.images.count >= 10)
            Button(action: camera) { tool("camera") }
            if index == 0 {
                Button { openSheet(.link) } label: { tool("link") }.foregroundStyle(m.link.isEmpty ? C.muted : C.ink)
                Button { withAnimation(.snappy) { if m.quote == nil { m.quote = "" } else { quoteFocus = true } } } label: { tool("quote2") }
                Button { openSheet(.book) } label: { tool("book") }.foregroundStyle(m.book == nil ? C.muted : C.ink)
                Button { openSheet(.tags) } label: { tool("hash") }.foregroundStyle(m.tags.isEmpty ? C.muted : C.ink)
            }
            Button { listTool("bullet") } label: { Image(systemName: "list.bullet").font(.system(size: 19)).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }.accessibilityLabel("Bullet list")
            Button { listTool("number") } label: { Image(systemName: "list.number").font(.system(size: 19)).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }.accessibilityLabel("Numbered list")
            Spacer(minLength: 0)
        }
        .foregroundStyle(C.muted)
        .padding(.leading, -8).padding(.top, 8).padding(.bottom, 18)
        .onChange(of: picks) { _, items in
            guard !items.isEmpty else { return }
            Task {
                var out: [UIImage] = []
                for it in items { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { out.append(img) } }
                await MainActor.run { withAnimation(.snappy) { post.images.append(contentsOf: out.prefix(10 - post.images.count)) }; picks = [] }
            }
        }
    }
    private func tool(_ n: String) -> some View { GlyphView(n: n, s: 24).frame(minWidth: 30, maxWidth: 44).frame(height: 42).contentShape(Rectangle()) }
}

private struct SmallGhost: ButtonStyle {
    func makeBody(configuration c: Configuration) -> some View {
        c.label.font(.sans(14)).foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 32).overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(rgb: 0x50533a))).opacity(c.isPressed ? 0.7 : 1)
    }
}
private extension Array { subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil } }

enum ComposeSheet: String, Identifiable { case link, book, tags; var id: String { rawValue } }

/// Add a link: the post shows its card.
private struct LinkSheet: View {
    @ObservedObject var m: ComposeModel
    @State private var draft = ""
    @Environment(\.dismiss) private var dismiss
    @FocusState private var f: Bool
    private var fixed: String { let t = draft.trimmingCharacters(in: .whitespaces); return t.isEmpty ? "" : (t.lowercased().hasPrefix("http") ? t : "https://" + t) }
    private var ok: Bool { fixed.range(of: #"^https?://[^/\s]+\.[^/\s]{2,}"#, options: .regularExpression) != nil }
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 12) {
                Text("Add a link").font(.serif(20, .semibold)).foregroundStyle(C.ink)
                TextField("", text: $draft, prompt: Text("Paste or type a web address").foregroundColor(C.muted)).focused($f)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.done).onSubmit { if ok { m.link = fixed; dismiss() } }
                    .font(.sans(16)).foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x3b3e2a))).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(rgb: 0x50533a)))
                if ok, let u = URL(string: fixed) { LinkCard(url: u) }
                Button { m.link = fixed; dismiss() } label: { Text(m.link.isEmpty ? "Add link" : "Update link").font(.sans(16, .semibold)).foregroundStyle(C.paper).frame(maxWidth: .infinity).frame(height: 48).background(RoundedRectangle(cornerRadius: 14).fill(ok ? C.ink : C.muted.opacity(0.4))) }.disabled(!ok)
                if !m.link.isEmpty { Button { m.link = ""; dismiss() } label: { Text("Remove link").font(.sans(16)).foregroundStyle(C.ink).frame(maxWidth: .infinity).frame(height: 44) } }
            }
            .padding(.horizontal, 20)
        }
        .onAppear { draft = m.link; f = true }
    }
}

/// Tag a book from your library, the club's books and books read.
private struct BookSheet: View {
    @ObservedObject var m: ComposeModel
    @State private var q = ""
    @State private var books: [ComposeBook] = []
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 10) {
                Text("Tag a book").font(.serif(20, .semibold)).foregroundStyle(C.ink).padding(.horizontal, 20)
                TextField("", text: $q, prompt: Text("Search your library").foregroundColor(C.muted)).font(.sans(16)).foregroundStyle(C.ink)
                    .padding(.horizontal, 12).frame(height: 44).background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x3b3e2a))).padding(.horizontal, 20)
                Card14 {
                    ForEach(Array(books.filter { q.isEmpty || $0.title.localizedCaseInsensitiveContains(q) || ($0.author ?? "").localizedCaseInsensitiveContains(q) }.enumerated()), id: \.element.id) { k, b in
                        if k > 0 { GroupLine() }
                        Button { m.book = b; Haptic.tap(); dismiss() } label: {
                            HStack(spacing: 12) {
                                AsyncImage(url: b.cover) { $0.resizable().scaledToFill() } placeholder: { Color(rgb: 0x9c5463) }.frame(width: 30, height: 44).clipShape(RoundedRectangle(cornerRadius: 3))
                                VStack(alignment: .leading, spacing: 1) { Text(b.title).font(.serif(16)).foregroundStyle(C.ink).multilineTextAlignment(.leading); if let a = b.author { Text(a).font(.sans(12)).foregroundStyle(C.muted) } }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16).frame(minHeight: 60).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .task { await load() }
    }
    @MainActor private func load() async {
        guard let a = await m.auth() else { return }; let db = Supa(a: a)
        async let R = db.rows("/rest/v1/current_reads?user_id=eq.\(a.me)&select=custom_title,custom_author,custom_cover_url,editions(title,author,cover_url)")
        async let U = db.rows("/rest/v1/club_updates?select=book_title,book_author,cover_url&order=created_at.desc&limit=40")
        async let B = db.rows("/rest/v1/books_read?select=title,author,cover_url")
        guard let res = try? await (R, U, B) else { return }
        let (r, u, b) = res
        var seen = Set<String>(), out: [ComposeBook] = []
        func add(_ t: String?, _ au: String?, _ c: String?) {
            guard let t, !t.isEmpty else { return }
            let clean = t.replacingOccurrences(of: #"^Amazon\.com:\s*"#, with: "", options: .regularExpression).components(separatedBy: ":").prefix(2).joined(separator: ":").trimmingCharacters(in: .whitespaces)
            if seen.insert(clean.lowercased()).inserted { out.append(ComposeBook(title: clean, author: au, cover: c.flatMap(URL.init(string:)))) }
        }
        for x in r { let e = x["editions"] as? [String: Any]; add((e?["title"] as? String) ?? (x["custom_title"] as? String), (e?["author"] as? String) ?? (x["custom_author"] as? String), (e?["cover_url"] as? String) ?? (x["custom_cover_url"] as? String)) }
        for x in u { add(x["book_title"] as? String, x["book_author"] as? String, x["cover_url"] as? String) }
        for x in b { add(x["title"] as? String, x["author"] as? String, x["cover_url"] as? String) }
        books = out
    }
}

/// Topics (#tags): type one, or pick from those already in use.
private struct TagSheet: View {
    @ObservedObject var m: ComposeModel
    @State private var draft = ""
    @State private var known: [String] = []
    @FocusState private var f: Bool
    private func add(_ t: String) {
        let c = t.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "").lowercased().replacingOccurrences(of: " ", with: "-")
        if !c.isEmpty && !m.tags.contains(c) { m.tags.append(c); Haptic.tap() }
        draft = ""
    }
    var body: some View {
        SheetBody {
            VStack(alignment: .leading, spacing: 12) {
                Text("Topics").font(.serif(20, .semibold)).foregroundStyle(C.ink)
                TextField("", text: $draft, prompt: Text("Add a topic").foregroundColor(C.muted)).focused($f).submitLabel(.done).onSubmit { add(draft) }
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.sans(16)).foregroundStyle(C.ink).padding(.horizontal, 12).frame(height: 46).background(RoundedRectangle(cornerRadius: 12).fill(Color(rgb: 0x3b3e2a)))
                if !m.tags.isEmpty {
                    FlowTags(tags: m.tags.map { "#\($0) ×" }) { i in m.tags.remove(at: i) }
                }
                let pick = known.filter { !m.tags.contains($0) && (draft.isEmpty || $0.contains(draft.lowercased())) }
                if !pick.isEmpty {
                    Eyebrow(t: "In use")
                    FlowTags(tags: pick.prefix(16).map { "#\($0)" }) { i in add(Array(pick.prefix(16))[i]) }
                }
            }
            .padding(.horizontal, 20)
        }
        .onAppear { f = true }
        .task {
            guard let a = await m.auth(), let rows = try? await Supa(a: a).rows("/rest/v1/aside_tags?select=tag&limit=400") else { return }
            var c: [String: Int] = [:]; for r in rows { if let t = r["tag"] as? String { c[t, default: 0] += 1 } }
            known = c.sorted { $0.value > $1.value }.map(\.key)
        }
    }
}
private struct FlowTags: View {
    let tags: [String]
    let tap: (Int) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8, alignment: .leading)], alignment: .leading, spacing: 8) {
            ForEach(Array(tags.enumerated()), id: \.offset) { i, t in
                Button { tap(i) } label: { Text(t).font(.sans(14, .semibold)).foregroundStyle(C.ink).lineLimit(1).padding(.horizontal, 12).frame(height: 32).background(Capsule().fill(Color(rgb: 0x454832))) }.buttonStyle(.plain)
            }
        }
    }
}

/// The camera, for a photo straight into the post.
struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ p: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { done(info[.originalImage] as? UIImage) }
        func imagePickerControllerDidCancel(_ p: UIImagePickerController) { done(nil) }
    }
}

private struct Avatar: View {
    let url: URL?, name: String, size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: 0x2d301f))
            Text(name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased())
                .font(.sans(size * 0.36, .semibold)).foregroundStyle(C.ink)
            if let url { AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
        }
        .frame(width: size, height: size).clipShape(Circle())
    }
}

/// window.webkit.messageHandlers.compose.postMessage('{"name":…,"avatar":…}') → the composer slides up.
final class ComposeHandler: NSObject, WKScriptMessageHandler {
    weak var web: WKWebView?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        let info = (m.body as? String).flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let name = info["name"] as? String ?? "", avatar = (info["avatar"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
        DispatchQueue.main.async { self.present(name: name, avatar: avatar) }
    }
    func present(name: String, avatar: URL?, text: String = "", toNotes: Bool = false) {
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        var top = root; while let p = top?.presentedViewController { top = p }
        guard let top, !(top is UIHostingController<ComposeView>) else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let model = ComposeModel(name: name, avatar: avatar)
        if !text.isEmpty, !model.posts.isEmpty { model.posts[0].text = text }
        model.toNotes = toNotes
        model.auth = { [weak self] in await webAuth(self?.web) }
        NotesModel.shared.alt = model.auth
        let vc = UIHostingController(rootView: ComposeView(m: model))
        vc.overrideUserInterfaceStyle = .dark
        vc.view.backgroundColor = UIColor(red: 0.255, green: 0.271, blue: 0.188, alpha: 1)
        vc.modalPresentationStyle = .pageSheet
        vc.sheetPresentationController?.prefersGrabberVisible = false
        model.close = { [weak vc] in vc?.dismiss(animated: true) }
        model.article = { [weak vc, weak self] in
            vc?.dismiss(animated: true) { self?.web?.evaluateJavaScript("window.lotmNativeGo && window.lotmNativeGo('/write?mode=article')") }
        }
        model.send = { [weak self] json, done in
            guard let web = self?.web else { return done("The app isn’t ready. Try again.") }
            web.callAsyncJavaScript("if (!window.lotmNativePost) return 'Update the app, then try again.'; return await window.lotmNativePost(p)",
                                    arguments: ["p": json], in: nil, in: .page) { r in
                switch r {
                case .success(let v): done((v as? String) ?? "ok")
                case .failure(let e): done(e.localizedDescription)
                }
            }
        }
        top.present(vc, animated: true)
    }
}
