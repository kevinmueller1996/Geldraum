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
    @Environment(\.colorScheme) var colorScheme

    private var paper: Color {
        colorScheme == .dark ? Color(red: 0.15, green: 0.12, blue: 0.11) : Color(red: 0.96, green: 0.94, blue: 0.91)
    }

    private var accent: Color {
        colorScheme == .dark ? Color(red: 0.94, green: 0.65, blue: 0.54) : Color(red: 0.30, green: 0.14, blue: 0.12)
    }

    private func euros(_ value: Double) -> String {
        value.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")))
    }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(metric.title, systemImage: metric.symbol)
                .font(.subheadline.weight(.semibold)).foregroundStyle(accent)
            if let data = entry.snapshot {
                Text(euros(metric == .balance ? data.balance : data.available))
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.55).privacySensitive()
                if family == .systemMedium {
                    if metric == .budget {
                        detail("Regelmäßiges Einkommen", euros(data.income))
                        detail("Fixkosten im Monatsmittel", euros(data.fixedCosts))
                    } else if Calendar.current.isDate(data.updated, inSameDayAs: entry.date) {
                        let forecast = data.forecastLow == data.forecastHigh
                            ? euros(data.forecastLow) : euros(data.forecastLow) + " – " + euros(data.forecastHigh)
                        detail("Prognose zum Monatsende", forecast)
                    } else {
                        Text("Für die heutige Prognose Njora öffnen.").font(.caption)
                    }
                }
                Spacer(minLength: 0)
                Text("Stand " + data.updated.formatted(.dateTime.day().month().hour().minute().locale(Locale(identifier: "de_DE"))))
                    .font(.caption2).foregroundStyle(.secondary)
            } else {
                Spacer(minLength: 0)
                Text("Njora öffnen, um deinen Finanzplan anzuzeigen.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(metric.url)
    }

    private func detail(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).multilineTextAlignment(.trailing).privacySensitive()
        }
        .font(.caption).minimumScaleFactor(0.85)
        .accessibilityElement(children: .combine)
    }

    var body: some View {
        if #available(iOS 17, *) {
            content.containerBackground(for: .widget) { paper }
        } else {
            content.padding().background(paper)
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
