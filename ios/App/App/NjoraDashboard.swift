import Charts
import SwiftUI

struct Dashboard: View {
    @ObservedObject var store: NjoraStore

    var body: some View {
        if let plan = store.plan {
            TabView {
                NavigationStack {
                    Overview(plan: plan, store: store)
                        .financialTitle("Heute", amount: PlanMetrics(plan: plan).net, caption: "Kontostand")
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
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                BrandMark()
                Text("Hallo \(plan.name).")
                    .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 12) {
                    Button {
                        checkIn = true
                    } label: {
                        Label("Kontostände aktualisieren", systemImage: "arrow.clockwise").fontWeight(.semibold)
                    }
                    .buttonStyle(.bordered)
                    .disabled(plan[.accounts].isEmpty)
                    if plan[.accounts].isEmpty {
                        NavigationLink("Erstes Konto anlegen") { PlanSectionView(section: .accounts, store: store) }
                    }
                }.njoraCard()

                VStack(alignment: .leading, spacing: 12) {
                    LabeledAmount(label: "Prognose zum Monatsende", amount: metrics.forecast, emphasis: true)
                    Text("Schätzung aus deinen geplanten Ein- und Ausgaben.").font(.footnote).foregroundStyle(.secondary)
                    Divider()
                    LabeledAmount(label: "Einkommen im \(monthNames[metrics.month])", amount: metrics.incomeThisMonth)
                    LabeledAmount(label: "Monatlicher Spielraum", amount: metrics.available)
                }.njoraCard()

                if !metrics.annualIncome.isEmpty || !metrics.specialCosts.isEmpty {
                    VStack(alignment: .leading, spacing: 11) {
                        Text("Sonderposten in diesem Monat").font(.headline)
                        ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                        ForEach(metrics.specialCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
                    }.njoraCard()
                }
                if !plan[.history].isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Kontostände im Verlauf").font(.headline)
                        BalanceChart(plan: plan)
                    }.njoraCard()
                }
                Notice(text: store.notice(in: .overview))
            }
            .padding(22).frame(maxWidth: 860).frame(maxWidth: .infinity)
        }
        .background(NjoraTheme.paper)
        .refreshable { await store.refresh(in: .overview) }
        .sheet(isPresented: $checkIn) { CheckInView(plan: plan, store: store) }
    }
}

struct MonthlyPlan: View {
    let plan: Plan
    @ObservedObject var store: NjoraStore
    var body: some View {
        let metrics = PlanMetrics(plan: plan)
        List {
            Section("Im Monat verfügbar") {
                LabeledAmount(label: "Regelmäßiges Einkommen", amount: metrics.income)
                LabeledAmount(label: "Fixkosten", amount: -metrics.fixedCosts)
            }
            Section("Plan bearbeiten") {
                ForEach([PlanSection.income, .expenses]) { section in
                    NavigationLink(section.title) { PlanSectionView(section: section, store: store) }
                }
            }
            let categories = metrics.rankedCategories
            if !categories.isEmpty {
                Section("Fixkosten nach Kategorie · pro Monat") {
                    ForEach(categories, id: \.name) { category in
                        VStack(alignment: .leading, spacing: 9) {
                            LabeledAmount(label: category.name, amount: category.amount)
                            GeometryReader { area in
                                let largest = max(categories.first?.amount ?? 0, 0)
                                let ratio = largest > 0 ? max(0, category.amount) / largest : 0
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
            }
            Section("Sonderposten in diesem Monat") {
                if metrics.annualIncome.isEmpty && metrics.specialCosts.isEmpty {
                    Text("Keine Sonderposten").foregroundStyle(.secondary)
                }
                ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                ForEach(metrics.specialCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
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
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { Text(label).fixedSize(horizontal: true, vertical: false); Spacer(); number.fixedSize() }
            VStack(alignment: .leading, spacing: 4) { Text(label); number }
        }
    }
    private var number: some View {
        Text(euros(amount)).monospacedDigit().fontWeight(emphasis ? .semibold : .regular)
            .foregroundStyle(amount < 0 ? Color.red : emphasis ? NjoraTheme.positive : Color.primary)
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
    @State private var selection: PlanItem?
    @State private var selectedLoan: PlanItem?
    @State private var pendingRemoval: PlanItem?
    @State private var checkIn = false

    var body: some View {
        if let plan = store.plan {
            let items = plan.entriesByDueDate(in: section)
            let metrics = PlanMetrics(plan: plan)
            let total = metrics.titleTotal(for: section)
            let loans = section == .expenses ? metrics.loansWithPayments : []
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
                    Section("Kreditraten · monatlich") {
                        ForEach(loans) { loan in
                            Button { selectedLoan = loan } label: {
                                LabeledAmount(label: loan.name, amount: loan.monthlyLoanPayment)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Kredit bearbeiten")
                        }
                    }
                }
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
                                Button(section.addTitle) { selection = section.newItem }
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
                            Button { selection = item } label: {
                                PlanItemRow(item: item, section: section)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .swipeActions { Button("Löschen", role: .destructive) { pendingRemoval = item } }
                        }
                    }
                }
                Notice(text: store.notice(in: .section(section)))
            }
            .scrollContentBackground(.hidden).background(NjoraTheme.paper)
            .refreshable { await store.refresh(in: .section(section)) }
            .financialTitle(section.title, amount: total.amount, caption: total.caption)
            .task {
                if section == .savings { await store.refreshQuotes(ifNeeded: true) }
            }
            .toolbar {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    if section != .history {
                        Button { selection = section.newItem } label: { Label(section.addTitle, systemImage: "plus") }
                            .disabled(store.busy || items.count >= (section == .expenses ? section.limit + PlanSection.annual.limit : section.limit))
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
        case .expenses: [fields.text("category"), item.frequency.label,
            fields.integer("bookingDay").flatMap { $0 > 0 ? "am " + String($0) + "." : nil },
            item.frequency == .monthly ? nil : monthNames[safe: fields.integer("month") ?? -1].map { "Fällig im " + $0 + (item.frequency == .quarterly ? " und alle drei Monate" : "") }
        ].compactMap { $0 }.joined(separator: " · ")
        case .accounts: fields.text("type") == "credit" ? "Kreditkarte" : nil
        case .annual: monthNames[safe: fields.integer("month") ?? -1]
        case .loans: "\(euros(item.monthlyLoanPayment)) pro Monat · \(euros(item.balanceAfter(months: 12))) nach 12 Monaten"
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
