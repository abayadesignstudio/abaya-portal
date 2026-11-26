import UIKit
import UniformTypeIdentifiers

/// "Save to Commonplace": shows the passage, lets you trim it, then queues it for the app.
final class ShareViewController: UIViewController {
    private let text = UITextView()
    private var url: String? { didSet { showSource() } }
    private var pageTitle: String? { didSet { showSource() } }
    private let kinds = UISegmentedControl(items: ["Quote", "Vocab", "Entry"])
    private let label = UILabel(), note = UILabel(), from = UILabel()
    private let tan = UIColor(red: 0.176, green: 0.188, blue: 0.122, alpha: 1)
    private let paper = UIColor(red: 0.231, green: 0.243, blue: 0.165, alpha: 1)
    private let ink = UIColor(red: 0.945, green: 0.933, blue: 0.867, alpha: 1)
    private let card = UIColor(red: 0.255, green: 0.271, blue: 0.188, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = paper
        let bar = UIStackView(); bar.axis = .horizontal; bar.alignment = .center
        let cancel = UIButton(type: .system); cancel.setTitle("Cancel", for: .normal); cancel.tintColor = ink
        cancel.titleLabel?.font = .systemFont(ofSize: 17); cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        let title = UILabel(); title.text = "Save to Commonplace"; title.font = UIFont(name: "Georgia-Bold", size: 18); title.textColor = ink; title.textAlignment = .center
        var cfg = UIButton.Configuration.filled(); cfg.title = "Save"; cfg.baseBackgroundColor = ink; cfg.baseForegroundColor = paper; cfg.cornerStyle = .capsule
        let save = UIButton(configuration: cfg); save.addTarget(self, action: #selector(store), for: .touchUpInside)
        bar.addArrangedSubview(cancel); bar.addArrangedSubview(title); bar.addArrangedSubview(save)
        title.setContentHuggingPriority(.defaultLow, for: .horizontal)

        kinds.selectedSegmentIndex = 0; kinds.selectedSegmentTintColor = ink; kinds.backgroundColor = card
        kinds.setTitleTextAttributes([.foregroundColor: ink, .font: UIFont.systemFont(ofSize: 14, weight: .semibold)], for: .normal)
        kinds.setTitleTextAttributes([.foregroundColor: paper, .font: UIFont.systemFont(ofSize: 14, weight: .semibold)], for: .selected)
        kinds.addTarget(self, action: #selector(kindChanged), for: .valueChanged)
        from.font = .systemFont(ofSize: 13, weight: .medium); from.textColor = ink; from.numberOfLines = 2
        label.text = "THE PASSAGE"; label.font = .systemFont(ofSize: 11, weight: .bold); label.textColor = UIColor(red: 0.765, green: 0.765, blue: 0.651, alpha: 1)
        text.font = UIFont(name: "Georgia-Italic", size: 19); text.textColor = ink; text.backgroundColor = card
        text.layer.cornerRadius = 14; text.layer.borderWidth = 1; text.layer.borderColor = UIColor(red: 0.314, green: 0.325, blue: 0.227, alpha: 1).cgColor
        text.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        note.font = .systemFont(ofSize: 13); note.textColor = UIColor(red: 0.765, green: 0.765, blue: 0.651, alpha: 1); note.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [bar, kinds, label, text, from, note]); stack.axis = .vertical; stack.spacing = 12
        stack.setCustomSpacing(18, after: bar); stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            text.heightAnchor.constraint(equalToConstant: 220),
        ])
        kindChanged(); showSource()
        load()
    }

    private var kind: String { ["quote", "vocab", "entry"][max(0, kinds.selectedSegmentIndex)] }
    @objc private func kindChanged() {
        label.text = ["THE PASSAGE", "THE WORD", "THE ENTRY"][max(0, kinds.selectedSegmentIndex)]
        text.font = kind == "quote" ? UIFont(name: "Georgia-Italic", size: 19) : UIFont(name: "Georgia", size: 19)
        note.text = ["Saved to your notebook as a quote.", "Saved to your notebook as a vocabulary word; add its meaning there.", "Saved to your notebook as an entry."][max(0, kinds.selectedSegmentIndex)]
    }
    /// The page it came from, shown so it is plain that the address goes with it.
    private func showSource() {
        guard isViewLoaded else { return }
        let host = url.flatMap { URL(string: $0)?.host }.map { $0.hasPrefix("www.") ? String($0.dropFirst(4)) : $0 }
        if let host { from.text = "From  " + [pageTitle?.trimmingCharacters(in: .whitespacesAndNewlines), host].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: "  ·  ") }
        else { from.text = "No web address came with this. (Safari sends one; some apps send only the words.)" ; from.textColor = UIColor(red: 0.765, green: 0.765, blue: 0.651, alpha: 1); return }
        from.textColor = ink
    }
    /// Some apps put the address in with the words: the last web address in them is the source.
    private func adopt(_ s: String) {
        if text.text.isEmpty { text.text = s }
        guard url == nil, let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return }
        let found = d.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { $0.url }.filter { $0.scheme?.hasPrefix("http") == true }
        guard let u = found.last else { return }
        url = u.absoluteString
        // when the words are nothing but the passage and then its address, the address leaves the passage
        let t = text.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasSuffix(u.absoluteString), t.count > u.absoluteString.count { text.text = String(t.dropLast(u.absoluteString.count)).trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func load() {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        for item in items { for p in item.attachments ?? [] {
            if p.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) {
                p.loadItem(forTypeIdentifier: UTType.propertyList.identifier) { [weak self] obj, _ in
                    guard let d = obj as? NSDictionary, let r = d[NSExtensionJavaScriptPreprocessingResultsKey] as? NSDictionary else { return }
                    DispatchQueue.main.async {
                        if let s = r["selection"] as? String, !s.isEmpty { self?.text.text = s }
                        self?.url = r["url"] as? String; self?.pageTitle = r["title"] as? String
                    }
                }
            } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                p.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] obj, _ in
                    if let s = obj as? String { DispatchQueue.main.async { self?.adopt(s) } }
                }
            } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                p.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] obj, _ in
                    if let u = obj as? URL, u.scheme?.hasPrefix("http") == true { DispatchQueue.main.async { if self?.url == nil { self?.url = u.absoluteString } } }
                }
            }
        } }
    }

    @objc private func store() {
        let t = text.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || url != nil else { return close() }
        Inbox.push(.init(text: t, url: url, title: pageTitle, at: Date(), kind: kind))
        let done = UIAlertController(title: "Saved", message: "It goes into your notebook the next time Life of the Mind is opened.", preferredStyle: .alert)
        done.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.close() })
        present(done, animated: true)
    }
    @objc private func close() { extensionContext?.completeRequest(returningItems: nil) }
}
