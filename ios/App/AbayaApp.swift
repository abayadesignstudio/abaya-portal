import ActivityKit
import AuthenticationServices
import SwiftUI
import UIKit
import UserNotifications
import WebKit
import WidgetKit

/// The portal, full screen, in a native shell. The web app talks to the shell through
/// `window.webkit.messageHandlers.abaya.postMessage({...})`:
///   { type: "timer", timer: { code, title, detail, elapsed, paused } | null }  → Live Activity
///   { type: "oauth", url }                                                      → Google sign-in in a system browser sheet
///   { type: "ready" }                          → the page is listening; replies with GPS/recording state and any pending widget action
///   { type: "gps", action: "start"|"stop"|"status" }                              → TripTracker
///   { type: "record", action: "start"|"stop"|"status", purpose?, uploadUrl?, path? } → Recorder
/// The shell answers with window events: window.addEventListener('abaya-native', e => e.detail)
@main
struct AbayaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            PortalView().ignoresSafeArea().background(Color(red: 2 / 255, green: 37 / 255, blue: 61 / 255))
                .onOpenURL { NotificationCenter.default.post(name: .abayaOpenURL, object: $0) }
        }
        .onChange(of: phase) { _, p in if p == .active { AppDelegate.refreshBrief() } }
    }
}

/// Notifications: asks once for permission, keeps the morning schedule notification current,
/// and opens the calendar when it's tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ app: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in if granted { AppDelegate.refreshBrief() } }
        return true
    }

    static func refreshBrief() {
        Task { if let feed = try? await WidgetLink.call("feed") { DailyBrief.schedule(from: feed) } }
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        if let s = r.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) {
            PendingURL.value = url
            DispatchQueue.main.async { NotificationCenter.default.post(name: .abayaOpenURL, object: url) }
        }
        done()
    }
}

/// A URL that arrived before the portal view existed (cold launch from a notification).
enum PendingURL { static var value: URL? }

let portalURL = URL(string: "https://abayadesignstudio.github.io/abaya-portal/portal/")!
private let allowedHosts: Set<String> = ["abayadesignstudio.github.io", "ozowlkstprkvktosetci.supabase.co"]

struct PortalView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> PortalController { PortalController() }
    func updateUIViewController(_ controller: PortalController, context: Context) {}
}

final class PortalController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    private var web: WKWebView!
    private var authSession: ASWebAuthenticationSession?

    override func viewDidLoad() {
        super.viewDidLoad()
        let navy = UIColor(red: 2 / 255, green: 37 / 255, blue: 61 / 255, alpha: 1)
        view.backgroundColor = navy

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // keeps the sign-in between launches
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(WeakHandler(self), name: "abaya")
        let info = Bundle.main.infoDictionary
        config.applicationNameForUserAgent = "AbayaApp/\(info?["CFBundleShortVersionString"] ?? "1.0") build/\(info?["CFBundleVersion"] ?? "?")"

        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = navy
        web.scrollView.backgroundColor = navy
        web.scrollView.contentInsetAdjustmentBehavior = .never // the portal pads for the notch itself
        web.allowsBackForwardNavigationGestures = true
        let refresh = UIRefreshControl()
        refresh.tintColor = .white
        refresh.addTarget(self, action: #selector(reload(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        view.addSubview(web)
        web.load(URLRequest(url: portalURL))

        NotificationCenter.default.addObserver(self, selector: #selector(openedFromURL(_:)), name: .abayaOpenURL, object: nil)
        if let u = PendingURL.value { PendingURL.value = nil; handle(u) }
        TripTracker.shared.onChange = { [weak self] in self?.send($0) }
        Recorder.shared.onChange = { [weak self] in self?.send($0) }
        LiveTimer.shared.report = { [weak self] in NSLog("ABAYA-LIVE %@", "\($0)"); self?.send($0) }
        // CI diagnostics: start a test timer island on launch and log the result
        if ProcessInfo.processInfo.arguments.contains("-diagLive") {
            LiveTimer.shared.apply(["code": "TEST", "title": "Diagnostics", "detail": "", "elapsed": 5.0, "paused": false])
        }
    }

    private var pageReady = false
    private var pendingAction: String?

    /// Shell → portal: a window event the page listens for.
    func send(_ msg: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: msg), let s = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('abaya-native',{detail:\(s)}))", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { pageReady = false }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func reload(_ sender: UIRefreshControl) {
        web.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    @objc private func openedFromURL(_ note: Notification) {
        // abaya://timer (tapping the Live Activity) → the Time tab; abaya://action/<name> (widgets) → that quick action
        guard let url = note.object as? URL else { return }
        PendingURL.value = nil
        handle(url)
    }

    private func handle(_ url: URL) {
        if url.host == "timer" {
            web.evaluateJavaScript("try{localStorage.setItem('abaya.m.tab','time')}catch(e){};location.hash='#/'", completionHandler: nil)
        } else if url.host == "action", let name = url.pathComponents.dropFirst().first {
            if pageReady { send(["type": "action", "action": name]) } else { pendingAction = name }
        }
    }

    // MARK: messages from the portal

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "timer":
            LiveTimer.shared.apply(body["timer"] as? [String: Any])
            WidgetCenter.shared.reloadTimelines(ofKind: "AbayaAgenda")
        case "widgetToken":
            if let t = body["token"] as? String, t.count == 64 { WidgetLink.save(t); WidgetCenter.shared.reloadAllTimelines() }
            send(["type": "widget", "linked": WidgetLink.token != nil])
        case "oauth": if let s = body["url"] as? String, let url = URL(string: s) { signIn(with: url) }
        case "ready":
            pageReady = true
            TripTracker.shared.emit(); Recorder.shared.emit()
            send(["type": "widget", "linked": WidgetLink.token != nil])
            if let a = pendingAction { pendingAction = nil; send(["type": "action", "action": a]) }
        case "gps":
            switch body["action"] as? String {
            case "start": TripTracker.shared.start()
            case "stop": TripTracker.shared.stop()
            default: TripTracker.shared.emit()
            }
        case "record":
            switch body["action"] as? String {
            case "start": Recorder.shared.start(purpose: (body["purpose"] as? String) ?? "conversation")
            case "stop": Recorder.shared.stop(uploadUrl: body["uploadUrl"] as? String, path: body["path"] as? String)
            default: Recorder.shared.emit()
            }
        default: break
        }
    }

    /// Google won't sign in inside an embedded web view, so the portal hands the sign-in URL here;
    /// it opens in a system sheet and comes back to abaya://auth?code=…, which the portal exchanges for a session.
    private func signIn(with url: URL) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "abaya") { [weak self] callback, _ in
            guard let self, let callback, let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                  let code = items.first(where: { $0.name == "code" })?.value else { return }
            var c = URLComponents(url: portalURL, resolvingAgainstBaseURL: false)!
            c.queryItems = [URLQueryItem(name: "code", value: code)]
            DispatchQueue.main.async { self.web.load(URLRequest(url: c.url!)) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { view.window ?? ASPresentationAnchor() }

    // MARK: navigation — the portal stays in the app; everything else opens in Safari

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let scheme = url.scheme ?? ""
        if scheme == "about" || scheme == "blob" || scheme == "data" { return decisionHandler(.allow) }
        if scheme == "http" || scheme == "https", let host = url.host, allowedHosts.contains(host) {
            return decisionHandler(.allow)
        }
        if action.targetFrame?.isMainFrame == false && (scheme == "http" || scheme == "https") { return decisionHandler(.allow) } // embeds
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    /// target="_blank" links and window.open
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if let host = url.host, allowedHosts.contains(host) { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }

    /// If the page crashes in the background, bring it back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
}

/// WKUserContentController keeps a strong reference to its handler; this breaks the cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}

extension Notification.Name { static let abayaOpenURL = Notification.Name("abayaOpenURL") }

/// Starts, updates and ends the timer's Live Activity to match the portal.
final class LiveTimer {
    static let shared = LiveTimer()
    private var last: TimerAttributes.ContentState?
    /** Reports to the page whether the island is showing (or why not). */
    var report: (([String: Any]) -> Void)?

    func apply(_ t: [String: Any]?) {
        guard let t else { return end() }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            report?(["type": "live", "ok": false, "reason": "Live Activities are turned off for Abaya. Turn them on in Settings → Abaya → Live Activities."]); return
        }
        let elapsed = (t["elapsed"] as? Double) ?? 0
        let paused = (t["paused"] as? Bool) ?? false
        let state = TimerAttributes.ContentState(
            code: (t["code"] as? String) ?? "",
            title: (t["title"] as? String) ?? "Timer",
            detail: (t["detail"] as? String) ?? "",
            start: Date().addingTimeInterval(-elapsed),
            pausedSeconds: paused ? elapsed : nil)
        // Skip no-op updates (the clock ticks on its own); allow a little drift before re-anchoring.
        // (only when an activity is actually showing — iOS ends them after 8 hours, and you can swipe one away)
        if !Activity<TimerAttributes>.activities.contains(where: { $0.activityState == .active }) { last = nil }
        if let l = last, l.code == state.code, l.title == state.title, l.detail == state.detail, (l.pausedSeconds == nil) == (state.pausedSeconds == nil),
           abs(l.start.timeIntervalSince(state.start)) < 5, state.pausedSeconds == nil { return }
        last = state
        Task {
            let content = ActivityContent(state: state, staleDate: nil)
            if let a = Activity<TimerAttributes>.activities.first(where: { $0.activityState == .active }) {
                await a.update(content)
                for extra in Activity<TimerAttributes>.activities where extra.id != a.id { await extra.end(nil, dismissalPolicy: .immediate) }
            } else {
                for old in Activity<TimerAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
                do {
                    _ = try Activity.request(attributes: TimerAttributes(), content: content)
                    await MainActor.run { self.report?(["type": "live", "ok": true]) }
                } catch {
                    self.last = nil
                    await MainActor.run { self.report?(["type": "live", "ok": false, "reason": "The Dynamic Island couldn't start: \(error.localizedDescription)"]) }
                }
            }
        }
    }

    func end() {
        last = nil
        Task { for a in Activity<TimerAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) } }
    }
}
