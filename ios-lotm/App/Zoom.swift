import SwiftUI
import UIKit

/// Full-screen photos, as in the Photos app: pinch to zoom, double-tap to zoom in where you tap (and again to zoom
/// out), drag around while zoomed, swipe sideways for the next photo, swipe down or ✕ to close.
struct Lightbox: View {
    let urls: [URL], start: Int
    @State private var i = 0
    @State private var drop: CGFloat = 0
    @State private var zoomed = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(Double(1 - min(CGFloat(0.7), abs(drop) / CGFloat(500)))).ignoresSafeArea()
            TabView(selection: $i) {
                ForEach(Array(urls.enumerated()), id: \.offset) { k, u in
                    ZoomImage(url: u, zoomed: $zoomed).tag(k).ignoresSafeArea()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: urls.count > 1 && !zoomed ? .automatic : .never))
            .ignoresSafeArea()
            .offset(y: drop)
            .simultaneousGesture(DragGesture(minimumDistance: 12).onChanged { g in
                guard !zoomed, abs(g.translation.height) > abs(g.translation.width) else { return }
                drop = max(0, g.translation.height)
            }.onEnded { g in
                guard !zoomed else { return }
                if drop > 110 || g.predictedEndTranslation.height > 300 { dismiss() } else { withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { drop = 0 } }
            }, including: zoomed ? .subviews : .all)
            Button { dismiss() } label: {
                Text("✕").font(.sans(17)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.white.opacity(0.16)))
            }
            .padding(.trailing, 16).padding(.top, 8).opacity(drop > 0 ? 0 : 1)
        }
        .onAppear { i = start }
        .onChange(of: i) { _, _ in zoomed = false }
        .statusBarHidden()
    }
}

/// One photo in a UIScrollView: Apple's own zooming, so it feels exactly like the Photos app.
struct ZoomImage: UIViewRepresentable {
    let url: URL
    @Binding var zoomed: Bool
    func makeCoordinator() -> Coordinator { Coordinator(zoomed: $zoomed) }
    func makeUIView(context: Context) -> UIScrollView {
        let sv = UIScrollView()
        sv.delegate = context.coordinator
        sv.minimumZoomScale = 1; sv.maximumZoomScale = 4
        sv.showsHorizontalScrollIndicator = false; sv.showsVerticalScrollIndicator = false
        sv.contentInsetAdjustmentBehavior = .never
        sv.backgroundColor = .clear
        sv.decelerationRate = .fast
        let iv = UIImageView(); iv.contentMode = .scaleAspectFit; iv.isUserInteractionEnabled = true
        sv.addSubview(iv); context.coordinator.image = iv; context.coordinator.scroll = sv
        let spinner = UIActivityIndicatorView(style: .medium); spinner.color = .white; spinner.startAnimating()
        spinner.translatesAutoresizingMaskIntoConstraints = false; sv.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: sv.frameLayoutGuide.centerXAnchor), spinner.centerYAnchor.constraint(equalTo: sv.frameLayoutGuide.centerYAnchor)])
        let tap2 = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:))); tap2.numberOfTapsRequired = 2
        sv.addGestureRecognizer(tap2)
        Task {
            if let (d, _) = try? await URLSession.shared.data(from: url), let img = UIImage(data: d) {
                await MainActor.run { iv.image = img; spinner.removeFromSuperview(); context.coordinator.layout() }
            }
        }
        return sv
    }
    func updateUIView(_ sv: UIScrollView, context: Context) { DispatchQueue.main.async { context.coordinator.layout() } }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var zoomed: Binding<Bool>
        weak var image: UIImageView?
        weak var scroll: UIScrollView?
        private var lastSize: CGSize = .zero
        init(zoomed: Binding<Bool>) { self.zoomed = zoomed }
        /// The photo fills the screen's width (or height), centred.
        func layout() {
            guard let sv = scroll, let iv = image, let img = iv.image, sv.bounds.width > 0 else { return }
            if sv.zoomScale == 1 && (lastSize != sv.bounds.size || iv.frame.size == .zero) {
                lastSize = sv.bounds.size
                let fit = min(sv.bounds.width / img.size.width, sv.bounds.height / img.size.height)
                iv.frame = CGRect(x: 0, y: 0, width: img.size.width * fit, height: img.size.height * fit)
                sv.contentSize = iv.frame.size
            }
            center()
        }
        private func center() {
            guard let sv = scroll, let iv = image else { return }
            let x = max(0, (sv.bounds.width - iv.frame.width) / 2), y = max(0, (sv.bounds.height - iv.frame.height) / 2)
            sv.contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
        }
        func viewForZooming(in sv: UIScrollView) -> UIView? { image }
        func scrollViewDidZoom(_ sv: UIScrollView) {
            center()
            let z = sv.zoomScale > 1.01
            if z != zoomed.wrappedValue { DispatchQueue.main.async { self.zoomed.wrappedValue = z } }
        }
        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let sv = scroll, let iv = image else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            if sv.zoomScale > 1.01 { sv.setZoomScale(1, animated: true); return }
            let p = g.location(in: iv), s: CGFloat = 2.5
            let w = sv.bounds.width / s, h = sv.bounds.height / s
            sv.zoom(to: CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), animated: true)
        }
    }
}
