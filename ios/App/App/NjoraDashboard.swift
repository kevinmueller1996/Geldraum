import Charts
import SwiftUI

struct Dashboard: View {
    @ObservedObject var store: NjoraStore

    var body: some View {
        if let plan = store.plan {
            TabView {
                NavigationStack {
                    Overview(plan: plan, store: store)
                        .navigationTitle("Heute").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) } }
                        .safeAreaInset(edge: .top, spacing: 0) {
                            NavigationLink { PlanSectionView(section: .accounts, store: store) } label: {
                                FinancialTitle(title: "Heute", amount: PlanMetrics(plan: plan).net, caption: "Kontostand")
                            }.buttonStyle(.plain).padding(.horizontal, 18).padding(.vertical, 8).background(NjoraTheme.paper)
                        }
                        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                }.tabItem { Label("Heute", systemImage: "sun.max") }
                NavigationStack {
                    MonthlyPlan(plan: plan, store: store)
                        .financialTitle("Monatsplan", amount: PlanMetrics(plan: plan).available, caption: "Spielraum pro Monat")
                        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                }.tabItem { Label("Monatsplan", systemImage: "calendar") }
                NavigationStack {
                    PlanSectionView(section: .loans, store: store)
                }.tabItem { Label("Kredite", systemImage: "banknote") }
                NavigationStack {
                    PlanSectionView(section: .goals, store: store)
                }.tabItem { Label("Ziele", systemImage: "target") }
                NavigationStack {
                    List {
                        NavigationLink("Konten & Karten") { PlanSectionView(section: .accounts, store: store) }
                        NavigationLink("Ersparnisse & Depot") { PlanSectionView(section: .savings, store: store) }
                        NavigationLink("Verlauf der Kontostände") { PlanSectionView(section: .history, store: store) }
                    }
                    .navigationTitle("Mehr")
                    .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                    .scrollContentBackground(.hidden).background(NjoraTheme.paper)
                }.tabItem { Label("Mehr", systemImage: "ellipsis") }
            }
        }
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
    let plan: Plan
    @ObservedObject var store: NjoraStore
    @State private var checkIn = false
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                NavigationLink {
                    MonthlyPlan(plan: store.plan ?? plan, store: store)
                        .financialTitle("Monatsplan", amount: metrics.available, caption: "Spielraum pro Monat")
                        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ProfileButton(store: store) } }
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack { Text("Monatlicher Spielraum").font(.headline); Spacer(); Image(systemName: "chevron.right") }
                        Text(euros(metrics.available)).font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit()
                        Text("Regelmäßiges Einkommen abzüglich Fixkosten").font(.footnote)
                    }
                    .foregroundStyle(NjoraTheme.paper)
                    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(NjoraTheme.accent, in: RoundedRectangle(cornerRadius: 18))
                }.buttonStyle(.plain)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .topLeading), count: typeSize.isAccessibilitySize ? 1 : 2), spacing: 12) {
                    NavigationLink { PlanSectionView(section: .income, store: store) } label: {
                        metric("Einkommen im " + monthNames[metrics.month], value: euros(metrics.incomeThisMonth))
                    }
                    NavigationLink { PlanSectionView(section: .expenses, store: store) } label: {
                        metric("Fixkosten · Ø pro Monat", value: euros(metrics.fixedCosts))
                    }
                    NavigationLink { ForecastDetail(store: store) } label: {
                        let forecast = metrics.forecast
                        metric("Prognose zum Monatsende", value: forecast.uncertain.isEmpty ? euros(forecast.datedBalance) : "Spanne ansehen")
                    }
                    NavigationLink { PlanSectionView(section: .loans, store: store) } label: {
                        metric("Offene Kreditschuld", value: euros(plan[.loans].sum("balance")))
                    }
                }.buttonStyle(.plain)
                if plan[.accounts].isEmpty {
                    NavigationLink("Erstes Konto anlegen") { PlanSectionView(section: .accounts, store: store) }
                } else {
                    Button { checkIn = true } label: {
                        Label("Kontostände aktualisieren", systemImage: "arrow.clockwise")
                    }.buttonStyle(.bordered)
                }

                if !metrics.annualIncome.isEmpty || !metrics.specialCosts.isEmpty {
                    VStack(alignment: .leading, spacing: 11) {
                        Text("Sonderposten in diesem Monat").font(.headline)
                        ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                        ForEach(metrics.specialCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
                    }.njoraCard()
                }
                if !plan[.history].isEmpty {
                    NavigationLink { PlanSectionView(section: .history, store: store) } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Text("Kontostände im Verlauf").font(.headline); Spacer(); Image(systemName: "chevron.right") }
                            BalanceChart(plan: plan)
                        }.njoraCard()
                    }.buttonStyle(.plain)
                }
                Notice(text: store.notice(in: .overview))
            }
            .padding(22).frame(maxWidth: 860).frame(maxWidth: .infinity)
        }
        .background(NjoraTheme.paper)
        .refreshable { await store.refresh(in: .overview) }
        .sheet(isPresented: $checkIn) { CheckInView(plan: plan, store: store) }
    }
    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
                .frame(minHeight: 40, alignment: .topLeading)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
                .foregroundStyle(.primary)
                .lineLimit(1).minimumScaleFactor(0.65)
        }
        .njoraCard()
        .accessibilityElement(children: .combine)
    }

}

private struct ForecastDetail: View {
    @ObservedObject var store: NjoraStore
    @State private var selectedCard: PlanItem?
    @State private var selectedEntry: ForecastEntry?
    @State private var checkingBalance = false
    var body: some View {
        if let plan = store.plan {
            let metrics = PlanMetrics(plan: plan)
            let forecast = metrics.forecast
            let cards = metrics.cardSettlements
            List {
                Section("Rechnung ab heute") {
                    Button { checkingBalance = true } label: {
                        HStack {
                            LabeledAmount(label: "Eingetragener Nettokontostand", amount: forecast.balance)
                            disclosure
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    ForEach(forecast.scheduled) { row in
                        entryButton(row, dated: true)
                    }
                    LabeledAmount(label: "Mit datierten Zahlungen", amount: forecast.datedBalance, emphasis: true)
                }
                if !forecast.uncertain.isEmpty {
                    Section("Buchung offen") {
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
                if !cards.isEmpty {
                    Section {
                        ForEach(cards, id: \.account.id) { card in
                            Button { selectedCard = card.account } label: {
                                HStack {
                                    LabeledAmount(label: card.account.name, amount: card.account.fields.amount("balance"),
                                                  detail: card.date.map { $0.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "de_DE"))) } ?? "Abbuchungstag offen")
                                    disclosure
                                }.contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    } header: { Text("Nächster Kreditkartenausgleich") }
                    footer: { Text("Der offene Kartenbetrag ist im Nettokontostand bereits berücksichtigt.") }
                }
                Section {
                    Text("Die Rechnung setzt einen aktuellen Kontostand voraus. Frühere Fälligkeiten gelten als gebucht. Spätere zählen vollständig. Ungeplante Ausgaben sind offen.")
                    if let date = plan[.history].map({ $0.fields.text("date") }).max(), let last = PlanDate.parse(date) {
                        Text("Letzter Check-in: " + last.formatted(date: .abbreviated, time: .omitted))
                    }
                }.font(.footnote).foregroundStyle(.secondary)
            }
            .sheet(item: $selectedCard) { PlanEditor(section: .accounts, item: $0, plan: plan, store: store) }
            .sheet(item: $selectedEntry) { entry in
                PlanEditor(section: entry.section, item: entry.item, plan: plan, store: store)
            }
            .sheet(isPresented: $checkingBalance) { CheckInView(plan: plan, store: store) }
            .navigationTitle("Monatsendprognose")
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
                    LabeledAmount(label: dated ? "\(row.day). · " + row.item.name : row.item.name, amount: row.amount)
                    if !dated {
                        Text(row.monthUnknown ? "Monat offen" : row.day == 0 ? "Ohne Buchungstag" : "Heute fällig")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                disclosure
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Eintrag bearbeiten")
    }

}

struct MonthlyPlan: View {
    let plan: Plan
    @ObservedObject var store: NjoraStore
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        List {
            Section("Monatsdurchschnitt") {
                NavigationLink { PlanSectionView(section: .income, store: store) } label: {
                    LabeledAmount(label: "Regelmäßiges Einkommen", amount: metrics.income)
                }
                NavigationLink { PlanSectionView(section: .expenses, store: store) } label: {
                    LabeledAmount(label: "Fixkosten", amount: -metrics.fixedCosts)
                }
            }
            let categories = metrics.rankedCategories
            if !categories.isEmpty {
                Section {
                    ForEach(categories, id: \.name) { category in
                        NavigationLink {
                            PlanSectionView(section: .expenses, store: store, category: category.name)
                        } label: {
                            let share = metrics.income > 0 ? category.amount / metrics.income : nil
                            VStack(alignment: .leading, spacing: 6) {
                                LabeledAmount(label: category.name, amount: category.amount,
                                              detail: share.map { $0.formatted(.percent.precision(.fractionLength(0...1)).locale(Locale(identifier: "de_DE"))) })
                                GeometryReader { area in
                                    let ratio = min(1, max(0, share ?? 0))
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(NjoraTheme.accent.opacity(0.14))
                                        Capsule().fill(NjoraTheme.accent).frame(width: area.size.width * ratio)
                                    }
                                }
                                .frame(height: 4)
                                .accessibilityHidden(true)
                            }
                            .padding(.vertical, 5)
                            .accessibilityElement(children: .combine)
                        }
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Durchschnittliche Kosten je Kategorie")
                        Text(metrics.income > 0 ? "Anteil am regelmäßigen Monatseinkommen" : "Für Prozentanteile ein regelmäßiges Einkommen eintragen.")
                            .font(.caption).fontWeight(.regular)
                    }.textCase(nil)
                }
            }
            Notice(text: store.notice(in: .month))
        }.scrollContentBackground(.hidden).background(NjoraTheme.paper)
            .refreshable { await store.refresh(in: .month) }
    }
}

struct BalanceChart: View {
    let plan: Plan
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        Chart(plan[.history].suffix(30)) { snapshot in
            if let day = PlanDate.parse(snapshot.fields.text("date")) {
                LineMark(x: .value("Datum", day), y: .value("Stand", metrics.net(for: snapshot)))
                    .foregroundStyle(NjoraTheme.accent)
                PointMark(x: .value("Datum", day), y: .value("Stand", metrics.net(for: snapshot)))
                    .foregroundStyle(NjoraTheme.accent)
            }
        }.frame(height: 170)
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
                .foregroundStyle(amount < 0 ? Color.red : emphasis ? NjoraTheme.positive : Color.primary)
            if let detail { Text(detail).font(.caption).monospacedDigit().foregroundStyle(.secondary) }
        }
    }
}

extension View {
    fileprivate func financialTitle(_ title: String, amount: Double?, caption: String) -> some View {
        self.navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                FinancialTitle(title: title, amount: amount, caption: caption)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(NjoraTheme.paper)
            }
    }

    func njoraCard() -> some View {
        self.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(NjoraTheme.card, in: RoundedRectangle(cornerRadius: 18))
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
    func titleTotal(for section: PlanSection) -> (amount: Double?, caption: String) {
        switch section {
        case .expenses: (fixedCosts, "Ø pro Monat")
        case .income: (incomeThisMonth, "im " + monthNames[month])
        case .annual: (plan[.annual].sum("amount"), "pro Jahr")
        case .accounts: (net, "Nettostand")
        case .loans: (plan[.loans].sum("balance"), "Restschuld")
        case .goals: (plan[.goals].sum("saved"), "bereits gespart")
        case .savings: (plan[.savings].reduce(0) { $0 + $1.savingValue }, "Gesamtwert")
        case .history: (plan[.history].max { $0.fields.text("date") < $1.fields.text("date") }.map { net(for: $0) }, "letzter Check-in")
        }
    }
}

struct PlanSectionView: View {
    let section: PlanSection
    @ObservedObject var store: NjoraStore
    var category: String? = nil
    private func matches(_ name: String) -> Bool {
        category.map { $0.caseInsensitiveCompare(name) == .orderedSame } ?? true
    }
    private var newItem: PlanItem {
        var item = section.newItem
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
            let total = metrics.titleTotal(for: section)
            let loans = section == .expenses ? metrics.loansWithPayments.filter { matches($0.loanCategory) } : []
            let categoryTotal = items.reduce(0) { $0 + $1.monthlyExpense } + loans.reduce(0) { $0 + $1.monthlyLoanPayment }
            List {
                if section == .income {
                    Section {
                        LabeledAmount(label: "Pro Jahr", amount: metrics.incomePerYear)
                    }
                }
                if section == .history, !items.isEmpty {
                    Section("Kontostände im Verlauf") { BalanceChart(plan: plan) }
                }
                if section == .savings, items.contains(where: { $0.fields.text("kind") == "security" }) {
                    Section {
                        Button("Wertpapierkurse aktualisieren") { Task { await store.refreshQuotes() } }.disabled(store.busy)
                        Text("Quelle und Handelszeit stehen am Kurs. Kurse von Yahoo Finance sind zeitverzögert.").font(.footnote).foregroundStyle(.secondary)
                    }
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
                                Text(section.emptyMessage).font(.headline)
                                if section == .history {
                                    if plan[.accounts].isEmpty {
                                        NavigationLink("Konten verwalten") { PlanSectionView(section: .accounts, store: store) }
                                    } else {
                                        Button("Ersten Check-in erfassen") { checkIn = true }
                                    }
                                } else {
                                    Button(section.addTitle) { selection = newItem }
                                        .disabled(store.busy)
                                }
                            }
                            .padding(.vertical, 8)
                            .listRowBackground(NjoraTheme.card)
                        }
                        ForEach(section == .history ? Array(items.reversed()) : items) { item in
                            if section == .history {
                                let label = PlanDate.parse(item.fields.text("date"))?.formatted(date: .abbreviated, time: .omitted) ?? item.fields.text("date")
                                VStack(alignment: .leading, spacing: 5) {
                                    LabeledAmount(label: label, amount: PlanMetrics(plan: plan).net(for: item))
                                    if !item.fields.text("note").isEmpty {
                                        Text(item.fields.text("note")).font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                                .swipeActions { Button("Löschen", role: .destructive) { pendingRemoval = item } }
                            } else {
                                editableRow(item)
                            }
                        }
                    }
                }
                Notice(text: store.notice(in: .section(section)))
            }
            .scrollContentBackground(.hidden).background(NjoraTheme.paper)
            .refreshable { await store.refresh(in: .section(section)) }
            .financialTitle(category ?? section.title, amount: category == nil ? total.amount : categoryTotal, caption: total.caption)
            .task {
                if section == .savings { await store.refreshQuotes(ifNeeded: true) }
            }
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if section != .history {
                        Button { selection = newItem } label: { Label(section.addTitle, systemImage: "plus") }
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
            .confirmationDialog("Eintrag löschen?", isPresented: Binding(
                get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }
            ), titleVisibility: .visible) {
                if let item = pendingRemoval {
                    Button("Löschen", role: .destructive) {
                        var changed = plan
                        changed[section] = plan[section].filter { $0.id != item.id }
                        let result = changed
                        Task { _ = await store.save(result, in: .section(section)) }
                    }
                }
            }
        }
    }
    private func editableRow(_ item: PlanItem) -> some View {
        Button { selection = item } label: {
            PlanItemRow(item: item, section: section).contentShape(Rectangle())
        }.buttonStyle(.plain)
        .swipeActions { Button("Löschen", role: .destructive) { pendingRemoval = item } }
    }

}

private struct PlanItemRow: View {
    let item: PlanItem
    let section: PlanSection
    private var fields: Record { item.fields }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledAmount(label: item.name.isEmpty ? section.title : item.name, amount: amount)
            if let detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
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
        case .loans: fields.amount("balance")
        case .goals: fields.amount("saved")
        case .savings: item.savingValue
        default: fields.amount("amount")
        }
    }
    private var detail: String? {
        switch section {
        case .income: fields.flag("annual")
            ? (monthNames[safe: fields.integer("month") ?? -1].map { "Jährlich im \($0)" } ?? "Jährlich · Monat offen")
            : "Monatlich"
        case .expenses: [item.expenseCategory, item.frequency.label,
            fields.integer("bookingDay").flatMap { $0 > 0 ? "am " + String($0) + "." : nil },
            item.frequency == .monthly ? nil : monthNames[safe: fields.integer("month") ?? -1].map { "Fällig im " + $0 + (item.frequency == .quarterly ? " und alle drei Monate" : "") }
        ].compactMap { $0 }.joined(separator: " · ")
        case .accounts: fields.text("type") == "credit" ? ["Kreditkarte", item.bookingDayLabel.map { "Ausgleich " + $0 } ?? "Abbuchungstag offen"].joined(separator: " · ") : nil
        case .annual: monthNames[safe: fields.integer("month") ?? -1]
        case .loans: [item.loanCategory, euros(item.monthlyLoanPayment) + " pro Monat", item.bookingDayLabel].compactMap { $0 }.joined(separator: " · ")
        case .goals:
            item.monthlyGoalNeed().map { "Ziel \(euros(fields.amount("target"))) · Bedarf \(euros($0)) pro Monat" }
                ?? "Ziel \(euros(fields.amount("target")))"
        case .savings: fields.text("kind") == "security" ? securityDetail : savingNames[fields.text("kind")]
        default: nil
        }
    }

    private var securityDetail: String {
        let timestamp = fields.text("quoteUpdatedAt")
        let quoteDate = PlanDate.parseTradeTime(timestamp)
        let time = quoteDate?.formatted(.dateTime.day().month().year().hour().minute().second().locale(Locale(identifier: "de_DE")))
        let missingTime = fields.amount("priceEur") > 0 ? "Kurs ohne Zeitangabe" : "Noch kein Kurs"
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
