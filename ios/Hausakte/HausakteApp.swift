import SwiftUI
import WebKit

@main
struct HausakteApp: App {
    @StateObject private var web = WebController()

    var body: some Scene {
        WindowGroup {
            WebScreen(webView: web.webView)
                .ignoresSafeArea(.container, edges: .bottom)
                .background(Color("Background").ignoresSafeArea())
                .onAppear { web.start() }
                .onOpenURL { web.handle(url: $0) }
        }
    }
}

/// The WKWebView inside SwiftUI.
struct WebScreen: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
