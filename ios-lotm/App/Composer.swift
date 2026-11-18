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
private let LIMIT = 250

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

final class ComposeModel: ObservableObject {
    @Published var posts: [DraftPost]
    @Published var policy: String
    @Published var busy = false
    @Published var error: String?
    let name: String, avatar: URL?
    var send: (String, @escaping (String) -> Void) -> Void = { _, done in done("Not connected") }
    var close: () -> Void = {}
    private static let key = "lotm.nativeDraft"

    init(name: String, avatar: URL?) {
        self.name = name; self.avatar = avatar
        // An unsent draft (its words; photos aren't kept) comes back the next time.
        let saved = UserDefaults.standard.dictionary(forKey: Self.key)
        let texts = (saved?["texts"] as? [String]) ?? []
        posts = texts.isEmpty ? [DraftPost()] : texts.map { DraftPost(text: $0) }
        policy = (saved?["policy"] as? String) ?? "everyone"
    }
    var hasContent: Bool { posts.contains { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !$0.images.isEmpty } }
    var canPost: Bool { hasContent && !busy && !posts.contains { words($0.text) > LIMIT } }
    func saveDraft() { UserDefaults.standard.set(["texts": posts.map(\.text), "policy": policy], forKey: Self.key) }
    func clearDraft() { UserDefaults.standard.removeObject(forKey: Self.key) }

    func post() {
        guard canPost else { return }
        busy = true; error = nil
        let posts = self.posts, policy = self.policy
        DispatchQueue.global(qos: .userInitiated).async {
            let payload: [String: Any] = ["policy": policy, "posts": posts.map { ["text": $0.text, "images": $0.images.compactMap { $0.dataURL() }] }]
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
    @FocusState private var focus: UUID?
    @State private var confirmCancel = false

    private var current: DraftPost { m.posts.first { $0.id == focus } ?? m.posts[0] }

    var body: some View {
        VStack(spacing: 0) {
            // top bar
            ZStack {
                Text("New post").font(.sans(17, .bold)).foregroundStyle(C.ink)
                HStack {
                    Button("Cancel") { if m.hasContent { confirmCancel = true } else { m.close() } }
                        .font(.sans(17)).foregroundStyle(C.ink)
                    Spacer()
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
                                    splitOver: { let (a, b) = split(p.text, after: LIMIT); p.text = a
                                                 let n = DraftPost(text: b); m.posts.insert(n, at: i + 1); focus = n.id })
                                .id(p.id)
                        }
                        // Like Threads: a faded "Add to thread" under the last post
                        if !(m.posts.last?.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) || (m.posts.last?.images.isEmpty == false) {
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
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: focus) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
            }
        }
        .background(C.card.ignoresSafeArea())
        // The bottom bar sits on the keyboard and moves with it, as in X and Threads.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 12) {
                Menu {
                    Button { m.policy = "everyone" } label: { Label("Anyone in the club", systemImage: m.policy == "everyone" ? "checkmark" : "person.2") }
                    Button { m.policy = "none" } label: { Label("No one (replies off)", systemImage: m.policy == "none" ? "checkmark" : "nosign") }
                } label: {
                    Text(m.policy == "none" ? "Replies are off" : "Anyone in the club can reply")
                        .font(.sans(15)).foregroundStyle(C.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                let n = words(current.text)
                Text("\(n)/\(LIMIT)").font(.sans(14).monospacedDigit())
                    .foregroundStyle(n > LIMIT ? C.red : n > LIMIT - 30 ? C.ink : C.muted)
                Button { focus = nil; m.post() } label: {
                    Group { if m.busy { ProgressView().tint(C.paper) } else { Text("Post").font(.sans(16, .semibold)) } }
                        .frame(minWidth: 44).padding(.horizontal, 18).frame(height: 38)
                        .foregroundStyle(m.canPost ? C.paper : C.faint)
                        .background(Capsule().fill(m.canPost ? C.ink : .clear))
                        .overlay(Capsule().stroke(m.canPost ? .clear : Color(hex: 0x50533a), lineWidth: 1))
                }
                .disabled(!m.canPost)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(C.card)
            .overlay(alignment: .top) { C.rule.frame(height: 0.5) }
        }
        .tint(C.ink)
        .preferredColorScheme(.dark)
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { focus = m.posts.last?.id } }
        .onChange(of: m.posts) { _, _ in m.saveDraft() }
        .onChange(of: m.policy) { _, _ in m.saveDraft() }
        .confirmationDialog("", isPresented: $confirmCancel, titleVisibility: .hidden) {
            Button("Delete post", role: .destructive) { m.clearDraft(); m.close() }
            Button("Save draft") { m.saveDraft(); m.close() }
            Button("Keep writing", role: .cancel) {}
        }
        .alert("Couldn’t post", isPresented: Binding(get: { m.error != nil }, set: { if !$0 { m.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(m.error ?? "") }
        .interactiveDismissDisabled(m.hasContent)
    }
}

private struct PostRow: View {
    @Binding var post: DraftPost
    let index: Int, name: String, avatar: URL?, showLine: Bool
    var focus: FocusState<UUID?>.Binding
    let remove: (() -> Void)?
    let splitOver: () -> Void
    @State private var picks: [PhotosPickerItem] = []

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 6) {
                Avatar(url: avatar, name: name, size: 40)
                if showLine { C.rule.frame(width: 2).frame(maxHeight: .infinity).clipShape(Capsule()) }
            }
            .frame(width: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(name).font(.sans(16, .semibold)).foregroundStyle(C.ink)
                    Spacer()
                    if let remove { Button(action: remove) { Image(systemName: "xmark").font(.sans(13, .semibold)).foregroundStyle(C.muted).frame(width: 28, height: 28) } }
                }
                TextField(index == 0 ? "What’s on your mind?" : "Say more…", text: $post.text, axis: .vertical)
                    .font(.serif(20)).foregroundStyle(C.ink).lineSpacing(3)
                    .focused(focus, equals: post.id)
                    .textInputAutocapitalization(.sentences)
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
                                            Image(systemName: "xmark").font(.sans(12, .bold)).foregroundStyle(.white)
                                                .frame(width: 26, height: 26).background(Circle().fill(.black.opacity(0.65)))
                                        }.padding(6)
                                    }
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                let n = words(post.text)
                if n > LIMIT {
                    Button(action: splitOver) {
                        Text("Over \(LIMIT) words — continue as a thread").font(.sans(15, .semibold)).foregroundStyle(C.red)
                    }.padding(.top, 4)
                }
                // tools for this post
                HStack(spacing: 22) {
                    PhotosPicker(selection: $picks, maxSelectionCount: max(1, 10 - post.images.count), matching: .images) {
                        Image(systemName: "photo.on.rectangle").font(.sans(19))
                    }
                    .disabled(post.images.count >= 10)
                }
                .foregroundStyle(C.muted)
                .padding(.top, 10).padding(.bottom, 18)
                .onChange(of: picks) { _, items in
                    guard !items.isEmpty else { return }
                    Task {
                        var out: [UIImage] = []
                        for it in items { if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { out.append(img) } }
                        await MainActor.run { withAnimation(.snappy) { post.images.append(contentsOf: out.prefix(10 - post.images.count)) }; picks = [] }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
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
    func present(name: String, avatar: URL?) {
        let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
        var top = root; while let p = top?.presentedViewController { top = p }
        guard let top, !(top is UIHostingController<ComposeView>) else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        let model = ComposeModel(name: name, avatar: avatar)
        let vc = UIHostingController(rootView: ComposeView(m: model))
        vc.overrideUserInterfaceStyle = .dark
        vc.view.backgroundColor = UIColor(red: 0.255, green: 0.271, blue: 0.188, alpha: 1)
        vc.modalPresentationStyle = .pageSheet
        vc.sheetPresentationController?.prefersGrabberVisible = false
        model.close = { [weak vc] in vc?.dismiss(animated: true) }
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
