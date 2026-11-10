import Charts
import SwiftUI

struct Dashboard: View {
    @ObservedObject var store: NjoraStore
    @State private var showSettings = false

    var body: some View {
        if let plan = store.plan {
            TabView {
                NavigationStack {
                    Overview(plan: plan, store: store)
                        .navigationTitle("Heute")
                        .toolbar { settingsButton }
                }.tabItem { Label("Heute", systemImage: "sun.max") }
                NavigationStack {
                    MonthlyPlan(plan: plan, store: store)
                        .navigationTitle("Monatsplan")
                        .toolbar { settingsButton }
                }.tabItem { Label("Monatsplan", systemImage: "calendar") }
                NavigationStack {
                    PlanSectionView(section: .loans, store: store)
                        .navigationTitle("Kredite")
                        .toolbar { settingsButton }
                }.tabItem { Label("Kredite", systemImage: "banknote") }
                NavigationStack {
                    PlanSectionView(section: .goals, store: store)
                        .navigationTitle("Sparziele")
                        .toolbar { settingsButton }
                }.tabItem { Label("Ziele", systemImage: "target") }
                NavigationStack {
                    List {
                        NavigationLink("Konten & Karten") { PlanSectionView(section: .accounts, store: store) }
                        NavigationLink("Ersparnisse & Depot") { PlanSectionView(section: .savings, store: store) }
                        NavigationLink("Verlauf der Kontostände") { PlanSectionView(section: .history, store: store) }
                        Button("Konto & Einstellungen") { showSettings = true }
                    }
                    .navigationTitle("Mehr")
                    .scrollContentBackground(.hidden).background(NjoraTheme.paper)
                }.tabItem { Label("Mehr", systemImage: "ellipsis") }
            }
            .sheet(isPresented: $showSettings) { NavigationStack { SettingsView(store: store) } }
        }
    }

    private var settingsButton: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { showSettings = true } label: {
                Image(systemName: "person.crop.circle").accessibilityLabel("Konto & Einstellungen")
            }
        }
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
                    Text("AKTUELLER KONTOSTAND").font(.caption.weight(.semibold)).tracking(1.4)
                    Text(euros(metrics.net)).font(.system(.largeTitle, design: .serif, weight: .semibold)).monospacedDigit()
                    Button {
                        checkIn = true
                    } label: {
                        Label("Kontostände aktualisieren", systemImage: "arrow.clockwise").fontWeight(.semibold)
                    }
                    .buttonStyle(.bordered)
                }.njoraCard()

                VStack(alignment: .leading, spacing: 12) {
                    LabeledAmount(label: "Prognose zum Monatsende", amount: metrics.forecast, emphasis: true)
                    Text("Schätzung aus deinen geplanten Ein- und Ausgaben.").font(.footnote).foregroundStyle(.secondary)
                    Divider()
                    LabeledAmount(label: "Monatlicher Spielraum", amount: metrics.available)
                }.njoraCard()

                if !metrics.annualIncome.isEmpty || !metrics.annualCosts.isEmpty {
                    VStack(alignment: .leading, spacing: 11) {
                        Text("Sonderposten in diesem Monat").font(.headline)
                        ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                        ForEach(metrics.annualCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
                    }.njoraCard()
                }
                if !plan[.history].isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Kontostände im Verlauf").font(.headline)
                        BalanceChart(plan: plan)
                    }.njoraCard()
                }
                Notice(text: store.message)
            }
            .padding(22).frame(maxWidth: 860).frame(maxWidth: .infinity)
        }
        .background(NjoraTheme.paper)
        .refreshable { await store.refresh() }
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
                LabeledAmount(label: "Einkommen", amount: metrics.income)
                LabeledAmount(label: "Fixkosten", amount: -metrics.expenses)
                LabeledAmount(label: "Rücklage für Jahreskosten", amount: -metrics.reserve)
                LabeledAmount(label: "Kreditraten", amount: -metrics.payments)
                LabeledAmount(label: "Spielraum", amount: metrics.available, emphasis: true)
            }
            Section("Plan bearbeiten") {
                ForEach([PlanSection.income, .expenses, .annual]) { section in
                    NavigationLink(section.title) { PlanSectionView(section: section, store: store) }
                }
            }
            let groups = Dictionary(grouping: plan[.expenses]) { $0.fields.text("category", default: "Andere Ausgaben") }
            if !groups.isEmpty {
                Section("Fixkosten nach Kategorie") {
                    Chart(groups.keys.sorted(), id: \.self) { category in
                        BarMark(x: .value("Kategorie", category), y: .value("Monatlich", groups[category]?.sum("amount") ?? 0))
                            .foregroundStyle(NjoraTheme.accent)
                    }.frame(height: 180)
                    ForEach(groups.keys.sorted(), id: \.self) { category in
                        LabeledAmount(label: category, amount: groups[category]?.sum("amount") ?? 0)
                    }
                }
            }
            Section("Sonderposten in diesem Monat") {
                if metrics.annualIncome.isEmpty && metrics.annualCosts.isEmpty {
                    Text("Keine Sonderposten").foregroundStyle(.secondary)
                }
                ForEach(metrics.annualIncome) { LabeledAmount(label: $0.name, amount: $0.fields.amount("amount")) }
                ForEach(metrics.annualCosts) { LabeledAmount(label: $0.name, amount: -$0.fields.amount("amount")) }
            }
            Notice(text: store.message)
        }.scrollContentBackground(.hidden).background(NjoraTheme.paper)
            .refreshable { await store.refresh() }
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
            HStack { Text(label); Spacer(); number }
            VStack(alignment: .leading, spacing: 4) { Text(label); number }
        }
    }
    private var number: some View {
        Text(euros(amount)).monospacedDigit().fontWeight(emphasis ? .semibold : .regular)
            .foregroundStyle(amount < 0 ? Color.red : emphasis ? NjoraTheme.positive : Color.primary)
    }
}

extension View {
    func njoraCard() -> some View {
        self.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(NjoraTheme.card, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct PlanSectionView: View {
    let section: PlanSection
    @ObservedObject var store: NjoraStore
    @State private var selection: PlanItem?
    @State private var pendingRemoval: PlanItem?

    var body: some View {
        if let plan = store.plan {
            let items = plan[section]
            List {
                if section == .history, !items.isEmpty {
                    Section("Kontostände im Verlauf") { BalanceChart(plan: plan) }
                }
                if section == .savings {
                    Section("Gesamt") {
                        LabeledAmount(label: "Ersparnisse & Depot", amount: items.reduce(0) { $0 + $1.savingValue }, emphasis: true)
                        Button("Wertpapierkurse aktualisieren") { Task { await store.refreshQuotes() } }.disabled(store.busy)
                        Text("Kurse können verzögert sein. Quelle: Yahoo Finance.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    if items.isEmpty { Text("Hier gibt es noch keine Einträge.").foregroundStyle(.secondary) }
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
                            }
                            .buttonStyle(.plain)
                            .swipeActions { Button("Löschen", role: .destructive) { pendingRemoval = item } }
                        }
                    }
                }
                Notice(text: store.message)
            }
            .scrollContentBackground(.hidden).background(NjoraTheme.paper)
            .navigationTitle(section.title)
            .toolbar {
                if section != .history {
                    ToolbarItem(placement: .primaryAction) {
                        Button { selection = section.newItem } label: { Label("Hinzufügen", systemImage: "plus") }
                            .disabled(store.busy || items.count >= section.limit)
                    }
                }
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
                        changed[section] = items.filter { $0.id != item.id }
                        let result = changed
                        Task { _ = await store.save(result) }
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
        case .income: fields.flag("annual") ? "Jährlich" : "Monatlich"
        case .expenses: fields.text("category")
        case .annual: monthNames[safe: fields.integer("month") ?? -1]
        case .loans: "\(euros(fields.amount("payment"))) pro Monat · \(euros(item.balanceAfter(months: 12))) nach 12 Monaten"
        case .goals:
            item.monthlyGoalNeed().map { "Ziel \(euros(fields.amount("target"))) · Bedarf \(euros($0)) pro Monat" }
                ?? "Ziel \(euros(fields.amount("target")))"
        case .savings: fields.text("kind") == "security" ? fields.text("symbol") : savingNames[fields.text("kind")]
        default: nil
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

let monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
let savingNames = ["security": "Aktie oder ETF", "dayMoney": "Tagesgeldkonto", "fixedDeposit": "Festgeld", "buildingSavings": "Bausparvertrag", "cash": "Bargeldreserve", "other": "Andere Ersparnis"]
