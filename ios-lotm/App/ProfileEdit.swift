import SwiftUI
import PhotosUI

// Edit profile, as its own page (laid out like Twitter's): the banner with your photo over it, each one tapped to
// choose a new picture or reframe the one you have; then your name and bio.

extension Notification.Name { static let lotmProfileChanged = Notification.Name("lotm.profileChanged") }

/// Open the page over whatever is showing.
@MainActor func openProfileEdit(_ feed: FeedModel) { presentSlide(ProfileEditScreen(feed: feed)) }

private struct CropJob: Identifiable { let id = UUID(); let image: UIImage; let banner: Bool }

struct ProfileEditScreen: View {
    @ObservedObject var feed: FeedModel
    @Environment(\.closeScreen) private var close
    @State private var name = ""
    @State private var bio = ""
    @State private var avatarURL: URL?
    @State private var bannerURL: URL?
    @State private var newAvatar: UIImage?
    @State private var newBanner: UIImage?
    @State private var loaded = false
    @State private var busy = false
    @State private var error: String?
    @State private var menuFor: Bool?                 // true = banner, false = photo
    @State private var picking: Bool?
    @State private var pick: PhotosPickerItem?
    @State private var job: CropJob?
    private var changed: Bool { loaded && !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { close() }.font(.sans(16)).foregroundStyle(T.ink)
                Spacer()
                Button { save() } label: {
                    Group { if busy { ProgressView().tint(T.paper) } else { Text("Save").font(.sans(14, .bold)) } }
                        .foregroundStyle(T.paper).padding(.horizontal, 18).frame(height: 36).background(Capsule().fill(T.ink))
                }.disabled(busy || !changed).opacity(changed ? 1 : 0.5)
            }
            .overlay(Text("Edit profile").font(.sans(17, .bold)).foregroundStyle(T.ink))
            .padding(.horizontal, 16).frame(height: 54).overlay(alignment: .bottom) { T.rule.frame(height: 1) }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // the banner, three wide to one high
                    Button { menuFor = true } label: {
                        ZStack {
                            LinearGradient(colors: [Color(rgb: 0x2d301f), Color(rgb: 0x4b4e36)], startPoint: .topLeading, endPoint: .bottomTrailing)
                            if let i = newBanner { Image(uiImage: i).resizable().scaledToFill() }
                            else if let u = bannerURL { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Color.clear } }
                            Color.black.opacity(0.28)
                            badge
                        }
                        .frame(maxWidth: .infinity).aspectRatio(3, contentMode: .fit).clipped().contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityLabel("Change banner")
                    Button { menuFor = false } label: {
                        ZStack {
                            if let i = newAvatar { Image(uiImage: i).resizable().scaledToFill().frame(width: 84, height: 84).clipShape(Circle()) }
                            else { Face(name: name, url: avatarURL, s: 84) }
                            Circle().fill(Color.black.opacity(0.3)).frame(width: 84, height: 84)
                            badge
                        }
                        .padding(4).background(Circle().fill(T.paper))
                    }
                    .buttonStyle(.plain).padding(.leading, 16).padding(.top, -46).accessibilityLabel("Change photo")
                    VStack(alignment: .leading, spacing: 16) {
                        field("Name") { TextField("", text: $name).font(.sans(17)).foregroundStyle(T.ink).textInputAutocapitalization(.words) }
                        field("Bio") { TextField("", text: $bio, prompt: Text("A line about you").foregroundColor(T.muted), axis: .vertical).font(.sans(17)).foregroundStyle(T.ink).lineLimit(3...6) }
                        Text("\(bio.count)/160").font(.sans(12)).foregroundStyle(bio.count > 160 ? T.danger : T.muted).frame(maxWidth: .infinity, alignment: .trailing).padding(.top, -10)
                        if let error { Text(error).font(.sans(14)).foregroundStyle(T.danger) }
                    }
                    .padding(.horizontal, 20).padding(.top, 18)
                    Color.clear.frame(height: 80)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(T.paper.ignoresSafeArea()).preferredColorScheme(.dark).tint(T.ink)
        .task { await load() }
        .confirmationDialog(menuFor == true ? "Banner" : "Profile photo", isPresented: Binding(get: { menuFor != nil }, set: { if !$0 { menuFor = nil } }), titleVisibility: .visible) {
            let banner = menuFor == true
            Button("Choose a new picture") { picking = banner }
            if (banner ? (newBanner != nil || bannerURL != nil) : (newAvatar != nil || avatarURL != nil)) { Button("Reframe this one") { reframe(banner) } }
        }
        .photosPicker(isPresented: Binding(get: { picking != nil }, set: { if !$0, pick == nil { picking = nil } }), selection: $pick, matching: .images)
        .onChange(of: pick) { _, it in
            guard let it else { return }
            let banner = picking == true
            Task {
                if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { job = CropJob(image: img, banner: banner) }
                pick = nil; picking = nil
            }
        }
        .fullScreenCover(item: $job) { j in
            CropScreen(image: j.image, banner: j.banner) { out in
                if let out { if j.banner { newBanner = out } else { newAvatar = out } }
                job = nil
            }
        }
    }
    private var badge: some View { Image(systemName: "camera").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(Color.black.opacity(0.45))) }
    private func field<V: View>(_ label: String, @ViewBuilder _ v: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.sans(13, .semibold)).foregroundStyle(T.muted)
            v().padding(.bottom, 8).overlay(alignment: .bottom) { T.softBd.frame(height: 1) }
        }
    }
    /// The picture you already have, fetched to be framed again.
    private func reframe(_ banner: Bool) {
        if let i = banner ? newBanner : newAvatar { job = CropJob(image: i, banner: banner); return }
        guard let u = banner ? bannerURL : avatarURL else { return }
        Task { if let (d, _) = try? await URLSession.shared.data(from: u), let img = UIImage(data: d) { job = CropJob(image: img, banner: banner) } }
    }
    @MainActor private func load() async {
        guard let a = await feed.auth(), let x = try? await Supa(a: a).rows("/rest/v1/profiles?id=eq.\(a.me)&select=display_name,bio,avatar_url,background_url").first else { return }
        name = x["display_name"] as? String ?? ""; bio = x["bio"] as? String ?? ""
        avatarURL = (x["avatar_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
        bannerURL = (x["background_url"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
        loaded = true
    }
    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces), b = String(bio.trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
        guard !n.isEmpty, !busy else { return }
        busy = true; error = nil
        Task { @MainActor in
            defer { busy = false }
            guard let a = await feed.auth() else { error = "You’re signed out."; return }
            let db = Supa(a: a)
            do {
                var row: [String: Any] = ["display_name": n, "bio": b.isEmpty ? NSNull() as Any : b]
                if let i = newAvatar { row["avatar_url"] = try await db.upload(i, bucket: "avatars") }
                if let i = newBanner { row["background_url"] = try await db.upload(i, bucket: "avatars") }
                _ = try await db.req("PATCH", "/rest/v1/profiles?id=eq.\(a.me)", json: row)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                await feed.load(quiet: true)
                NotificationCenter.default.post(name: .lotmProfileChanged, object: nil)
                close()
            } catch let e { error = e.localizedDescription }
        }
    }
}

// MARK: - Framing a picture: pinch and drag it under a fixed window (a circle for your photo, a wide frame for the banner)

final class CropBox { weak var view: CropView? }

final class CropView: UIView, UIScrollViewDelegate {
    private let scroll = UIScrollView(), picture = UIImageView(), shade = CAShapeLayer(), ring = CAShapeLayer()
    private let image: UIImage, banner: Bool
    private var window = CGRect.zero, laid = CGSize.zero
    init(image: UIImage, banner: Bool) {
        self.image = image; self.banner = banner
        super.init(frame: .zero)
        backgroundColor = .black
        scroll.delegate = self; scroll.showsVerticalScrollIndicator = false; scroll.showsHorizontalScrollIndicator = false
        scroll.bouncesZoom = true; scroll.alwaysBounceVertical = true; scroll.alwaysBounceHorizontal = true; scroll.contentInsetAdjustmentBehavior = .never
        scroll.decelerationRate = .fast
        picture.image = image; picture.frame = CGRect(origin: .zero, size: image.size)
        scroll.addSubview(picture); scroll.contentSize = image.size
        addSubview(scroll)
        shade.fillRule = .evenOdd; shade.fillColor = UIColor.black.withAlphaComponent(0.6).cgColor; layer.addSublayer(shade)
        ring.fillColor = UIColor.clear.cgColor; ring.strokeColor = UIColor.white.withAlphaComponent(0.85).cgColor; ring.lineWidth = 1.5; layer.addSublayer(ring)
    }
    required init?(coder: NSCoder) { fatalError() }
    func viewForZooming(in s: UIScrollView) -> UIView? { picture }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laid, bounds.width > 0, image.size.width > 0, image.size.height > 0 else { return }
        laid = bounds.size
        scroll.frame = bounds
        let w = bounds.width - (banner ? 0 : 32), h = banner ? w / 3 : w
        window = CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
        // The picture can be moved anywhere so long as it still covers the window.
        scroll.contentInset = UIEdgeInsets(top: window.minY, left: window.minX, bottom: bounds.height - window.maxY, right: bounds.width - window.maxX)
        let fit = max(w / image.size.width, h / image.size.height)
        scroll.minimumZoomScale = fit; scroll.maximumZoomScale = max(fit * 6, 1); scroll.zoomScale = fit
        scroll.contentOffset = CGPoint(x: (image.size.width * fit - w) / 2 - window.minX, y: (image.size.height * fit - h) / 2 - window.minY)
        let p = UIBezierPath(rect: bounds), hole = banner ? UIBezierPath(rect: window) : UIBezierPath(ovalIn: window)
        p.append(hole); shade.path = p.cgPath; shade.frame = bounds
        ring.path = hole.cgPath; ring.frame = bounds
    }
    /// What shows in the window, as a picture of its own.
    func result() -> UIImage? {
        let z = scroll.zoomScale; guard z > 0 else { return nil }
        let r = CGRect(x: (scroll.contentOffset.x + window.minX) / z, y: (scroll.contentOffset.y + window.minY) / z, width: window.width / z, height: window.height / z)
        let longest: CGFloat = banner ? 1800 : 800, k = min(1, longest / max(r.width, r.height))
        let out = CGSize(width: (r.width * k).rounded(), height: (r.height * k).rounded())
        guard out.width > 1, out.height > 1 else { return nil }
        let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
        return UIGraphicsImageRenderer(size: out, format: f).image { _ in
            UIColor.black.setFill(); UIRectFill(CGRect(origin: .zero, size: out))
            image.draw(in: CGRect(x: -r.minX * k, y: -r.minY * k, width: image.size.width * k, height: image.size.height * k))
        }
    }
}
private struct CropHost: UIViewRepresentable {
    let image: UIImage, banner: Bool, box: CropBox
    func makeUIView(context: Context) -> CropView { let v = CropView(image: image, banner: banner); box.view = v; return v }
    func updateUIView(_ v: CropView, context: Context) {}
}
struct CropScreen: View {
    let image: UIImage, banner: Bool
    let done: (UIImage?) -> Void
    @State private var box = CropBox()
    var body: some View {
        ZStack {
            CropHost(image: image, banner: banner, box: box).ignoresSafeArea()
            VStack {
                HStack {
                    Button("Cancel") { done(nil) }.font(.sans(17)).foregroundStyle(.white)
                    Spacer()
                    Text(banner ? "Frame your banner" : "Frame your photo").font(.sans(16, .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button("Use") { Haptic.tap(); done(box.view?.result()) }.font(.sans(17, .bold)).foregroundStyle(.white)
                }
                .padding(.horizontal, 18).padding(.top, 8)
                Spacer()
                Text("Pinch to zoom, drag to place").font(.sans(13)).foregroundStyle(.white.opacity(0.75)).padding(.bottom, 24)
            }
        }
        .preferredColorScheme(.dark).statusBarHidden()
    }
}
