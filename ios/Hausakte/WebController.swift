import SwiftUI
import UIKit
import WebKit
import WidgetKit

/// Shows the Hausakte web version and connects it with the device: widgets, speech input,
/// sharing files, opening links outside the app and commands from widgets ("hausakte://aktion/todo").
final class WebController: NSObject, ObservableObject {
    static let base = URL(string: "https://hausakte-eight.vercel.app/")!
    static let host = "hausakte-eight.vercel.app"

    let webView: WKWebView
    private let speech = Speech()
    private var started = false
    private var loaded = false
    private var pendingCommand: String?

    static var version: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0") + "." + (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
    }

    override init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "HausakteApp/\(WebController.version)"
        let content = WKUserContentController()
        // known to the page before its own code runs (src/native-speech.js)
        let boot = "window.HausakteIOS = { version: '\(WebController.version)', speech: \(Speech.isSupported ? "true" : "false") };"
        content.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = content
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        content.add(WeakMessageHandler(self), name: "hausakte")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "Background")
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        speech.onEvent = { [weak self] id, type, text, isFinal in
            self?.speechEvent(id: id, type: type, text: text, isFinal: isFinal)
        }
    }

    func start() {
        guard !started else { return }
        started = true
        let command = pendingCommand
        pendingCommand = nil
        webView.load(URLRequest(url: Self.url(for: command)))
    }

    // MARK: commands from widgets and links

    /// hausakte://aktion/todo, hausakte://ansicht/grundriss or a link to the web version
    func handle(url: URL) {
        var command: String?
        if url.scheme == "hausakte" {
            let kind = url.host ?? ""
            let arg = url.pathComponents.dropFirst().first ?? ""
            if (kind == "aktion" || kind == "ansicht"), !arg.isEmpty { command = "\(kind):\(arg)" }
        } else if url.host == Self.host {
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            if let a = comps?.queryItems?.first(where: { $0.name == "aktion" })?.value { command = "aktion:\(a)" }
            else if let f = url.fragment, !f.isEmpty, f != "cockpit" { command = "ansicht:\(f)" }
        }
        guard let command else { return }
        if !started { pendingCommand = command; return }
        if loaded { run(command) } else { pendingCommand = command }
    }

    static func url(for command: String?) -> URL {
        guard let command else { return base }
        if command.hasPrefix("aktion:") {
            let a = String(command.dropFirst(7))
            return URL(string: "?aktion=\(a.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? a)#cockpit", relativeTo: base)!.absoluteURL
        }
        let v = String(command.dropFirst(8))
        return URL(string: "#\(v.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? v)", relativeTo: base)!.absoluteURL
    }

    private func run(_ command: String) {
        let js = "(function(){try{if(window.__hausakteCommand){window.__hausakteCommand(\(Self.quote(command)));return 1}}catch(e){}return 0})()"
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            if (result as? Int) != 1, let self { self.webView.load(URLRequest(url: Self.url(for: command))) }
        }
    }

    static func quote(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(json.dropFirst().dropLast())
    }

    // MARK: speech

    private func speechEvent(id: Int, type: String, text: String, isFinal: Bool) {
        let js = "window.__hausakteSpeech&&window.__hausakteSpeech(\(id),'\(type)',\(Self.quote(text)),\(isFinal ? "true" : "false"))"
        DispatchQueue.main.async { self.webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    // MARK: files

    private func share(name: String, text: String) {
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do {
            try text.data(using: .utf8)?.write(to: url, options: .atomic)
        } catch {
            return
        }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = webView
            pop.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        topController()?.present(vc, animated: true)
    }

    private func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var top = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    fileprivate func openOutside(_ url: URL) {
        UIApplication.shared.open(url)
    }
}

// MARK: - messages from the page: window.webkit.messageHandlers.hausakte.postMessage({type, ...})

extension WebController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let id = (body["id"] as? NSNumber)?.intValue ?? 0
        switch type {
        case "widgets":
            if let json = body["json"] as? String {
                WidgetModel.save(json: json)
                WidgetCenter.shared.reloadAllTimelines()
            }
        case "speechStart":
            speech.start(id: id, lang: body["lang"] as? String ?? "de-DE", interim: (body["interim"] as? Bool) ?? true, continuous: (body["continuous"] as? Bool) ?? false)
        case "speechStop":
            speech.stop(id: id)
        case "speechAbort":
            speech.abort(id: id)
        case "saveText":
            share(name: body["name"] as? String ?? "hausakte.json", text: body["text"] as? String ?? "")
        case "openExternal":
            if let s = body["url"] as? String, let url = URL(string: s) { openOutside(url) }
        default:
            break
        }
    }
}

// MARK: - navigation: the app stays on the Hausakte, everything else opens outside

extension WebController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let scheme = url.scheme ?? ""
        if url.host == Self.host || ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }
        let mainFrame = action.targetFrame == nil || action.targetFrame?.isMainFrame == true
        if mainFrame {
            openOutside(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let c = pendingCommand {
            pendingCommand = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.run(c) }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

// MARK: - dialogs, new windows, camera/microphone

extension WebController: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == Self.host { webView.load(action.request) } else { openOutside(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        if let top = topController() { top.present(a, animated: true) } else { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Abbrechen", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        if let top = topController() { top.present(a, animated: true) } else { completionHandler(false) }
    }

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == Self.host ? .grant : .deny)
    }
}

/// Keeps the page's message handler from holding on to the controller.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
