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

    func representsSameSummary(as other: Self, calendar: Calendar = .current) -> Bool {
        calendar.isDate(updated, inSameDayAs: other.updated) &&
            balance == other.balance && income == other.income && fixedCosts == other.fixedCosts &&
            available == other.available && forecastLow == other.forecastLow && forecastHigh == other.forecastHigh
    }

    /// WidgetKit limits timeline reloads. An unrelated edit or a cloud acknowledgement
    /// does not need a reload when today's displayed values are already on disk.
    static func replace(with snapshot: WidgetSnapshot?) -> Bool {
        guard let file else {
            Logger.widget.error("Widget container unavailable")
            return snapshot == nil
        }
        do {
            if let snapshot {
                if let stored = read(), stored.representsSameSummary(as: snapshot) { return false }
                try JSONEncoder().encode(snapshot).write(to: file, options: [.atomic, .completeFileProtection])
                var url = file
                var options = URLResourceValues()
                options.isExcludedFromBackup = true
                try url.setResourceValues(options)
            } else {
                try FileManager.default.removeItem(at: file)
            }
            return true
        } catch CocoaError.fileNoSuchFile {
            // Invalidate any entry WidgetKit may still have cached after sign-out.
            return true
        } catch {
            Logger.widget.error("Widget summary could not be updated")
            return snapshot == nil
        }
    }
}

private extension Logger {
    static let widget = Logger(subsystem: "de.njora.finanzueberblick", category: "Widgets")
}
