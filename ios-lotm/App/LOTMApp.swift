import SwiftUI
import WebKit

let home = URL(string: "https://lotmstudy.org/next/")!

@main
struct LOTMApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var web = WebModel()
    var body: some Scene {
        WindowGroup {
            WebView(model: web)
                .ignoresSafeArea()
                .background(Color(red: 0.478, green: 0.404, blue: 0.282))
                .onOpenURL { web.handle($0) }
        }
        .onChange(of: phase) { _, p in if p == .active { web.drainInbox() } }
    }
}

final class WebModel: ObservableObject {
    let view: WKWebView
    init() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .default()
        cfg.applicationNameForUserAgent = "LifeOfTheMindApp/1.0"
        view = WKWebView(frame: .zero, configuration: cfg)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.allowsBackForwardNavigationGestures = false
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.953, green: 0.929, blue: 0.875, alpha: 1)
        view.load(URLRequest(url: home))
    }
    /// lotm://post/<id>, lotm://notebook/new?text=… → the same screens in the web app.
    func handle(_ url: URL) {
        guard url.scheme == "lotm" else { return }
        let path = (url.host.map { "/" + $0 } ?? "") + url.path
        let query = url.query.map { "?" + $0 } ?? ""
        go(path + query)
    }
    func go(_ route: String) {
        let js = "location.hash = '#\(route.replacingOccurrences(of: "'", with: "%27"))'"
        view.evaluateJavaScript(js)
    }
    /// Passages saved from Safari's share sheet open as new Commonplace entries.
    func drainInbox() {
        guard let item = Inbox.popAll().last else { return }
        var c = URLComponents(); c.queryItems = [URLQueryItem(name: "text", value: item.text)] + (item.url.map { [URLQueryItem(name: "url", value: $0)] } ?? [])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.go("/notebook/new" + (c.percentEncodedQuery.map { "?" + $0 } ?? "")) }
    }
}

struct WebView: UIViewRepresentable {
    @ObservedObject var model: WebModel
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView { model.view.navigationDelegate = context.coordinator; model.view.uiDelegate = context.coordinator; return model.view }
    func updateUIView(_ v: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // Our site stays in the app; everything else (articles, maps, books) opens in Safari.
        func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = a.request.url else { return decisionHandler(.allow) }
            if url.host == "lotmstudy.org" || url.host?.hasSuffix(".supabase.co") == true || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
            if a.navigationType == .linkActivated || a.targetFrame == nil { UIApplication.shared.open(url); return decisionHandler(.cancel) }
            decisionHandler(.allow)
        }
        func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = a.request.url { UIApplication.shared.open(url) }
            return nil
        }
        func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
            present(UIAlertController(title: nil, message: m, preferredStyle: .alert), actions: [("OK", .default, { completionHandler() })])
        }
        func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            present(UIAlertController(title: nil, message: m, preferredStyle: .alert), actions: [("Cancel", .cancel, { completionHandler(false) }), ("OK", .default, { completionHandler(true) })])
        }
        func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: p, preferredStyle: .alert); a.addTextField { $0.text = defaultText }
            present(a, actions: [("Cancel", .cancel, { completionHandler(nil) }), ("OK", .default, { completionHandler(a.textFields?.first?.text) })])
        }
        func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.grant) }
        private func present(_ a: UIAlertController, actions: [(String, UIAlertAction.Style, () -> Void)]) {
            for (t, s, f) in actions { a.addAction(UIAlertAction(title: t, style: s) { _ in f() }) }
            let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
            var top = root; while let p = top?.presentedViewController { top = p }
            top?.present(a, animated: true)
        }
    }
}
