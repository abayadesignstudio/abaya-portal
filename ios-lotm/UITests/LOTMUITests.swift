import XCTest

/// Drives the app in the simulator and photographs each step, so a build can be looked at before it reaches a phone.
/// Signs in with the test member (LOTM_EMAIL / LOTM_PASSWORD, given to the runner as secrets); without them it
/// photographs the opening screen and stops.
final class LOTMUITests: XCTestCase {
    let app = XCUIApplication()
    var n = 0

    override func setUp() {
        continueAfterFailure = true
        app.launch()
    }

    func shot(_ name: String) {
        n += 1
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = String(format: "%02d-%@", n, name); a.lifetime = .keepAlways
        add(a)
    }
    func pause(_ s: Double) { Thread.sleep(forTimeInterval: s) }

    /// Signs in through the web form the app opens with. Returns false when there is no test member to sign in as.
    func signIn() -> Bool {
        let env = ProcessInfo.processInfo.environment
        let dock = app.buttons["Write a post"]
        if dock.waitForExistence(timeout: 20) { return true }          // already signed in
        shot("opening")
        guard let email = env["LOTM_EMAIL"], let pw = env["LOTM_PASSWORD"], !email.isEmpty, !pw.isEmpty else { return false }
        let web = app.webViews.firstMatch
        let mail = web.textFields.firstMatch
        guard mail.waitForExistence(timeout: 30) else { shot("no-sign-in-form"); return false }
        mail.tap(); mail.typeText(email)
        let pass = web.secureTextFields.firstMatch
        guard pass.waitForExistence(timeout: 5) else { shot("no-password-field"); return false }
        pass.tap(); pass.typeText(pw)
        let go = web.buttons["Sign in"]
        if go.exists { go.tap() } else { app.typeText("\n") }
        let ok = dock.waitForExistence(timeout: 40)
        shot(ok ? "signed-in" : "sign-in-failed")
        return ok
    }

    func testWalk() {
        guard signIn() else { return }
        pause(3); shot("feed")

        // Library: the three panes, and the keyboard put away on leaving the notebook's search
        app.buttons["Library"].tap(); pause(2); shot("library")
        app.buttons["Notes"].firstMatch.tap(); pause(1.5); shot("notes")
        let search = app.textFields.firstMatch
        if search.waitForExistence(timeout: 5) {
            search.tap(); search.typeText("grace"); pause(0.8); shot("notes-search-keyboard-up")
            app.buttons["My Library"].firstMatch.tap(); pause(1.2); shot("my-library-after-search")
            XCTAssertFalse(app.keyboards.firstMatch.exists, "The keyboard stayed up after leaving the Notes pane")
        }
        app.buttons["LOTM"].firstMatch.tap(); pause(1.5); shot("lotm")
        app.swipeUp(); pause(1); shot("lotm-lower")

        // The writer: a long post, to see the typed line stay above the pinned bars. Nothing is posted.
        app.buttons["Write a post"].tap(); pause(1.5); shot("writer")
        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        if field.waitForExistence(timeout: 5) {
            field.tap()
            for i in 1...14 { app.typeText("Line \(i) of a long post, typed to see where the cursor sits.\n") }
            pause(0.8); shot("writer-long-post")
            app.typeText("1. first\n"); pause(0.5); app.typeText("second\n"); pause(0.5); shot("writer-numbered-list")
        }

        // Chat list and the directory (no message is sent)
        for b in app.buttons.matching(NSPredicate(format: "label IN {'Close','Cancel','Discard'}")).allElementsBoundByIndex where b.isHittable { b.tap(); break }
        pause(1); shot("after-writer")
        let discard = app.buttons["Discard"]; if discard.exists { discard.tap(); pause(1) }
        let chat = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Chat'")).firstMatch
        if chat.exists && chat.isHittable { chat.tap(); pause(2.5); shot("chat") }
        let dir = app.buttons["Directory"]
        if dir.exists && dir.isHittable { dir.tap(); pause(2.5); shot("directory") }
    }
}
