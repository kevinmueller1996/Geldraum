import Foundation
import OSLog

/// Only dashboard totals cross the app/extension boundary.
struct WidgetSnapshot: Codable {
    let updated: Date
    let balance: Double
    let income: Double
    let fixedCosts: Double
    let available: Double
    let forecastLow: Double
    let forecastHigh: Double

    private static var file: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.de.njora.finanzueberblick.widgets")?
            .appendingPathComponent("budget-summary.json")
    }

    static func read() -> WidgetSnapshot? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }

    static func replace(with snapshot: WidgetSnapshot?) {
        guard let file else {
            Logger.widget.error("Widget container unavailable")
            return
        }
        do {
            if let snapshot {
                try JSONEncoder().encode(snapshot).write(to: file, options: [.atomic, .completeFileProtection])
                var url = file
                var options = URLResourceValues()
                options.isExcludedFromBackup = true
                try url.setResourceValues(options)
            } else {
                try FileManager.default.removeItem(at: file)
            }
        } catch CocoaError.fileNoSuchFile {
            // First launch or an already cleared session.
        } catch {
            Logger.widget.error("Widget summary could not be updated")
        }
    }
}

private extension Logger {
    static let widget = Logger(subsystem: "de.njora.finanzueberblick", category: "Widgets")
}
