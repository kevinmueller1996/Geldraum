import Charts
import SwiftUI

private enum DashboardLayout {
    static let maxWidth: CGFloat = 1120
    static let readingWidth: CGFloat = 820

    static func columns<Content: View>(_ wide: Bool, @ViewBuilder content: () -> Content) -> some View {
        let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                          : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
        return layout { content() }
    }
}

struct ComparisonPicker: View {
    @ObservedObject var store: NjoraStore
    var body: some View {
        Picker("Vergleichswerte", selection: Binding(get: { store.comparisonNet }, set: { store.comparisonOverride = $0 })) {
            Text("Brutto").tag(false)
            Text("Netto").tag(true)
        }.pickerStyle(.segmented)
    }
}

enum DashboardTab: Hashable { case today, revenue, month, loans, goals, more }

struct Dashboard: View {
    @Environment(\.njoraAppearance) private var theme
    @ObservedObject var store: NjoraStore
    @Binding var tab: DashboardTab
    @State private var businessTab = DashboardTab.today

    var body: some View {
        if let plan = store.plan {
            let business = store.workspace == .business
            let navigation = TabView(selection: business ? $businessTab : $tab) {
                NavigationStack {
                    Group {
                        if business {
                            BusinessOverview(store: store, plan: plan, tab: $businessTab)
                        } else {
                            Overview(plan: plan, store: store)
                                .navigationTitle("Heute").navigationBarTitleDisplayMode(.inline)
                                .toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) } }
                        }
                    }
                        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                        .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                }.tabItem { Label("Heute", systemImage: "sun.max") }.tag(DashboardTab.today)
                if business {
                    NavigationStack {
                        BusinessRevenueView(store: store)
                            .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                    }.tabItem { Label("Umsatz", systemImage: "chart.bar") }.tag(DashboardTab.revenue)
                }
                NavigationStack {
                    MonthlyPlan(plan: plan, store: store)
                        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                        .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                }.tabItem { Label("Monatsplan", systemImage: "calendar") }.tag(DashboardTab.month)
                NavigationStack {
                    PlanSectionView(section: .loans, store: store)
                        .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                }.tabItem { Label("Kredite", systemImage: "banknote") }.tag(DashboardTab.loans)
                if !business {
                    NavigationStack {
                        PlanSectionView(section: .goals, store: store)
                            .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                    }.tabItem { Label("Ziele", systemImage: "target") }.tag(DashboardTab.goals)
                }
                NavigationStack {
                    List {
                        NavigationLink(business ? "Geschäftskonten" : "Konten & Karten") { PlanSectionView(section: .accounts, store: store) }
                        NavigationLink(business ? "Vermögenswerte" : "Ersparnisse & Depot") { PlanSectionView(section: .savings, store: store) }
                        NavigationLink("Verlauf der Kontostände") { PlanSectionView(section: .history, store: store) }
                    }
                    .navigationTitle("Mehr")
                    .njoraNavigationBackground()
                    .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                    .scrollContentBackground(.hidden).background(theme.paper)
                        .toolbar { ToolbarItem(placement: .navigationBarLeading) { WorkspacePicker(store: store) } }
                }.tabItem { Label("Mehr", systemImage: "ellipsis") }.tag(DashboardTab.more)
            }
            if #available(iOS 18, *), UIDevice.current.userInterfaceIdiom == .pad {
                navigation.tabViewStyle(.sidebarAdaptable)
            } else {
                navigation
            }
        }
    }

}

struct WorkspacePicker: View {
    @ObservedObject var store: NjoraStore

    var body: some View {
        Menu {
            ForEach(FinanceWorkspace.allCases, id: \.self) { choice in
                Button { Task { await store.switchWorkspace(to: choice) } } label: {
                    if choice == store.workspace { Label(store.workspaceName(choice), systemImage: "checkmark") }
                    else { Text(store.workspaceName(choice)) }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(store.workspaceName(store.workspace)).lineLimit(1).truncationMode(.tail)
                Image(systemName: "chevron.down").font(.caption2)
            }
        }.disabled(store.busy)
        .accessibilityLabel("Finanzbereich: " + store.workspaceName(store.workspace))
        .accessibilityIdentifier("njora.workspace")
    }
}

private struct ForecastCard: View {
    @Environment(\.njoraAppearance) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize
    let metrics: PlanMetrics
    @ObservedObject var store: NjoraStore

    var body: some View {
        let forecast = metrics.forecast
        NavigationLink { ForecastDetail(store: store) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Prognose zum Monatsende").font(.headline)
                    Spacer()
                    if !typeSize.isAccessibilitySize {
                        Image(systemName: "chevron.right").font(.footnote.bold()).accessibilityHidden(true)
                    }
                }
                Text("≈ " + euros(forecast.projectedBalance))
                    .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.65)
                    .accessibilityLabel("Ungefähr " + euros(forecast.projectedBalance))
                let basis = metrics.flexibleBudget > 0 ? "Mit Zahlungen und anteiligem Monatsbudget" : "Mit datierten Zahlungen"
                Text(forecast.uncertain.isEmpty ? basis : basis + " · " + (forecast.uncertain.count == 1 ? "1 Buchung offen" : "\(forecast.uncertain.count) Buchungen offen"))
                    .font(.footnote)
            }
            .foregroundStyle(theme.paper)
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.accent, in: RoundedRectangle(cornerRadius: 18))
        }.buttonStyle(.plain)
        .accessibilityIdentifier("njora.overview.forecast")
    }
}

private struct BusinessOverview: View {
    @Environment(\.njoraAppearance) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var columnThreshold: CGFloat = 820
    @ObservedObject var store: NjoraStore
    let plan: Plan
    @Binding var tab: DashboardTab
    @State private var checkIn = false

    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        GeometryReader { window in
            ScrollView {
                DashboardLayout.columns(window.size.width >= columnThreshold && !typeSize.isAccessibilitySize) {
                    VStack(spacing: 14) {
                        ForecastCard(metrics: metrics, store: store)
                        ComparisonPicker(store: store)
                        revenueCard
                    }.frame(maxWidth: .infinity)
                    VStack(spacing: 14) {
                        monthlyCard(metrics)
                        VStack(alignment: .leading, spacing: 0) {
                            NavigationLink { PlanSectionView(section: .savings, store: store) } label: {
                                row("Vermögenswerte", value: euros(plan[.savings].reduce(0) { $0 + $1.savingValue }))
                            }
                            Divider()
                            Button { tab = .loans } label: {
                                row("Offene Kreditschuld", value: euros(plan[.loans].reduce(0) { $0 + $1.loanSchedule().balance }))
                            }
                        }.njoraCard(theme.card)
                    }.frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 22).padding(.vertical, 12)
                .frame(maxWidth: DashboardLayout.maxWidth).frame(maxWidth: .infinity)
                if store.conflict || (store.needsSync && !store.syncing) { Notice(text: store.syncStatus) }
                Notice(text: store.notice(in: .overview))
            }
            .refreshable { await store.refresh(in: .overview) }
        }
        .fixedPageHeader {
            NavigationLink { PlanSectionView(section: .accounts, store: store) } label: {
                FinancialTitle(title: "Heute", amount: metrics.net, caption: "Geschäftskonten · netto")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 22).padding(.vertical, 8)
            .frame(maxWidth: DashboardLayout.maxWidth).frame(maxWidth: .infinity)
        }
        .navigationTitle("Heute")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) } }
        .sheet(isPresented: $checkIn) { CheckInView(plan: plan, store: store) }
    }

    private var revenueCard: some View {
        let month = PlanDate.previousRevenueMonth(for: .now)
        let amount = plan.revenueValue(month.key, net: store.comparisonNet)
        return VStack(alignment: .leading, spacing: 8) {
            Button { tab = .revenue } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text((store.comparisonNet ? "Nettoumsatz · " : "Bruttoumsatz · ") + month.title).font(.subheadline).foregroundStyle(.secondary)
                    row(amount.map(euros) ?? (plan.monthlyRevenue[month.key] == nil ? "Noch offen" : "Steuerangabe fehlt"), value: nil)
                        .font(.title2.weight(.semibold))
                }
            }.accessibilityHint("Öffnet die Umsatzübersicht der letzten zwölf Monate.")
            Divider()
            Button { checkIn = true } label: {
                Label("Check-in öffnen", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }.accessibilityHint("Umsatz und Kontostände erfassen.")
        }.njoraCard(theme.card)
    }

    private func monthlyCard(_ metrics: PlanMetrics) -> some View {
        let totals = metrics.comparisonTotals(net: store.comparisonNet, forecastMonth: String(PlanDate.string(metrics.today).prefix(7)))
        return VStack(alignment: .leading, spacing: 0) {
            Text(store.comparisonNet ? "Monatsplanung netto" : "Monatsplanung brutto").font(.headline).accessibilityAddTraits(.isHeader).padding(.bottom, 6)
            NavigationLink { PlanSectionView(section: .income, store: store) } label: {
                row("Regelmäßige Einnahmen", value: euros(totals.income - totals.confirmed))
            }
            if totals.confirmed > 0 {
                Divider()
                NavigationLink { OwnedForecastView(store: store) } label: {
                    row("Zugesagter Umsatz", value: euros(totals.confirmed))
                }
            }
            Divider()
            NavigationLink { PlanSectionView(section: .expenses, store: store) } label: {
                row("Fixkosten inkl. Kreditraten", value: euros(totals.fixed))
            }
            Divider()
            NavigationLink { PlanSectionView(section: .flexible, store: store) } label: {
                row("Flexible Kosten", value: euros(totals.flexible))
            }
            Divider()
            Button { tab = .month } label: {
                row(totals.surplus < 0 ? "Fehlbetrag" : "Überschuss", value: euros(totals.surplus))
                    .fontWeight(.semibold)
            }
        }.njoraCard(theme.card)
    }

    private func row(_ title: String, value: String?) -> some View {
        HStack(spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack { Text(title).fixedSize(); Spacer(minLength: 8); if let value { Text(value).fixedSize() } }
                VStack(alignment: .leading, spacing: 4) { Text(title); if let value { Text(value) } }
            }
            .monospacedDigit().frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary).accessibilityHidden(true)
        }
        .frame(minHeight: 44).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct ProfileButton: View {
    @ObservedObject var store: NjoraStore
    @State private var showSettings = false

    var body: some View {
        Button { showSettings = true } label: {
            Label("Konto & Einstellungen", systemImage: "person.crop.circle")
        }
        .accessibilityIdentifier("njora.profile")
        .sheet(isPresented: $showSettings) { NavigationStack { SettingsView(store: store) } }
    }
}

struct Overview: View {
    @Environment(\.njoraAppearance) private var theme
    let plan: Plan
    @ObservedObject var store: NjoraStore
    @State private var checkIn = false
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        GeometryReader { window in
            let wide = window.size.width >= columnThreshold && !typeSize.isAccessibilitySize
            let hasDetails = !plan[.history].isEmpty || !metrics.annualIncome.isEmpty || !metrics.specialCosts.isEmpty
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    DashboardLayout.columns(wide && hasDetails) {
                        VStack(alignment: .leading, spacing: 14) {
                            primaryCards(metrics, columns: typeSize.isAccessibilitySize ? 1 : (wide && !hasDetails ? 4 : 2))
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        if hasDetails {
                            VStack(alignment: .leading, spacing: 14) {
                                detailCards(metrics, wide: wide)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if store.conflict || (store.needsSync && !store.syncing) { Notice(text: store.syncStatus) }
                    Notice(text: store.notice(in: .overview))
                }
                .padding(22).frame(maxWidth: DashboardLayout.maxWidth).frame(maxWidth: .infinity)
            }
            .refreshable { await store.refresh(in: .overview) }
        }
        .background(theme.paper)
        .fixedPageHeader {
            HStack(spacing: 8) {
                NavigationLink { PlanSectionView(section: .accounts, store: store) } label: {
                    FinancialTitle(title: "Heute", amount: metrics.net, caption: "Kontostand")
                }
                .buttonStyle(.plain)
                if plan[.accounts].isEmpty {
                    NavigationLink { PlanSectionView(section: .accounts, store: store) } label: {
                        balanceActionIcon("plus")
                    }
                    .accessibilityLabel("Erstes Konto anlegen")
                } else {
                    Button { checkIn = true } label: { balanceActionIcon("pencil") }
                        .accessibilityLabel("Kontostände aktualisieren")
                        .accessibilityHint("Öffnet den Check-in für deine Konten.")
                        .accessibilityIdentifier("njora.overview.checkIn")
                }
            }
            .padding(.horizontal, 22).padding(.vertical, 8)
            .frame(maxWidth: DashboardLayout.maxWidth)
            .frame(maxWidth: .infinity)
            .background(theme.paper)
        }
        .sheet(isPresented: $checkIn) { CheckInView(plan: plan, store: store) }
    }
    @ScaledMetric(relativeTo: .body) private var columnThreshold: CGFloat = 820

    @ViewBuilder private func primaryCards(_ metrics: PlanMetrics, columns: Int) -> some View {
        ForecastCard(metrics: metrics, store: store)

        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .topLeading), count: columns), spacing: 12) {
            NavigationLink { PlanSectionView(section: .income, store: store) } label: {
                metric("Einkommen im " + monthNames[metrics.month], value: euros(metrics.incomeThisMonth))
            }
            NavigationLink { PlanSectionView(section: .expenses, store: store) } label: {
                metric("Fixkosten · Ø pro Monat", value: euros(metrics.fixedCosts))
            }
            NavigationLink { PlanSectionView(section: .flexible, store: store) } label: {
                metric("Flexible Kosten · pro Monat", value: euros(metrics.flexibleBudget))
            }
            NavigationLink {
                MonthlyPlan(plan: store.plan ?? plan, store: store)
                    .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
            } label: {
                metric("Monatlicher Spielraum", value: euros(metrics.available))
            }
            NavigationLink { PlanSectionView(section: .loans, store: store) } label: {
                metric("Offene Kreditschuld", value: euros(plan[.loans].reduce(0) { $0 + $1.loanSchedule().balance }))
            }
        }.buttonStyle(.plain)
    }

    @ViewBuilder private func detailCards(_ metrics: PlanMetrics, wide: Bool) -> some View {
        if !metrics.annualIncome.isEmpty || !metrics.specialCosts.isEmpty {
            VStack(alignment: .leading, spacing: 11) {
                Text("Sonderposten in diesem Monat").font(.headline)
                ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                ForEach(metrics.specialCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
            }.njoraCard(theme.card)
        }
        if !plan[.history].isEmpty {
            NavigationLink { PlanSectionView(section: .history, store: store) } label: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("Kontostände im Verlauf").font(.headline); Spacer(); Image(systemName: "chevron.right") }
                    BalanceChart(plan: plan, height: wide ? 250 : 170)
                }.njoraCard(theme.card)
            }.buttonStyle(.plain)
            .accessibilityIdentifier("njora.overview.history")
        }
    }

    private func balanceActionIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.accent)
            .frame(width: 34, height: 34)
            .background(theme.accent.opacity(0.10), in: Circle())
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }

    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
                .frame(minHeight: 40, alignment: .topLeading)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
                .foregroundStyle(.primary)
                .lineLimit(1).minimumScaleFactor(0.65)
        }
        .njoraCard(theme.card)
        .accessibilityElement(children: .combine)
    }

}

private struct ForecastDetail: View {
    @ObservedObject var store: NjoraStore
    @State private var selectedEntry: ForecastEntry?
    @State private var checkingBalance = false
    var body: some View {
        if let plan = store.plan {
            let metrics = PlanMetrics(plan: plan)
            let forecast = metrics.forecast
            List {
                Section(store.workspace == .business ? "Zahlungsbeträge ab heute · brutto" : "Rechnung ab heute") {
                    Button { checkingBalance = true } label: {
                        HStack {
                            LabeledAmount(label: "Kontoguthaben gesamt", amount: forecast.positiveBalance)
                            disclosure
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    if forecast.overdrafts < 0 {
                        Button { checkingBalance = true } label: {
                            HStack {
                                LabeledAmount(label: "Überzogene Konten", amount: forecast.overdrafts)
                                disclosure
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    ForEach(forecast.rowsFromToday) { row in
                        entryButton(row, dated: true)
                    }
                }
                if metrics.flexibleBudget > 0 {
                    Section("Zwischenstand") {
                        LabeledAmount(label: forecast.rowsFromToday.contains(where: { $0.cardReserve }) ? "Nach Zahlungen und Kartenrücklagen" : "Nach datierten Zahlungen", amount: forecast.datedBalance)
                    }
                    Section("Budget bis Monatsende") {
                        NavigationLink { PlanSectionView(section: .flexible, store: store) } label: {
                            LabeledAmount(label: "Flexible Kosten ab heute", amount: -forecast.remainingBudget)
                        }
                    }
                }
                Section("Ergebnis") {
                    LabeledAmount(label: "Prognose zum Monatsende", amount: forecast.projectedBalance, emphasis: true)
                        .font(.headline)
                }
                if !forecast.uncertain.isEmpty {
                    Section("Buchungsstatus unklar") {
                        ForEach(forecast.uncertain) { row in
                            entryButton(row, dated: false)
                        }
                    }
                    Section("Möglicher Stand am Monatsende") {
                        LabeledAmount(label: "Untergrenze", amount: forecast.low)
                        LabeledAmount(label: "Obergrenze", amount: forecast.high)
                        Text("Unten sind alle offenen Ausgaben berücksichtigt, oben alle offenen Einnahmen.").font(.footnote)
                    }
                }
                Section {
                    Text("Die Rechnung setzt einen aktuellen Kontostand voraus. Frühere Fälligkeiten gelten als gebucht. Spätere zählen vollständig. Ungeplante Ausgaben sind offen.")
                    if let date = plan[.history].map({ $0.fields.text("date") }).max(), let last = PlanDate.parse(date) {
                        Text("Letzter Check-in: " + last.formatted(date: .abbreviated, time: .omitted))
                    }
                }.font(.footnote).foregroundStyle(.secondary)
            }
            .sheet(item: $selectedEntry) { entry in
                PlanEditor(section: entry.section, item: entry.item, plan: plan, store: store)
            }
            .sheet(isPresented: $checkingBalance) { CheckInView(plan: plan, store: store) }
            .navigationTitle("Monatsendprognose")
            .njoraNavigationBackground()
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
        }
    }
    private var disclosure: some View {
        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
            .foregroundStyle(.tertiary).accessibilityHidden(true)
    }
    private func entryButton(_ row: ForecastEntry, dated: Bool) -> some View {
        Button { selectedEntry = row } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    if row.section == .accounts {
                        let date = row.bookingDate.map { $0.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "de_DE"))) }
                        LabeledAmount(label: [date, "Kartenausgleich " + row.item.name].compactMap { $0 }.joined(separator: " · "), amount: row.amount)
                        if row.cardReserve {
                            Text(date == nil ? "Zurückgelegt · Buchungstag offen" : "Für nächsten Monat zurückgelegt")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } else {
                        LabeledAmount(label: dated ? "\(row.day). · " + row.item.name : row.item.name, amount: row.amount)
                    }
                    if !dated && row.section != .accounts {
                        Text(row.item.frequency == .once ? "Offen · fällig am " + row.item.fields.text("dueDate") : row.monthUnknown ? "Monat offen" : row.day == 0 ? "Ohne Buchungstag" : "Heute fällig · im Kontostand eventuell schon enthalten")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                disclosure
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Eintrag bearbeiten")
    }

}

struct MonthlyPlan: View {
    @Environment(\.njoraAppearance) private var theme
    let plan: Plan
    @ObservedObject var store: NjoraStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var columnThreshold: CGFloat = 820

    @State private var chosenMonth = ""

    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        let business = store.workspace == .business
        let net = business && store.comparisonNet
        let options = business ? plan.planningMonths(asOf: metrics.today) : []
        let month = options.contains(chosenMonth) ? chosenMonth : String(PlanDate.string(metrics.today).prefix(7))
        let totals = metrics.comparisonTotals(net: net, forecastMonth: business ? month : nil)
        let categories = net ? metrics.rankedCategories.sorted { $0.net != $1.net ? $0.net > $1.net : $0.name.localizedStandardCompare($1.name) == .orderedAscending } : metrics.rankedCategories
        GeometryReader { window in
            let wide = window.size.width >= columnThreshold && !typeSize.isAccessibilitySize
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if business {
                        Picker("Planmonat", selection: Binding(get: { month }, set: { chosenMonth = $0 })) {
                            ForEach(options, id: \.self) { Text(PlanDate.revenueTitle($0)).tag($0) }
                        }.pickerStyle(.menu)
                        ComparisonPicker(store: store)
                    }
                    DashboardLayout.columns(wide && !categories.isEmpty) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(business ? "Monatsplanung" : "Monatsdurchschnitt").font(.headline).accessibilityAddTraits(.isHeader)
                            if business {
                                LabeledAmount(label: "Geplante Einnahmen", amount: totals.income)
                                Divider()
                            }
                            monthRow(section: .income) {
                                LabeledAmount(label: store.workspace == .business ? (net ? "Regelmäßige Einnahmen netto" : "Regelmäßige Einnahmen brutto") : "Regelmäßiges Einkommen", amount: net ? metrics.netRegularIncome : metrics.income,
                                              detail: store.workspace == .business ? euros(net ? metrics.income : metrics.netRegularIncome) + (net ? " brutto" : " netto") : nil)
                            }
                            Divider()
                            if business {
                                NavigationLink { OwnedForecastView(store: store) } label: {
                                    LabeledAmount(label: "Zugesagter Umsatz", amount: totals.confirmed)
                                }
                                Divider()
                            }
                            monthRow(section: .expenses) {
                                LabeledAmount(label: store.workspace == .business ? (net ? "Betriebskosten netto inkl. Kreditraten" : "Betriebskosten brutto inkl. Kreditraten") : "Fixkosten", amount: -totals.fixed,
                                              detail: store.workspace == .business ? euros(-metrics.monthlyFixedCosts(net: !net)) + (net ? " brutto" : " netto") : nil)
                            }
                            Divider()
                            monthRow(section: .flexible) {
                                LabeledAmount(label: store.workspace == .business ? (net ? "Flexible Kosten netto" : "Flexible Kosten brutto") : "Flexible Kosten", amount: -totals.flexible,
                                              detail: store.workspace == .business ? euros(net ? -metrics.flexibleBudget : -metrics.netFlexibleBudget) + (net ? " brutto" : " netto") : nil)
                            }
                        }
                        .njoraCard(theme.card)
                        if !categories.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Durchschnittliche Kosten je Kategorie").font(.headline).accessibilityAddTraits(.isHeader)
                                Text(totals.income > 0 ? (store.workspace == .business ? (net ? "Anteil an den geplanten Nettoeinnahmen" : "Anteil an den geplanten Bruttoeinnahmen") : "Anteil am regelmäßigen Monatseinkommen") : "Für Prozentanteile Einnahmen eintragen.")
                                    .font(.footnote).foregroundStyle(.secondary)
                                ForEach(categories, id: \.name) { category in
                                    Divider()
                                    categoryRow(category, income: totals.income, net: net)
                                }
                            }
                            .njoraCard(theme.card)
                        }
                    }
                    Notice(text: store.notice(in: .month))
                }
                .padding(22).frame(maxWidth: DashboardLayout.maxWidth).frame(maxWidth: .infinity)
            }
            .refreshable { await store.refresh(in: .month) }
        }.background(theme.paper)
        .financialTitle("Monatsplan", width: DashboardLayout.maxWidth, amount: totals.surplus,
                        caption: business ? (net ? "Saldo netto im Planmonat" : "Saldo brutto im Planmonat") : "Spielraum pro Monat")
    }

    private func categoryRow(_ category: (name: String, amount: Double, net: Double), income: Double, net: Bool) -> some View {
        monthRow(section: .expenses, category: category.name) {
            let amount = net ? category.net : category.amount
            let share = income > 0 ? amount / income : nil
            VStack(alignment: .leading, spacing: 6) {
                let percent = share.map { $0.formatted(.percent.precision(.fractionLength(0...1)).locale(Locale(identifier: "de_DE"))) }
                LabeledAmount(label: category.name, amount: amount,
                              detail: store.workspace == .business ? [(net ? "netto · " + euros(category.amount) + " brutto" : "brutto · " + euros(category.net) + " netto"), percent].compactMap { $0 }.joined(separator: " · ") : percent)
                GeometryReader { area in
                    let ratio = min(1, max(0, share ?? 0))
                    ZStack(alignment: .leading) {
                        Capsule().fill(theme.accent.opacity(0.14))
                        Capsule().fill(theme.accent).frame(width: area.size.width * ratio)
                    }
                }
                .frame(height: 4)
                .accessibilityHidden(true)
            }
            .padding(.vertical, 5)
            .accessibilityElement(children: .combine)
        }
    }

    private func monthRow<Label: View>(section: PlanSection, category: String? = nil, @ViewBuilder label: () -> Label) -> some View {
        NavigationLink {
            PlanSectionView(section: section, store: store, category: category)
        } label: {
            HStack(spacing: 12) {
                label().frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }.frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct BalanceChart: View {
    @Environment(\.njoraAppearance) private var theme
    let plan: Plan
    var height: CGFloat = 170
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        Chart(plan.entriesByDueDate(in: .history).suffix(30)) { snapshot in
            if let day = PlanDate.parse(snapshot.fields.text("date")) {
                LineMark(x: .value("Datum", day), y: .value("Stand", metrics.net(for: snapshot)))
                    .foregroundStyle(theme.accent)
                PointMark(x: .value("Datum", day), y: .value("Stand", metrics.net(for: snapshot)))
                    .foregroundStyle(theme.accent)
            }
        }.frame(height: height)
    }
}

struct LabeledAmount: View {
    let label: String
    let amount: Double
    var emphasis = false
    var detail: String? = nil
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { Text(label).fixedSize(horizontal: true, vertical: false); Spacer(); number.fixedSize() }
            VStack(alignment: .leading, spacing: 4) { Text(label); number }
        }
    }
    private var number: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(euros(amount)).monospacedDigit().fontWeight(emphasis ? .semibold : .regular)
                .foregroundStyle(amount < 0 ? Color.red : emphasis ? NjoraAppearance.positive : Color.primary)
            if let detail { Text(detail).font(.caption).monospacedDigit().foregroundStyle(.secondary) }
        }
    }
}

extension View {
    func njoraNavigationBackground() -> some View {
        modifier(NjoraNavigationBackground())
    }

    fileprivate func fixedPageHeader<Header: View>(@ViewBuilder _ header: () -> Header) -> some View {
        VStack(spacing: 0) {
            header().fixedSize(horizontal: false, vertical: true)
            self.clipped()
        }
        .njoraNavigationBackground()
    }

    fileprivate func financialTitle(_ title: String, width: CGFloat = DashboardLayout.readingWidth, amount: Double?, caption: String) -> some View {
        self.fixedPageHeader {
            FinancialTitle(title: title, amount: amount, caption: caption)
                .padding(.horizontal, 22).padding(.vertical, 8)
                .frame(maxWidth: width).frame(maxWidth: .infinity)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
            }
        }
    }

    func njoraCard(_ background: Color) -> some View {
        self.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct NjoraNavigationBackground: ViewModifier {
    @Environment(\.njoraAppearance) private var theme
    func body(content: Content) -> some View {
        content
            .background(theme.paper)
            .toolbarBackground(theme.paper, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

private struct FinancialTitle: View {
    let title: String
    let amount: Double?
    let caption: String

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    heading
                    total.frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    heading.fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    total.layoutPriority(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var heading: some View {
        Text(title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("njora.financialTitle")
    }
    private var total: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(amount.map(euros) ?? "–").font(.title2.weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.75)
            Text(caption).font(.caption).foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(caption).accessibilityValue(amount.map(euros) ?? "Kein Eintrag")
        .accessibilityIdentifier("njora.financialTotal")
    }
}

private extension PlanMetrics {
    func titleTotal(for section: PlanSection, compareNet: Bool) -> (amount: Double?, caption: String) {
        switch section {
        case .flexible: (compareNet ? netFlexibleBudget : flexibleBudget, "pro Monat")
        case .expenses: (monthlyFixedCosts(net: compareNet), "Ø pro Monat")
        case .income: (compareNet ? netRegularIncome + annualIncome.reduce(0) { $0 + $1.netAmount } : incomeThisMonth, "im " + monthNames[month])
        case .annual: (compareNet ? plan[.annual].reduce(0) { $0 + $1.netAmount } : plan[.annual].sum("amount"), "pro Jahr")
        case .accounts: (net, "Nettostand")
        case .loans: (plan[.loans].reduce(0) { $0 + $1.loanSchedule().balance }, "Restschuld")
        case .goals: (plan[.goals].sum("saved"), "bereits gespart")
        case .savings: (plan[.savings].reduce(0) { $0 + $1.savingValue }, "Gesamtwert")
        case .history: (plan[.history].max { $0.fields.text("date") < $1.fields.text("date") }.map { net(for: $0) }, "letzter Check-in")
        }
    }
}

struct PlanSectionView: View {
    @Environment(\.njoraAppearance) private var theme
    let section: PlanSection
    @ObservedObject var store: NjoraStore
    var category: String? = nil
    private func matches(_ name: String) -> Bool {
        category.map { $0.caseInsensitiveCompare(name) == .orderedSame } ?? true
    }
    private var businessAssets: Bool { section == .savings && store.workspace == .business }
    private var addTitle: String { businessAssets ? "Vermögenswert hinzufügen" : section.addTitle }
    private var newItem: PlanItem {
        var item = section.newItem
        if store.workspace == .business {
            switch section {
            case .accounts: item.fields["name"] = .string("Geschäftskonto")
            case .savings: item.fields["kind"] = .string("other")
            case .income: item.fields["name"] = .string("Betriebseinnahme")
            case .expenses: item.fields["category"] = .string("Betriebskosten")
            default: break
            }
        }
        if let category { item.fields["category"] = .string(category) }
        return item
    }
    @State private var selection: PlanItem?
    @State private var selectedLoan: PlanItem?
    @State private var pendingRemoval: PlanItem?
    @State private var checkIn = false

    var body: some View {
        if let plan = store.plan {
            let items = plan.entriesByDueDate(in: section).filter { matches($0.expenseCategory) }
            let metrics = PlanMetrics(plan: plan)
            let taxable = store.workspace == .business && [.income, .expenses, .annual, .flexible].contains(section)
            let net = taxable && store.comparisonNet
            let total = metrics.titleTotal(for: section, compareNet: net)
            let loans = section == .expenses ? metrics.loansWithPayments.filter { matches($0.loanCategory) } : []
            let categoryTotal = items.reduce(0) { $0 + $1.annualExpenseCents(on: metrics.today, net: net) / 1200 } + loans.reduce(0) { $0 + $1.monthlyLoanPayment }
            List {
                if taxable { ComparisonPicker(store: store) }
                if section == .income {
                    Section {
                        LabeledAmount(label: "Pro Jahr", amount: net ? plan[.income].reduce(0) { $0 + $1.netAmount * ($1.fields.flag("annual") ? 1 : 12) } : metrics.incomePerYear)
                    }
                }
                if section == .loans, items.contains(where: { $0.fields.flag("highPriority") }) {
                    Section {
                        LabeledAmount(label: "Restschuld · Hohe Priorität", amount: items.filter { $0.fields.flag("highPriority") }.reduce(0) { $0 + $1.loanSchedule().balance })
                    }
                }
                if section == .history, !items.isEmpty {
                    Section("Kontostände im Verlauf") { BalanceChart(plan: plan) }
                }
                if !loans.isEmpty {
                    Section("Kredite") {
                        ForEach(loans) { loan in
                            Button { selectedLoan = loan } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    LabeledAmount(label: loan.name, amount: loan.monthlyLoanPayment)
                                    Text([loan.loanCategory, loan.bookingDayLabel].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
                                }.contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Kredit bearbeiten")
                        }
                    }
                }
                if section == .expenses {
                    ForEach(ExpenseFrequency.allCases, id: \.self) { frequency in
                        let entries = items.filter { $0.frequency == frequency }
                        if !entries.isEmpty {
                            Section(frequency.sectionTitle) {
                                ForEach(entries) { entry in editableRow(entry) }
                            }
                        }
                    }
                }
                if section != .expenses || (items.isEmpty && loans.isEmpty) {
                    Section {
                        if items.isEmpty && loans.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(businessAssets ? "Noch keine Vermögenswerte" : section.emptyMessage).font(.headline)
                                if section == .history {
                                    if plan[.accounts].isEmpty {
                                        NavigationLink("Konten verwalten") { PlanSectionView(section: .accounts, store: store) }
                                    } else {
                                        Button("Ersten Check-in erfassen") { checkIn = true }
                                    }
                                } else {
                                    Button(addTitle) { selection = newItem }
                                        .disabled(store.busy)
                                }
                            }
                            .padding(.vertical, 8)
                            .listRowBackground(theme.card)
                        }
                        ForEach(section == .history ? Array(items.reversed()) : items) { item in
                            if section == .history {
                                let label = PlanDate.parse(item.fields.text("date"))?.formatted(date: .abbreviated, time: .omitted) ?? item.fields.text("date")
                                VStack(alignment: .leading, spacing: 5) {
                                    LabeledAmount(label: label, amount: metrics.net(for: item))
                                    if !item.fields.text("note").isEmpty {
                                        Text(item.fields.text("note")).font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                                .swipeActions { Button("Löschen") { pendingRemoval = item }.tint(.red) }
                            } else {
                                editableRow(item)
                            }
                        }
                    }
                }
                Notice(text: store.notice(in: .section(section)))
            }
            .scrollContentBackground(.hidden)
            .frame(maxWidth: DashboardLayout.readingWidth).frame(maxWidth: .infinity)
            .background(theme.paper)
            .refreshable { await store.refresh(in: .section(section)) }
            .financialTitle(category ?? (businessAssets ? "Vermögenswerte" : section.title), amount: category == nil ? total.amount : categoryTotal, caption: (taxable ? (net ? "Netto · " : "Brutto · ") : "") + total.caption)
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if section != .history {
                        Button { selection = newItem } label: { Label(addTitle, systemImage: "plus") }
                            .disabled(store.busy || plan[section].count >= (section == .expenses ? section.limit + PlanSection.annual.limit : section.limit))
                            .accessibilityIdentifier("njora.add")
                    }
                    ProfileButton(store: store)
                }
            }
            .sheet(isPresented: $checkIn) { CheckInView(plan: plan, store: store) }
            .sheet(item: $selectedLoan) { loan in
                PlanEditor(section: .loans, item: loan, plan: plan, store: store)
            }
            .sheet(item: $selection) { item in
                PlanEditor(section: section, item: item, plan: plan, store: store)
            }
            .alert(item: $pendingRemoval) { item in
                let name = item.name.isEmpty ? section.itemTitle : item.name
                let date = item.fields.text("date")
                let label = section == .history
                    ? "Check-in vom " + (PlanDate.parse(date)?.formatted(date: .abbreviated, time: .omitted) ?? date)
                    : "„" + name + "“"
                return Alert(title: Text("Eintrag löschen?"), message: Text("\(label) aus deinem Plan entfernen?"),
                             primaryButton: .destructive(Text("Löschen")) {
                                 var changed = plan
                                 changed[section] = plan[section].filter { $0.id != item.id }
                                 let result = changed
                                 Task { _ = await store.save(result, basedOn: plan, in: .section(section)) }
                             },
                             secondaryButton: .cancel(Text("Abbrechen")))
            }
        }
    }
    private func editableRow(_ item: PlanItem) -> some View {
        Button { selection = item } label: {
            PlanItemRow(item: item, section: section, businessAssets: businessAssets, businessWorkspace: store.workspace == .business, comparisonNet: store.comparisonNet).contentShape(Rectangle())
        }.buttonStyle(.plain)
        .swipeActions { Button("Löschen") { pendingRemoval = item }.tint(.red) }
    }

}

struct PlanItemRow: View {
    let item: PlanItem
    let section: PlanSection
    var businessAssets = false
    var businessWorkspace = false
    var comparisonNet = false
    private var fields: Record { item.fields }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if section == .loans && fields.flag("highPriority") {
                Label("Hohe Priorität", systemImage: "flag.fill")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.orange.opacity(0.18), in: Capsule())
            }
            let taxable = businessWorkspace && [.income, .expenses, .annual, .flexible].contains(section)
            let net = ExpenseVAT.convert(amount, rate: fields.amount("vatRate"), toGross: false)
            LabeledAmount(label: item.name.isEmpty ? section.title : item.name, amount: taxable && comparisonNet ? net : amount,
                          detail: taxable ? (comparisonNet ? "netto · " + euros(amount) + " brutto" : "brutto · " + euros(net) + " netto") : nil)
            if let detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            if section == .loans && !businessWorkspace {
                let schedule = item.loanSchedule()
                let total = schedule.total
                if let repaid = schedule.repaidPrincipal, let principal = fields["originalPrincipal"]?.number {
                    LabeledContent("Schon getilgt", value: euros(repaid) + " von " + euros(principal)).font(.footnote)
                }
                if let interest = schedule.lifetimeInterest {
                    LabeledContent("Zinsen und ggf. Gebühren gesamt · geschätzt", value: euros(interest)).font(.footnote)
                }
                LabeledContent(fields["paidBefore"] == nil ? "Rückzahlung ab Stichtag inkl. Zinsen" : "Gesamt inkl. Zinsen",
                               value: total.map { euros($0) } ?? "Nicht berechenbar")
                    .font(.footnote)
            }
            if section == .goals, fields.amount("target") > 0 {
                ProgressView(value: max(0, min(1, fields.amount("saved") / fields.amount("target"))))
                    .accessibilityLabel("Fortschritt des Sparziels")
            }
        }.padding(.vertical, 4)
    }
    private var amount: Double {
        switch section {
        case .accounts: item.netBalance
        case .loans: item.loanSchedule().balance
        case .goals: fields.amount("saved")
        case .savings: item.savingValue
        case .expenses: item.expenseAmount()
        default: fields.amount("amount")
        }
    }
    private var detail: String? {
        switch section {
        case .income: fields.flag("annual")
            ? (monthNames[safe: fields.integer("month") ?? -1].map { "Jährlich im \($0)" } ?? "Jährlich · Monat offen")
            : "Monatlich"
        case .expenses: [item.expenseCategory, item.frequency.label,
            item.frequency == .once ? fields.text("dueDate") + (fields.flag("paid") ? " · Beglichen" : " · Offen") : nil,
            fields.integer("bookingDay").flatMap { $0 > 0 ? "am " + String($0) + "." : nil },
            item.frequency == .monthly ? nil : monthNames[safe: fields.integer("month") ?? -1].map { "Fällig im " + $0 + (item.frequency == .quarterly ? " und alle drei Monate" : "") }
        ].compactMap { $0 }.joined(separator: " · ")
        case .accounts: fields.text("type") == "credit" ? ["Kreditkarte", item.bookingDayLabel.map { "Ausgleich " + $0 } ?? "Abbuchungstag offen"].joined(separator: " · ") : nil
        case .annual: monthNames[safe: fields.integer("month") ?? -1]
        case .loans: [businessWorkspace ? nil : item.loanCategory, businessWorkspace ? nil : fields.amount("interestRate").formatted() + " % p. a.", euros(item.monthlyLoanPayment) + " pro Monat", item.bookingDayLabel].compactMap { $0 }.joined(separator: " · ")
        case .goals:
            item.monthlyGoalNeed().map { "Ziel \(euros(fields.amount("target"))) · Bedarf \(euros($0)) pro Monat" }
                ?? "Ziel \(euros(fields.amount("target")))"
        case .savings:
            if let schedule = item.depreciation(on: .now) {
                "Lineare Abschreibung · Ø " + euros(schedule.monthly) + " pro Monat"
            } else if businessAssets && fields.text("kind") == "other" { "Sonstiger Vermögenswert" }
            else { fields.text("kind") == "security" ? securityDetail : savingNames[fields.text("kind")] }
        default: nil
        }
    }

    private var securityDetail: String {
        let timestamp = fields.text("quoteUpdatedAt")
        if fields.text("quoteVenue") == ClosingPrices.venue, let day = PlanDate.parse(timestamp) {
            return fields.text("symbol") + " · Cboe-Schlusskurs · Datenstand " + day.formatted(.dateTime.day().month().year().locale(Locale(identifier: "de_DE")))
        }
        let quoteDate = PlanDate.parseTradeTime(timestamp)
        let time = quoteDate?.formatted(.dateTime.day().month().year().hour().minute().second().locale(Locale(identifier: "de_DE")))
        let missingTime = fields.amount("priceEur") > 0 ? "Kurs ohne Zeitangabe" : "Noch kein Kurs gespeichert"
        let quoteTime = time.map { "Kurs vom \($0)" } ?? missingTime
        return [fields.text("symbol"), fields.text("quoteVenue"), quoteTime]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

let monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
let savingNames = ["security": "Aktie oder ETF", "dayMoney": "Tagesgeldkonto", "fixedDeposit": "Festgeld", "buildingSavings": "Bausparvertrag", "cash": "Bargeldreserve", "other": "Andere Ersparnis"]

private struct RevenueMonthSelection: Identifiable {
    let id: String
    let base: Plan
}

private struct OwnedForecastView: View {
    @ObservedObject var store: NjoraStore

    var body: some View {
        if let plan = store.plan {
            RevenueForecastView(store: store, plan: plan) { updated, base in
                guard await store.save(updated, basedOn: base) else {
                    throw APIError(0, store.notice(in: .editor))
                }
            }
        }
    }
}

private struct BusinessRevenueView: View {
    @ObservedObject var store: NjoraStore
    @Environment(\.njoraAppearance) private var theme
    @State private var selection: RevenueMonthSelection?

    var body: some View {
        if let plan = store.plan {
            let months = PlanDate.completedRevenueMonths(asOf: .now)
            let amounts = months.compactMap { plan.revenueValue($0, net: store.comparisonNet) }
            let total = amounts.reduce(0, +)
            let older = plan.monthlyRevenue.keys.filter { $0 < months[11] }.sorted(by: >)
            List {
                ComparisonPicker(store: store)
                NavigationLink("Forecast") {
                    OwnedForecastView(store: store)
                }
                Section("Letzte 12 abgeschlossene Monate") {
                    LabeledContent(store.comparisonNet ? "Nettoumsatz gesamt" : "Bruttoumsatz gesamt", value: amounts.isEmpty ? "–" : euros(total))
                    LabeledContent("Ø je erfasstem Monat", value: amounts.isEmpty ? "–" : euros(total / Double(amounts.count)))
                    Text("\(amounts.count) von 12 Monaten im Vergleich").font(.footnote).foregroundStyle(.secondary)
                }
                Section("Monatsumsätze") {
                    ForEach(months, id: \.self) { month in
                        let value = plan.revenueValue(month, net: store.comparisonNet)
                        Button { selection = .init(id: month, base: plan) } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                LabeledContent(PlanDate.revenueTitle(month), value: value.map(euros) ?? (plan.monthlyRevenue[month] == nil ? "Nachtragen" : "Steuerangabe fehlt"))
                                GeometryReader { proxy in
                                    let low = min(amounts.min() ?? 0, 0)
                                    let high = max(amounts.max() ?? 0, 0)
                                    let range = high > low ? high - low : 1
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Color.secondary.opacity(0.15))
                                        if let value, value != 0 {
                                            Capsule().fill(theme.accent)
                                                .frame(width: proxy.size.width * (abs(value) / range))
                                                .offset(x: proxy.size.width * ((min(value, 0) - low) / range))
                                        }
                                    }
                                }.frame(height: 4).accessibilityHidden(true)
                            }.padding(.vertical, 3).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                if !older.isEmpty {
                    DisclosureGroup("Frühere Monate (\(older.count))") {
                        ForEach(older, id: \.self) { month in
                            Button { selection = .init(id: month, base: plan) } label: {
                                LabeledContent(PlanDate.revenueTitle(month), value: plan.revenueValue(month, net: store.comparisonNet).map(euros) ?? "Steuerangabe fehlt")
                            }
                        }
                    }
                }
            }
            .planFormStyle()
            .navigationTitle("Umsatz")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { selection = .init(id: months.first { plan.monthlyRevenue[$0] == nil } ?? months[0], base: plan) } label: {
                        Label("Monat nachtragen", systemImage: "plus")
                    }
                }
            }
            .sheet(item: $selection) { selection in
                RevenueMonthEditor(store: store, selection: selection, latest: months[0])
            }
        }
    }
}

private struct RevenueMonthEditor: View {
    @ObservedObject var store: NjoraStore
    let selection: RevenueMonthSelection
    let latest: String
    @State private var year: Int
    @State private var month: Int
    @State private var draft: RevenueDraft
    @Environment(\.dismiss) private var dismiss

    init(store: NjoraStore, selection: RevenueMonthSelection, latest: String) {
        self.store = store
        self.selection = selection
        self.latest = latest
        _year = State(initialValue: Int(selection.id.prefix(4))!)
        _month = State(initialValue: Int(selection.id.suffix(2))!)
        _draft = State(initialValue: RevenueDraft(plan: selection.base, month: selection.id))
    }

    private var key: String { String(format: "%04d-%02d", year, month) }
    private var lastYear: Int { Int(latest.prefix(4))! }
    private var monthLimit: Int { year == lastYear ? Int(latest.suffix(2))! : 12 }
    private var amount: RevenueAmounts? { draft.amounts }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Jahr", selection: $year) {
                    ForEach((min(1900, Int(selection.id.prefix(4))!)...lastYear).reversed(), id: \.self) { Text(String($0)).tag($0) }
                }
                Picker("Monat", selection: $month) {
                    ForEach(1...monthLimit, id: \.self) { index in
                        Text(Locale(identifier: "de_DE").calendar.monthSymbols[index - 1]).tag(index)
                    }
                }
                RevenueFields(draft: $draft)
                Notice(text: store.notice(in: .editor))
            }
            .planFormStyle()
            .onChange(of: year) { _ in month = min(month, monthLimit) }
            .onChange(of: key) { new in draft = RevenueDraft(plan: selection.base, month: new) }
            .onDisappear { store.clearNotice(in: .editor) }
            .navigationTitle("Monatsumsatz").navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(store.busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() }.disabled(store.busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern") {
                        guard let amount, key <= latest else { return }
                        var updated = selection.base
                        updated.saveRevenue(amount, month: key)
                        let result = updated
                        Task { if await store.save(result, basedOn: selection.base) { dismiss() } }
                    }.disabled(store.busy || amount == nil || key > latest)
                }
            }
        }
    }
}
