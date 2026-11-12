import ActivityKit
import AuthenticationServices
import SwiftUI
import UIKit
import WebKit

/// The portal, full screen, in a native shell. The web app talks to the shell through
/// `window.webkit.messageHandlers.abaya.postMessage({...})`:
///   { type: "timer", timer: { code, title, detail, elapsed, paused } | null }  → Live Activity
///   { type: "oauth", url }                                                      → Google sign-in in a system browser sheet
@main
struct AbayaApp: App {
    var body: some Scene {
        WindowGroup {
            PortalView().ignoresSafeArea().background(Color(red: 2 / 255, green: 37 / 255, blue: 61 / 255))
                .onOpenURL { NotificationCenter.default.post(name: .abayaOpenURL, object: $0) }
        }
    }
}

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
        config.applicationNameForUserAgent = "AbayaApp/1.0"

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
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    @objc private func reload(_ sender: UIRefreshControl) {
        web.reload()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { sender.endRefreshing() }
    }

    @objc private func openedFromURL(_ note: Notification) {
        // abaya://timer (tapping the Live Activity) → the Time tab
        guard let url = note.object as? URL, url.host == "timer" else { return }
        web.evaluateJavaScript("try{localStorage.setItem('abaya.m.tab','time')}catch(e){};location.hash='#/'", completionHandler: nil)
    }

    // MARK: messages from the portal

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "timer": LiveTimer.shared.apply(body["timer"] as? [String: Any])
        case "oauth": if let s = body["url"] as? String, let url = URL(string: s) { signIn(with: url) }
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

    func apply(_ t: [String: Any]?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard let t else { return end() }
        let elapsed = (t["elapsed"] as? Double) ?? 0
        let paused = (t["paused"] as? Bool) ?? false
        let state = TimerAttributes.ContentState(
            code: (t["code"] as? String) ?? "",
            title: (t["title"] as? String) ?? "Timer",
            detail: (t["detail"] as? String) ?? "",
            start: Date().addingTimeInterval(-elapsed),
            pausedSeconds: paused ? elapsed : nil)
        // Skip no-op updates (the clock ticks on its own); allow a little drift before re-anchoring.
        if let l = last, l.code == state.code, l.title == state.title, l.detail == state.detail, (l.pausedSeconds == nil) == (state.pausedSeconds == nil),
           abs(l.start.timeIntervalSince(state.start)) < 5, state.pausedSeconds == nil { return }
        last = state
        Task {
            let content = ActivityContent(state: state, staleDate: nil)
            if let a = Activity<TimerAttributes>.activities.first {
                await a.update(content)
                for extra in Activity<TimerAttributes>.activities.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
            } else {
                _ = try? Activity.request(attributes: TimerAttributes(), content: content)
            }
        }
    }

    func end() {
        last = nil
        Task { for a in Activity<TimerAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) } }
    }
}
