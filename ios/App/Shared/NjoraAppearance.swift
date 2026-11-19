import SwiftUI

enum NjoraAppearance: String, CaseIterable {
    case original, sage, fjord

    var title: String {
        switch self {
        case .original: "Njora Original"
        case .sage: "Salbei"
        case .fjord: "Fjordblau"
        }
    }

    private static var preferenceFile: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.njora.finanzueberblick.widgets")?
            .appendingPathComponent("appearance.txt")
    }

    static func load() -> Self {
        guard let file = preferenceFile, let value = try? String(contentsOf: file, encoding: .utf8) else { return .original }
        return Self(rawValue: value) ?? .original
    }

    func save() throws {
        guard let file = Self.preferenceFile else { throw CocoaError(.fileNoSuchFile) }
        try Data(rawValue.utf8).write(to: file, options: .atomic)
    }

    var accent: Color {
        switch self {
        case .original: Color(day: (0.30, 0.14, 0.12), night: (0.94, 0.65, 0.54))
        case .sage: Color(day: (0.17, 0.34, 0.25), night: (0.65, 0.82, 0.68))
        case .fjord: Color(day: (0.14, 0.29, 0.42), night: (0.62, 0.79, 0.94))
        }
    }

    var paper: Color {
        switch self {
        case .original: Color(day: (0.96, 0.94, 0.91), night: (0.15, 0.12, 0.11))
        case .sage: Color(day: (0.93, 0.95, 0.92), night: (0.08, 0.13, 0.10))
        case .fjord: Color(day: (0.92, 0.95, 0.97), night: (0.08, 0.12, 0.16))
        }
    }

    var card: Color {
        switch self {
        case .original: Color(day: (1, 0.99, 0.97), night: (0.22, 0.18, 0.17))
        case .sage: Color(day: (0.98, 0.99, 0.97), night: (0.14, 0.20, 0.16))
        case .fjord: Color(day: (0.98, 0.99, 1), night: (0.14, 0.19, 0.24))
        }
    }

    static let positive = Color(day: (0.25, 0.38, 0.25), night: (0.59, 0.77, 0.57))
}

private extension Color {
    typealias RGB = (CGFloat, CGFloat, CGFloat)
    init(day: RGB, night: RGB) {
        self.init(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? night : day
            return UIColor(red: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1)
        })
    }
}

private enum AppearanceKey: EnvironmentKey {
    static let defaultValue = NjoraAppearance.original
}

extension EnvironmentValues {
    var njoraAppearance: NjoraAppearance {
        get { self[AppearanceKey.self] }
        set { self[AppearanceKey.self] = newValue }
    }
}
