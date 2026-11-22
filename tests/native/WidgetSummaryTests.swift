// Compile alongside ios/App/Shared/WidgetSnapshot.swift and run as a standalone test.
import Foundation

@main
struct WidgetSummaryTests {
    private static func snapshot(at date: Date, changing index: Int? = nil) -> WidgetSnapshot {
        var amounts = [-250.0, 3800, 2700, 1100, 500, 800]
        if let index { amounts[index] += 0.01 }
        return WidgetSnapshot(updated: date, balance: amounts[0], income: amounts[1], fixedCosts: amounts[2],
                              available: amounts[3], forecastLow: amounts[4], forecastHigh: amounts[5])
    }

    static func main() throws {
        var berlin = Calendar(identifier: .gregorian)
        berlin.timeZone = TimeZone(identifier: "Europe/Berlin")!
        let format = ISO8601DateFormatter()
        // Germany's spring-forward day lasts 23 hours. Use the local midnight, not a 24-hour interval.
        let morning = format.date(from: "2026-03-28T23:01:00Z")!
        let evening = format.date(from: "2026-03-29T21:59:00Z")!
        let midnight = format.date(from: "2026-03-29T22:00:00Z")!
        let initial = snapshot(at: morning)
        let later = snapshot(at: evening)
        precondition(initial.representsSameSummary(as: later, calendar: berlin))
        precondition(!later.representsSameSummary(as: snapshot(at: midnight), calendar: berlin))
        for index in 0..<6 {
            precondition(!initial.representsSameSummary(as: snapshot(at: evening, changing: index), calendar: berlin))
        }
        let stored = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(initial))
        precondition(stored.representsSameSummary(as: initial, calendar: berlin))
        print("PASS: same-day changes, all six amount fields, local midnight across DST and file roundtrip")
    }
}
