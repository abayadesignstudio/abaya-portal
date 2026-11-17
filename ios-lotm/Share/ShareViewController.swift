import UIKit
import UniformTypeIdentifiers

/// "Save to Commonplace": shows the passage, lets you trim it, then queues it for the app.
final class ShareViewController: UIViewController {
    private let text = UITextView()
    private var url: String?
    private var pageTitle: String?
    private let tan = UIColor(red: 0.478, green: 0.404, blue: 0.282, alpha: 1)
    private let paper = UIColor(red: 0.953, green: 0.929, blue: 0.875, alpha: 1)
    private let ink = UIColor(red: 0.161, green: 0.145, blue: 0.122, alpha: 1)

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

        let label = UILabel(); label.text = "THE PASSAGE"; label.font = .systemFont(ofSize: 11, weight: .bold); label.textColor = tan
        text.font = UIFont(name: "Georgia-Italic", size: 19); text.textColor = ink; text.backgroundColor = .white
        text.layer.cornerRadius = 14; text.layer.borderWidth = 1; text.layer.borderColor = UIColor(red: 0.867, green: 0.824, blue: 0.749, alpha: 1).cgColor
        text.textContainerInset = UIEdgeInsets(top: 12, left: 10, bottom: 12, right: 10)
        let note = UILabel(); note.text = "It opens as a new Quote in Life of the Mind, where you can add the book, page and topics."
        note.font = .systemFont(ofSize: 13); note.textColor = UIColor(red: 0.435, green: 0.4, blue: 0.353, alpha: 1); note.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [bar, label, text, note]); stack.axis = .vertical; stack.spacing = 12
        stack.setCustomSpacing(18, after: bar); stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            text.heightAnchor.constraint(equalToConstant: 220),
        ])
        load()
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
                    if let s = obj as? String { DispatchQueue.main.async { if self?.text.text.isEmpty ?? true { self?.text.text = s } } }
                }
            } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                p.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] obj, _ in
                    if let u = obj as? URL { DispatchQueue.main.async { self?.url = self?.url ?? u.absoluteString } }
                }
            }
        } }
    }

    @objc private func store() {
        let t = text.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || url != nil else { return close() }
        Inbox.push(.init(text: t, url: url, title: pageTitle, at: Date()))
        let done = UIAlertController(title: "Saved", message: "Open Life of the Mind to finish the entry.", preferredStyle: .alert)
        done.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in self?.close() })
        present(done, animated: true)
    }
    @objc private func close() { extensionContext?.completeRequest(returningItems: nil) }
}
