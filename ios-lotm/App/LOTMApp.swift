import SwiftUI
import WebKit
import ObjectiveC

let home = URL(string: "https://lotmstudy.org/next/")!

@main
struct LOTMApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var web = WebModel()
    var body: some Scene {
        WindowGroup {
            WebView(model: web)
                .ignoresSafeArea()
                .background(Color(red: 0.176, green: 0.188, blue: 0.122))
                .onOpenURL { web.handle($0) }
        }
        .onChange(of: phase) { _, p in if p == .active { web.drainInbox() } }
    }
}

final class WebModel: NSObject, ObservableObject {
    let view: WKWebView
    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .default()
        cfg.applicationNameForUserAgent = "LifeOfTheMindApp/1.0"
        cfg.userContentController.add(HapticHandler(), name: "haptic")
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = true
        view.scrollView.alwaysBounceVertical = true
        // Tan behind the masthead when pulling down, so the gap matches the header.
        let top = UIView(frame: CGRect(x: 0, y: -2000, width: 4000, height: 2000))
        top.backgroundColor = UIColor(red: 0.176, green: 0.188, blue: 0.122, alpha: 1)
        top.autoresizingMask = [.flexibleWidth]
        view.scrollView.insertSubview(top, at: 0)
        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(red: 0.984, green: 0.965, blue: 0.918, alpha: 1)
        refresh.addTarget(self, action: #selector(pulled(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        view.allowsBackForwardNavigationGestures = false
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
        view.hideKeyboardAccessoryBar()
        view.load(URLRequest(url: home))
    }
    /// Pull to refresh: the visible tab reloads its data (falls back to a full reload).
    @objc func pulled(_ c: UIRefreshControl) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        view.callAsyncJavaScript("if (window.lotmRefresh) { await window.lotmRefresh() } else { location.reload() }", arguments: [:], in: nil, in: .page) { _ in
            DispatchQueue.main.async { c.endRefreshing() }
        }
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

// iOS puts its own "‹ › Done" bar above the keyboard for web text fields. The app has its own
// writing toolbar, so swap WebKit's content view for a subclass that returns no accessory view.
private final class NoAccessory: NSObject { @objc var inputAccessoryView: AnyObject? { nil } }
extension WKWebView {
    func hideKeyboardAccessoryBar() {
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
              let base = object_getClass(content) else { return }
        let name = "\(base)_LOTMNoAccessory"
        var cls: AnyClass? = NSClassFromString(name)
        if cls == nil, let c = objc_allocateClassPair(base, name, 0) {
            if let m = class_getInstanceMethod(NoAccessory.self, #selector(getter: NoAccessory.inputAccessoryView)) {
                class_addMethod(c, #selector(getter: NoAccessory.inputAccessoryView), method_getImplementation(m), method_getTypeEncoding(m))
            }
            objc_registerClassPair(c); cls = c
        }
        if let cls { object_setClass(content, cls) }
        // iPad: drop the shortcut (undo/redo/paste) bar too.
        content.inputAssistantItem.leadingBarButtonGroups = []
        content.inputAssistantItem.trailingBarButtonGroups = []
    }
}

/// window.webkit.messageHandlers.haptic.postMessage("light") from the web app → a Taptic tap (likes).
final class HapticHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        let style: UIImpactFeedbackGenerator.FeedbackStyle = (m.body as? String) == "medium" ? .medium : .light
        DispatchQueue.main.async { UIImpactFeedbackGenerator(style: style).impactOccurred() }
    }
}
