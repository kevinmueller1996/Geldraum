import SwiftUI
import WidgetKit

private enum Metric: String {
    case balance, budget

    var title: String { self == .balance ? "Kontostand" : "Monatsspielraum" }
    var symbol: String { self == .balance ? "wallet.pass" : "calendar" }
    var url: URL? { URL(string: "njora://widget/" + rawValue) }
}

private struct Entry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    var appearance = NjoraAppearance.load()
}

private struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        let now = Date()
        return Entry(date: now, snapshot: WidgetSnapshot(updated: now, balance: 1460, income: 2800,
                     fixedCosts: 1920, available: 880, forecastLow: 1230, forecastHigh: 1380))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : Entry(date: .now, snapshot: .read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let current = Entry(date: now, snapshot: .read())
        // A projection is only valid for the day on which the app calculated it.
        let tomorrow = Calendar.current.startOfDay(for: Calendar.current.date(byAdding: .day, value: 1, to: now)!)
        let next = Entry(date: tomorrow, snapshot: current.snapshot)
        completion(Timeline(entries: [current, next], policy: .after(tomorrow)))
    }
}

private struct SummaryView: View {
    let metric: Metric
    let entry: Entry
    @Environment(\.widgetFamily) var family
    @Environment(\.dynamicTypeSize) private var dynamicType

    private func euros(_ value: Double) -> String {
        value.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")).rounded(rule: .toNearestOrAwayFromZero))
    }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: dynamicType.isAccessibilitySize ? 2 : 5) {
            let currentDay = entry.snapshot.map { Calendar.current.isDate($0.updated, inSameDayAs: entry.date) } ?? false
            let title = metric == .budget && entry.snapshot != nil && !currentDay ? "Letzter Spielraum" : metric.title
            let largeLayout = dynamicType > .accessibility1
            ViewThatFits(in: .horizontal) {
                Label(title, systemImage: metric.symbol).fixedSize()
                Text(title).fixedSize()
                Text(metric == .budget && (currentDay || largeLayout) ? "Spielraum" : title)
                    .lineLimit(dynamicType.isAccessibilitySize ? 1 : 2).minimumScaleFactor(0.6)
            }
            .font(.subheadline.weight(.semibold)).foregroundStyle(entry.appearance.accent)
            .accessibilityLabel(title)
            if let data = entry.snapshot {
                amount(metric == .balance ? data.balance : data.available)
                    .accessibilityValue(largeLayout && family == .systemMedium ? supplementalSummary(data, current: currentDay) : "")
                if family == .systemMedium && !largeLayout {
                    if metric == .budget {
                        detail(dynamicType.isAccessibilitySize ? "Einkommen" : "Regelmäßiges Einkommen", euros(data.income))
                        detail(dynamicType.isAccessibilitySize ? "Ø Fixkosten" : "Fixkosten im Monatsmittel", euros(data.fixedCosts))
                    } else if currentDay {
                        detail(dynamicType.isAccessibilitySize ? "Monatsende" : "Prognose zum Monatsende", forecast(data))
                    } else {
                        Text("Für die heutige Prognose Njora öffnen.").font(.caption)
                    }
                }
                Spacer(minLength: 0)
                let compactDate = family == .systemSmall || dynamicType.isAccessibilitySize
                let stamp = compactDate
                    ? data.updated.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year(.twoDigits).locale(Locale(identifier: "de_DE")))
                    : data.updated.formatted(.dateTime.day().month().year().locale(Locale(identifier: "de_DE")))
                Text(largeLayout ? stamp : "Stand " + stamp)
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
                    .accessibilityLabel("Stand " + stamp)
            } else {
                Spacer(minLength: 0)
                Text(dynamicType.isAccessibilitySize ? "Njora öffnen" : "Njora öffnen, um deinen Finanzplan anzuzeigen.")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(3).minimumScaleFactor(0.7)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Widgets have a fixed height. At the largest sizes keep the amount and its date visible.
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .widgetURL(metric.url)
    }

    private func supplementalSummary(_ data: WidgetSnapshot, current: Bool) -> String {
        if metric == .budget {
            return "Regelmäßiges Einkommen " + euros(data.income) + ", Fixkosten im Monatsmittel " + euros(data.fixedCosts)
        }
        guard current else { return "Für die heutige Prognose Njora öffnen." }
        return "Prognose zum Monatsende " + forecast(data)
    }

    private func forecast(_ data: WidgetSnapshot) -> String {
        data.forecastLow == data.forecastHigh
            ? euros(data.forecastLow) : euros(data.forecastLow) + " – " + euros(data.forecastHigh)
    }

    private func amount(_ value: Double) -> some View {
        let full = euros(value)
        let size: Font.TextStyle = family == .systemMedium && dynamicType.isAccessibilitySize ? .headline : .title
        return Group {
            if family == .systemSmall && abs(value) >= 1_000_000 {
                let abbreviated = value.formatted(.number.notation(.compactName)
                    .precision(.fractionLength(0...1)).locale(Locale(identifier: "de_DE")))
                ViewThatFits(in: .horizontal) {
                    Text(full).fixedSize()
                    Text("≈ " + abbreviated + " €").lineLimit(1).minimumScaleFactor(0.35)
                }
            } else {
                Text(full).lineLimit(1).minimumScaleFactor(0.45)
            }
        }
        .font(.system(size, design: .serif, weight: .semibold))
        .accessibilityLabel(full).privacySensitive()
    }

    private func detail(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).lineLimit(1).minimumScaleFactor(0.6).layoutPriority(1)
                .multilineTextAlignment(.trailing).privacySensitive()
        }
        .font(.caption).minimumScaleFactor(0.85)
        .accessibilityElement(children: .combine)
    }

    var body: some View {
        if #available(iOS 17, *) {
            content.containerBackground(for: .widget) { entry.appearance.paper }
        } else {
            content.padding().background(entry.appearance.paper)
        }
    }
}

private extension Metric {
    var configuration: some WidgetConfiguration {
        let metric = self
        return StaticConfiguration(kind: "Njora." + metric.rawValue, provider: Provider()) { entry in
            SummaryView(metric: metric, entry: entry)
        }
        .configurationDisplayName(metric.title)
        .description(metric == .balance ? "Dein Nettokontostand und die Prognose zum Monatsende." :
                     "Dein monatlicher Spielraum nach Abzug der Fixkosten.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct BalanceWidget: Widget {
    var body: some WidgetConfiguration { Metric.balance.configuration }
}

private struct BudgetWidget: Widget {
    var body: some WidgetConfiguration { Metric.budget.configuration }
}

@main
struct NjoraWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
        BudgetWidget()
    }
}
