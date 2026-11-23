import SwiftUI

private struct ConfirmedRevenueEntry: Identifiable {
    let id: String
    let name: String
    let month: String
    let vat: Record

    init?(id: String, value: JSONValue) {
        guard let row = value.object, let vat = row["vat"]?.object else { return nil }
        self.id = id
        name = row.text("name")
        month = row.text("month")
        self.vat = vat
    }
}

private struct ForecastSelection: Identifiable {
    let id: String
    let entry: ConfirmedRevenueEntry?
    let base: Plan
}

struct RevenueForecastView: View {
    @ObservedObject var store: NjoraStore
    let plan: Plan
    var readOnly = false
    let save: (Plan, Plan) async throws -> Void
    @State private var selection: ForecastSelection?
    private var currentMonth: String { String(PlanDate.string(.now).prefix(7)) }

    var body: some View {
        let rows = (plan.fields["revenueForecast"]?.object ?? [:]).compactMap { ConfirmedRevenueEntry(id: $0.key, value: $0.value) }
        let groups = Dictionary(grouping: rows, by: \.month)
        let upcoming = groups.keys.filter { $0 >= currentMonth }.sorted()
        let past = groups.keys.filter { $0 < currentMonth }.sorted(by: >)
        List {
            ComparisonPicker(store: store)
            Section {
                LabeledContent("Zugesagt ab " + PlanDate.revenueTitle(currentMonth), value: euros(total(rows.filter { $0.month >= currentMonth })))
                if upcoming.isEmpty { Text("Hier erscheinen bestätigte Aufträge nach erwartetem Umsatzmonat.").foregroundStyle(.secondary) }
            } header: { Text(store.comparisonNet ? "Netto" : "Brutto") }
            ForEach(upcoming, id: \.self) { month in
                Section {
                    entries(groups[month] ?? [])
                } header: { monthHeader(month, rows: groups[month] ?? []) }
            }
            if !past.isEmpty {
                DisclosureGroup("Frühere Zusagen") {
                    ForEach(past, id: \.self) { month in
                        monthHeader(month, rows: groups[month] ?? [])
                        entries(groups[month] ?? [])
                    }
                }
            }
        }
        .planFormStyle()
        .navigationTitle("Forecast")
        .toolbar {
            if !readOnly {
                ToolbarItem(placement: .primaryAction) {
                    Button { selection = ForecastSelection(id: UUID().uuidString, entry: nil, base: plan) } label: {
                        Label("Zusage erfassen", systemImage: "plus")
                    }.disabled(rows.count >= 1000)
                }
            }
        }
        .sheet(item: $selection) { picked in ForecastEditor(selection: picked, save: save) }
    }

    private var basis: String { store.comparisonNet ? "net" : "gross" }
    private func total(_ rows: [ConfirmedRevenueEntry]) -> Double {
        rows.reduce(0) { $0 + ($1.vat.amount(basis) * 100).rounded() } / 100
    }
    private func monthHeader(_ month: String, rows: [ConfirmedRevenueEntry]) -> some View {
        LabeledContent(PlanDate.revenueTitle(month), value: euros(total(rows))).font(.headline)
    }
    private func entries(_ rows: [ConfirmedRevenueEntry]) -> some View {
        ForEach(rows.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { row in
            let label = LabeledContent(row.name, value: euros(row.vat.amount(basis)))
            if readOnly { label }
            else {
                Button { selection = ForecastSelection(id: row.id, entry: row, base: plan) } label: {
                    label.contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }
}

private struct ForecastEditor: View {
    let selection: ForecastSelection
    let save: (Plan, Plan) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var year: Int
    @State private var month: Int
    @State private var draft: RevenueDraft
    @State private var saving = false
    @State private var deleting = false
    @State private var error = ""
    private let firstMonth: String

    init(selection: ForecastSelection, save: @escaping (Plan, Plan) async throws -> Void) {
        self.selection = selection
        self.save = save
        let now = Date()
        let calendar = Calendar(identifier: .gregorian)
        let current = String(PlanDate.string(now).prefix(7))
        let next = calendar.date(byAdding: .month, value: 1, to: now) ?? now
        let selected = selection.entry?.month ?? String(PlanDate.string(next).prefix(7))
        firstMonth = min(current, selection.entry?.month ?? current)
        _year = State(initialValue: Int(selected.prefix(4))!)
        _month = State(initialValue: Int(selected.suffix(2))!)
        _name = State(initialValue: selection.entry?.name ?? "")
        let vat = selection.entry?.vat
        _draft = State(initialValue: RevenueDraft(net: vat?["net"]?.number, meta: vat))
    }
    private var key: String { String(format: "%04d-%02d", year, month) }
    private var firstYear: Int { Int(firstMonth.prefix(4))! }
    private var firstMonthInYear: Int { year == firstYear ? Int(firstMonth.suffix(2))! : 1 }
    private var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool {
        guard let vat = draft.amounts?.meta else { return false }
        return !cleanName.isEmpty && cleanName.utf16.count <= 120 && key >= firstMonth && vat.amount("net") > 0 && vat.amount("gross") >= vat.amount("net")
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PlanField(title: "Auftrag oder Kunde", text: $name)
                    Stepper("Jahr " + String(year), value: $year, in: firstYear...9999)
                    Picker("Erwarteter Umsatzmonat", selection: $month) {
                        ForEach(firstMonthInYear...12, id: \.self) { m in Text(Locale(identifier: "de_DE").calendar.monthSymbols[m-1]).tag(m) }
                    }
                }
                Section("Zugesagter Umsatz") { RevenueFields(draft: $draft) }
                if selection.entry != nil {
                    Button("Zusage löschen", role: .destructive) { deleting = true }
                }
                if !error.isEmpty { Text(error).foregroundStyle(.secondary) }
            }
            .disabled(saving)
            .planFormStyle()
            .onChange(of: year) { _ in month = max(month, firstMonthInYear) }
            .navigationTitle(selection.entry == nil ? "Zusage erfassen" : "Zusage bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button("Speichern") { submit(delete: false) }.disabled(!valid || saving) }
            }
            .alert("Zusage löschen?", isPresented: $deleting) {
                Button("Abbrechen", role: .cancel) {}
                Button("Löschen", role: .destructive) { submit(delete: true) }
            } message: { Text(selection.entry?.name ?? "") }
        }
    }
    private func submit(delete: Bool) {
        guard !saving else { return }
        var plan = selection.base
        var rows = plan.fields["revenueForecast"]?.object ?? [:]
        if delete { rows.removeValue(forKey: selection.id) }
        else if valid, let vat = draft.amounts?.meta {
            rows[selection.id] = .object(["name": .string(cleanName), "month": .string(key), "vat": .object(vat)])
        } else { return }
        plan.fields["revenueForecast"] = .object(rows)
        saving = true
        Task {
            defer { saving = false }
            do { try await save(plan, selection.base); dismiss() }
            catch { self.error = error.localizedDescription.isEmpty ? "Die Zusage konnte nicht gespeichert werden." : error.localizedDescription }
        }
    }
}
