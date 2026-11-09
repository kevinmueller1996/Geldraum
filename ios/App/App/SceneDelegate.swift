import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyCover: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = NjoraBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        guard let window, privacyCover == nil else { return }

        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = UIColor(red: 245.0 / 255, green: 240.0 / 255, blue: 232.0 / 255, alpha: 1)
        cover.accessibilityViewIsModal = true

        let brand = UILabel()
        brand.text = "Njora"
        brand.font = UIFont.systemFont(ofSize: 32, weight: .semibold)
        brand.textColor = UIColor(red: 77.0 / 255, green: 35.0 / 255, blue: 30.0 / 255, alpha: 1)
        brand.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(brand)
        NSLayoutConstraint.activate([
            brand.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            brand.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
        ])

        window.addSubview(cover)
        privacyCover = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

private final class NjoraBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let config = bridge?.config,
              let offline = config.errorPathURL,
              let arguments = try? JSONEncoder().encode([offline.absoluteString, config.appStartServerURL.absoluteString]),
              let urls = String(data: arguments, encoding: .utf8) else { return }

        let script = """
        (() => {
          const [offline, start] = \(urls);
          if (location.href === offline) {
            const retry = document.getElementById('retry');
            if (retry) retry.href = start;
          }
        })();
        """
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
    }
}
