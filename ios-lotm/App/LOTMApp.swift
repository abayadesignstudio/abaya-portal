import SwiftUI
import CoreText
import WebKit
import SafariServices
import UserNotifications
import WidgetKit
import ObjectiveC

let home = URL(string: "https://lotmstudy.org/next/")!

/// Notifications: asks once, registers with Apple, and hands the device token to the web app (which saves it with the
/// member's account). A tapped notification opens its screen.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static weak var web: WebModel?
    func application(_ app: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Covers, faces and photos are kept on the phone, so pages don't fetch them again each time they are opened.
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        // The app's own fonts (EB Garamond, Inter), loaded straight from the app, so every native screen is set in them.
        for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
        for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [] { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
        let c = UNUserNotificationCenter.current(); c.delegate = self
        c.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
            if ok { DispatchQueue.main.async { app.registerForRemoteNotifications() } }
        }
        return true
    }
    func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: "apnsToken")
        AppDelegate.web?.shareDeviceToken()
    }
    // Shown as a banner even while the app is open
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) { done([.banner, .sound, .list]) }
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        if let url = r.notification.request.content.userInfo["url"] as? String, let hash = url.split(separator: "#", maxSplits: 1).last, url.contains("#") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { AppDelegate.web?.go(String(hash)) }
        }
        done()
    }
}

@main
struct LOTMApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var phase
    @StateObject private var web = WebModel()
    var body: some Scene {
        WindowGroup {
            Shell(web: web)
                .onOpenURL { web.handle($0) }
                .onAppear { AppDelegate.web = web }
        }
        .onChange(of: phase) { _, p in if p == .active { web.drainInbox(); web.reviveIfBlank() } }
    }
}

final class WebModel: NSObject, ObservableObject {
    let view: WKWebView
    weak var feed: FeedModel?
    /// Which Library pane is showing: mine, notes (the Commonplace, still the web's) or club.
    /// Set for one visit when an administrator opens the web's own devotion (for its editor).
    var allowWebReader = false
    @Published var libPane = UserDefaults.standard.string(forKey: "lotm.libPane") ?? "mine"
    /// The screen the web app is on (it reports each change), and the tab chosen in the app's own tab bar.
    @Published var route = ""
    @Published var tab: Tab = .feed
    let composer: ComposeHandler
    let poster: PostHandler
    private var sideways: NSKeyValueObservation?
    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.websiteDataStore = .default()
        cfg.applicationNameForUserAgent = "LifeOfTheMindApp/1.0"
        cfg.userContentController.add(HapticHandler(), name: "haptic")
        WKWebView.allowKeyboardWithoutTap()
        cfg.userContentController.add(WidgetHandler(), name: "widget")
        let outer = OuterScrollHandler(); cfg.userContentController.add(outer, name: "outerScroll")
        cfg.userContentController.add(StatusBarHandler(), name: "statusBar")
        let composer = ComposeHandler(), poster = PostHandler()
        self.composer = composer; self.poster = poster
        cfg.userContentController.add(composer, name: "compose")
        cfg.userContentController.add(poster, name: "post")
        let routes = RouteHandler(); cfg.userContentController.add(routes, name: "route")
        let chat = ChatHandler(); cfg.userContentController.add(chat, name: "chat")
        let lib = LibHandler(); cfg.userContentController.add(lib, name: "lib")
        // The web app knows it is inside the app's native shell (it hides its own tab bar and Feed).
        cfg.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('native-shell')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // The web app knows it is inside the app's native shell (it hides its own tab bar and Feed).
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        routes.model = self; chat.model = self; lib.model = self
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = true
        view.scrollView.alwaysBounceVertical = true
        view.scrollView.alwaysBounceHorizontal = false
        view.scrollView.showsHorizontalScrollIndicator = false
        view.scrollView.isDirectionalLockEnabled = true
        // Belt and braces: the page itself never moves sideways (carousels inside it still swipe).
        sideways = view.scrollView.observe(\.contentOffset, options: [.new]) { sv, _ in
            if sv.contentOffset.x != 0 { sv.contentOffset.x = 0 }
        }
        view.scrollView.keyboardDismissMode = .interactive
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
        outer.web = view
        composer.web = view
        poster.web = view
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
        // The notebook is the app's own: open it (or a new entry holding what was shared) natively.
        if path.hasPrefix("/notebook") {
            let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func v(_ k: String) -> String { q.first { $0.name == k }?.value ?? "" }
            select(.library); setLibPane("notes")
            let rest = path.dropFirst("/notebook".count).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if rest == "new" || !v("text").isEmpty || !v("url").isEmpty { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { openNote(self, text: v("text"), url: v("url")) } }
            else if !rest.isEmpty && rest != "index" { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { openNote(self, id: rest) } }
            else if !v("new").isEmpty { DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { NotesModel.shared.focusQuick += 1 } }
            return
        }
        go(path + query)
    }
    /// Give the web app this phone's push token (it saves it once a member is signed in).
    func shareDeviceToken() {
        guard let t = UserDefaults.standard.string(forKey: "apnsToken") else { return }
        view.evaluateJavaScript("window.lotmDeviceToken='\(t)';window.dispatchEvent(new Event('lotm:device'))")
    }
    func select(_ t: Tab) { tab = t; go(t.route) }
    func openPost(_ id: String, people: [String: Person], reply: Bool) { poster.open(id: id, people: people, reply: reply) }
    func go(_ route: String) {
        let js = "location.hash = '#\(route.replacingOccurrences(of: "'", with: "%27"))'"
        view.evaluateJavaScript(js)
    }
    /// Coming back to the app: if the page is missing (iOS dropped it), load it again.
    func reviveIfBlank() {
        if view.url == nil { view.load(URLRequest(url: home, cachePolicy: .reloadIgnoringLocalCacheData)); return }
        view.evaluateJavaScript("document.getElementById('root')?.childElementCount ?? 0") { r, err in
            if err != nil || (r as? Int ?? 1) == 0 { self.view.reload() }
        }
    }
    /// Passages saved from Safari's share sheet open as new Commonplace entries.
    func drainInbox() {
        guard let item = Inbox.popAll().last else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.select(.library); self.setLibPane("notes"); openNote(self, text: item.text, url: item.url ?? "") }
    }
}

struct WebView: UIViewRepresentable {
    @ObservedObject var model: WebModel
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView { model.view.navigationDelegate = context.coordinator; model.view.uiDelegate = context.coordinator; return model.view }
    func updateUIView(_ v: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private var tries = 0
        func webView(_ w: WKWebView, didFinish n: WKNavigation!) { tries = 0; AppDelegate.web?.shareDeviceToken() }
        // Never leave a blank screen: if iOS stops the page's process (memory, or the app was in the background a long
        // time) reload it; if the page can't be fetched, try again, skipping anything cached.
        func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
            if w.url == nil { w.load(URLRequest(url: home, cachePolicy: .reloadIgnoringLocalCacheData)) } else { w.reload() }
        }
        func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { retry(w, e) }
        func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { retry(w, e) }
        private func retry(_ w: WKWebView, _ e: Error) {
            if (e as NSError).code == NSURLErrorCancelled { return }
            tries += 1
            let wait = min(8.0, Double(tries) * 1.5)
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { w.load(URLRequest(url: home, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)) }
        }
        // Our site stays in the app; everything else (articles, maps, books) opens in the in-app browser.
        func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = a.request.url else { return decisionHandler(.allow) }
            if url.host == "lotmstudy.org" || url.host?.hasSuffix(".supabase.co") == true || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
            if a.navigationType == .linkActivated || a.targetFrame == nil { openOutside(url); return decisionHandler(.cancel) }
            decisionHandler(.allow)
        }
        func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = a.request.url { openOutside(url) }
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
        /// Articles and other web pages open in the in-app browser (Done to come back, the Safari button to carry on in
        /// Safari). Calendar files, Maps, phone and mail links go to their own apps.
        private func openOutside(_ url: URL) {
            let web = url.scheme == "http" || url.scheme == "https"
            let ownApp = url.host == "maps.apple.com" || url.path.hasSuffix(".ics") || url.path == "/ics"
            guard web && !ownApp else { UIApplication.shared.open(url); return }
            let cfg = SFSafariViewController.Configuration(); cfg.entersReaderIfAvailable = false; cfg.barCollapsingEnabled = true
            let vc = SFSafariViewController(url: url, configuration: cfg)
            vc.preferredControlTintColor = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
            vc.dismissButtonStyle = .done
            let root = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }.first
            var top = root; while let p = top?.presentedViewController { top = p }
            top?.present(vc, animated: true)
        }
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

/// window.webkit.messageHandlers.widget.postMessage(json) → the widgets' snapshot, then a redraw.
final class WidgetHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let s = m.body as? String, let d = s.data(using: .utf8) else { return }
        WidgetStore.save(d)
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Lets the web app raise the keyboard when a writing screen opens (iOS normally waits for a tap on the field).
/// Same approach Capacitor uses: WebKit's focus handler is told the focus came from the user.
extension WKWebView {
    private static var keyboardPatched = false
    static func allowKeyboardWithoutTap() {
        guard !keyboardPatched, let cls = NSClassFromString("WKContentView") else { return }
        keyboardPatched = true
        let sel = sel_getUid("_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:")
        guard let method = class_getInstanceMethod(cls, sel) else { return }
        let original = method_getImplementation(method)
        typealias Focus = @convention(c) (Any, Selector, UnsafeRawPointer, Bool, Bool, Bool, Any?) -> Void
        let block: @convention(block) (Any, UnsafeRawPointer, Bool, Bool, Bool, Any?) -> Void = { me, info, _, blur, changes, obj in
            unsafeBitCast(original, to: Focus.self)(me, sel, info, true, blur, changes, obj)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }
}

/// The devotion reader has its own scroller; while it is open the web view's own scrolling (bounce, pull-to-refresh)
/// is switched off so the two never compete for a swipe. postMessage("off" | "on").
final class OuterScrollHandler: NSObject, WKScriptMessageHandler {
    weak var web: WKWebView?
    private var refresh: UIRefreshControl?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let sv = web?.scrollView else { return }
        let on = (m.body as? String) != "off"
        DispatchQueue.main.async {
            if on {
                sv.isScrollEnabled = true; sv.bounces = true; sv.alwaysBounceVertical = true
                if sv.refreshControl == nil, let r = self.refresh { sv.refreshControl = r }
            } else {
                if let r = sv.refreshControl { self.refresh = r; sv.refreshControl = nil }
                sv.bounces = false; sv.alwaysBounceVertical = false; sv.isScrollEnabled = false
            }
        }
    }
}

/// The devotion hides the time and battery while you read, and brings them back when you tap (as in Apple Books).
/// The app manages the status bar itself (UIViewControllerBasedStatusBarAppearance is off), so this is the app-level switch.
final class StatusBarHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        let hide = (m.body as? String) == "hide"
        DispatchQueue.main.async {
            UIView.animate(withDuration: 0.25) { UIApplication.shared.setStatusBarHidden(hide, with: .fade) }
        }
    }
}

/// The web app reports the screen it is showing: window.webkit.messageHandlers.route.postMessage("/reading").
final class RouteHandler: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let path = m.body as? String else { return }
        DispatchQueue.main.async {
            guard let model = self.model else { return }
            // A member's page is native: a link to one opens it over the app, and the web goes back to where it was.
            let first = path.split(separator: "?").first.map(String.init) ?? path
            // The devotion is the app's own.
            if first.hasPrefix("/read/") {
                if model.allowWebReader { model.allowWebReader = false } else {
                    let office = URLComponents(string: "x://x" + path)?.queryItems?.first { $0.name == "office" }?.value
                    model.go(model.tab.route); openDevotion(model, slug: String(first.dropFirst(6).split(separator: "?").first ?? ""), office: office); return
                }
            }
            if first.hasPrefix("/member/") { model.go(model.tab.route); openMember(String(first.dropFirst(8)), model); return }
            model.route = path
            // Arriving at a web tab some other way (a link, a notification) moves the tab bar with it.
            let p = path.split(separator: "?").first.map(String.init) ?? path
            // The chat lives in the app: a chat link (say, from a notification) opens it natively.
            if p == "/chat" || p.hasPrefix("/chat/") { model.go(model.tab.route); openChat(model, conv: p.hasPrefix("/chat/") ? String(p.dropFirst(6)) : nil); return }
            if p == "/reading" || p == "/notebook/index" { model.tab = .library } else if p == "/people" { model.tab = .people } else if p == "/settings" { model.tab = .settings }
        }
    }
}
