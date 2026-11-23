import SwiftUI
import UniformTypeIdentifiers
import UserNotifications

/// The title stays visible while typing. VoiceOver reads the unit with the field.
struct PlanField: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var unit = ""
    var keyboard: UIKeyboardType = .default
    var cardBalance = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                .accessibilityHidden(true)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if unit == "€" {
                    EuroInput(title: title, text: $text, prompt: prompt,
                              signed: keyboard == .numbersAndPunctuation, cardBalance: cardBalance)
                } else {
                    TextField(title, text: $text, prompt: Text(prompt))
                        .keyboardType(keyboard)
                        .accessibilityLabel(unit.isEmpty ? title : "\(title) in \(unit)")
                        .accessibilityIdentifier("field." + title)
                }
                if !unit.isEmpty {
                    Text(unit).foregroundStyle(.secondary).fixedSize()
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

// Validate the proposed replacement before UIKit displays it, including paste and hardware keyboards.
private struct EuroInput: UIViewRepresentable {
    let title: String
    @Binding var text: String
    let prompt: String
    let signed: Bool
    let cardBalance: Bool

    func makeCoordinator() -> Coordinator { Coordinator(input: self) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.keyboardType = .decimalPad
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.input = self
        let isCredit = cardBalance && text.hasPrefix("-")
        let visible = isCredit ? String(text.dropFirst()) : text
        if field.text != visible { field.text = visible }
        let keyboard: UIKeyboardType = signed && !cardBalance ? .numbersAndPunctuation : .decimalPad
        if field.keyboardType != keyboard {
            field.keyboardType = keyboard
            if field.isFirstResponder { field.reloadInputViews() }
        }
        if cardBalance {
            let prefix = field.leftView as? UILabel ?? UILabel()
            prefix.font = field.font
            prefix.text = isCredit ? "+ " : "− "
            prefix.textColor = .label
            prefix.sizeToFit()
            field.leftView = prefix
        }
        field.leftViewMode = cardBalance ? .always : .never
        field.placeholder = prompt
        field.accessibilityLabel = title + (cardBalance ? (isCredit ? ", Guthaben in €" : ", offener Betrag in €") : " in €")
        field.accessibilityIdentifier = "field." + title
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var input: EuroInput
        init(input: EuroInput) { self.input = input }

        func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString replacement: String) -> Bool {
            let current = textField.text ?? ""
            guard let selection = Range(range, in: current) else { return false }
            let candidate = current.replacingCharacters(in: selection, with: replacement)
            if input.cardBalance && candidate.hasPrefix("+") { return false }
            return acceptsAmountEdit(candidate, signed: input.signed && !input.cardBalance)
        }

        @objc func changed(_ field: UITextField) {
            let magnitude = field.text ?? ""
            // A carried-over card credit keeps its positive net sign while editing.
            input.text = input.cardBalance && input.text.hasPrefix("-") && !magnitude.isEmpty
                ? "-" + magnitude : magnitude
        }
    }
}

private struct PlanFormStyle: ViewModifier {
    @State private var editingField = false

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .frame(maxWidth: 720).frame(maxWidth: .infinity)
            .njoraNavigationBackground()
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if editingField {
                    HStack {
                        Spacer()
                        Button("Tastatur schließen") {
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        }
                        .padding(.horizontal).frame(minHeight: 44)
                    }
                    .background(.bar)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidBeginEditingNotification)) { _ in editingField = true }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidEndEditingNotification)) { _ in editingField = false }
    }
}

extension View {
    func planFormStyle() -> some View { modifier(PlanFormStyle()) }
}

struct BusinessAmountFields: View {
    @Binding var item: PlanItem
    @Binding var vatEntry: String?
    var signed = true
    @State private var vatRateEntry: String?
    @FocusState private var editingVatRate: Bool

    private var vatRate: Double { item.fields.amount("vatRate") }
    private var entersNet: Bool { item.fields.text("vatBasis") == "net" }
    private var grossExpense: Double { item.expenseAmount() }
    private var netExpense: Double { ExpenseVAT.convert(grossExpense, rate: vatRate, toGross: false) }

    private func updateGrossExpense(_ value: Double) {
        guard value != grossExpense else { return }
        item.fields["amount"] = .number(value)
        if !item.rates.isEmpty {
            item.fields["rateChanges"] = .array(item.rates.filter { $0.text("date") > PlanDate.string(.now) }.map(JSONValue.object))
        }
    }

    var body: some View {
        Picker("Eingabe als", selection: Binding(get: { entersNet }, set: { net in
            item.fields["vatBasis"] = .string(net ? "net" : "gross")
            vatEntry = nil
        })) {
            Text("Brutto").tag(false)
            Text("Netto").tag(true)
        }.pickerStyle(.segmented)
        PlanField(title: entersNet ? "Nettobetrag" : "Bruttobetrag", text: Binding(get: {
            let value = entersNet ? netExpense : grossExpense
            return vatEntry ?? (value == 0 ? "" : editableAmount(value))
        }, set: { text in
            vatEntry = text
            if let value = germanAmount(text) {
                updateGrossExpense(entersNet ? ExpenseVAT.convert(value, rate: vatRate, toGross: true) : value)
            }
        }), prompt: "0,00", unit: "€", keyboard: signed ? .numbersAndPunctuation : .decimalPad)
        PlanField(title: "Steuersatz", text: Binding(get: { vatRateEntry ?? ((editingVatRate && vatRate == 0) ? "" : item.fields["vatRate"]?.number.map(editableAmount) ?? "") }, set: { text in
            guard text.range(of: #"\A[0-9]{0,3}(?:[.,][0-9]{0,2})?\z"#, options: .regularExpression) != nil,
                  let rate = germanAmount(text), rate <= 100 else { return }
            vatRateEntry = text
            let previousRate = vatRate
            let net = vatEntry.flatMap(germanAmount) ?? netExpense
            item.fields["vatRate"] = text.isEmpty ? nil : .number(rate)
            if entersNet && rate != previousRate { updateGrossExpense(ExpenseVAT.convert(net, rate: rate, toGross: true)) }
        }), unit: "%", keyboard: .decimalPad)
        .focused($editingVatRate)
        .onChange(of: editingVatRate) { focused in if !focused { vatRateEntry = nil } }
        LabeledContent(entersNet ? "Bruttobetrag" : "Nettobetrag", value: euros(entersNet ? grossExpense : netExpense))
        LabeledContent("Enthaltene Umsatzsteuer", value: euros(grossExpense - netExpense))
    }
}

struct PlanEditor: View {
    let section: PlanSection
    @State private var plan: Plan
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var item: PlanItem
    @State private var valuationDate = Date()
    @State private var amounts: [String: String] = [:]
    @State private var validation = ""

    private let sharedWorkspace: FinanceWorkspace?
    private let sharedSave: ((Plan) async throws -> Void)?
    @State private var savingShared = false

    init(section: PlanSection, item: PlanItem, plan: Plan, store: NjoraStore,
         sharedWorkspace: FinanceWorkspace? = nil, sharedSave: ((Plan) async throws -> Void)? = nil) {
        self.sharedWorkspace = sharedWorkspace
        self.sharedSave = sharedSave
        self.section = section
        _plan = State(initialValue: plan)
        self.store = store
        _item = State(initialValue: item)
    }

    @State private var vatEntry: String?
    private var usesBusinessVAT: Bool { (sharedWorkspace ?? store.workspace) == .business && ([PlanSection.income, .expenses, .annual, .flexible].contains(section)) }
    private var businessAssets: Bool { section == .savings && (sharedWorkspace ?? store.workspace) == .business }
    private var assetTitle: String { businessAssets ? "Vermögenswert" : section.itemTitle }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PlanField(title: "Bezeichnung", text: string("name"), prompt: assetTitle)
                }
                Section { fields }
                Notice(text: validation.isEmpty ? store.notice(in: .editor) : validation)
            }
            .planFormStyle()
            .navigationTitle(plan[section].contains(where: { $0.id == item.id }) ? "\(assetTitle) bearbeiten" : (businessAssets ? "Vermögenswert hinzufügen" : section.addTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Label("Abbrechen", systemImage: "xmark") }
                        .labelStyle(.iconOnly).disabled(savingShared || store.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) { Label("Speichern", systemImage: "checkmark") }
                        .labelStyle(.iconOnly)
                        .disabled(savingShared || store.busy || item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onDisappear { store.clearNotice(in: .editor) }
            .interactiveDismissDisabled(savingShared || store.busy)

        }
    }

    @ViewBuilder private var fields: some View {
        switch section {
        case .accounts:
            Picker("Kontoart", selection: string("type", fallback: "bank")) {
                Text("Konto").tag("bank"); Text("Kreditkarte").tag("credit"); Text("Bargeld").tag("cash")
            }
            let card = item.fields.text("type") == "credit"
            amount(card ? "Offener Kartenbetrag" : "Aktueller Stand", key: "balance", signed: true, cardBalance: card)
            if card { bookingDayPicker("Monatlicher Abbuchungstag") }
        case .income:
            if usesBusinessVAT { businessAmountFields } else { amount("Betrag", key: "amount", signed: true) }
            Toggle("Jährliche Einnahme", isOn: Binding(get: { item.fields.flag("annual") }, set: { value in
                item.fields["annual"] = .boolean(value)
                if value { item.fields["month"] = item.fields["month"] ?? .number(0) }
                else { item.fields.removeValue(forKey: "month") }
            }))
            if item.fields.flag("annual") { monthPicker() }
            bookingDayPicker()
        case .expenses:
            Picker("Zahlungsrhythmus", selection: Binding(get: { item.frequency }, set: { frequency in
                item.fields["frequency"] = .string(frequency.rawValue)
                if frequency != .monthly {
                    item.fields["amount"] = .number(item.expenseAmount())
                    item.fields.removeValue(forKey: "rateChanges")
                }
                if frequency == .once {
                    item.fields["dueDate"] = item.fields["dueDate"] ?? .string(PlanDate.string(.now))
                    item.fields.removeValue(forKey: "bookingDay")
                } else {
                    item.fields.removeValue(forKey: "dueDate")
                    item.fields.removeValue(forKey: "paid")
                }
                if frequency == .monthly || frequency == .once {
                    item.fields.removeValue(forKey: "month")
                } else if item.fields.integer("month") == nil {
                    item.fields["month"] = .number(Double(PlanMetrics(plan: plan).month))
                }
            })) {
                ForEach(ExpenseFrequency.allCases, id: \.self) { Text($0.label).tag($0) }
            }.pickerStyle(.menu)
            if usesBusinessVAT { businessAmountFields }
            else { amount(item.frequency == .monthly ? "Monatsbetrag" : "Betrag je Zahlung", key: "amount", signed: true) }
            if item.frequency == .quarterly || item.frequency == .annual { monthPicker() }
            categoryPicker(default: "Wohnen")
            if item.frequency == .once {
                DatePicker("Fälligkeit", selection: Binding(
                    get: { PlanDate.parse(item.fields.text("dueDate")) ?? .now },
                    set: { item.fields["dueDate"] = .string(PlanDate.string($0)) }
                ), displayedComponents: .date)
                Toggle("Bezahlt", isOn: Binding(get: { item.fields.flag("paid") }, set: { item.fields["paid"] = .boolean($0) }))
            } else { bookingDayPicker() }
            ForEach(item.rates.filter { $0.text("date") > PlanDate.string(.now) }.map { $0.text("date") }, id: \.self) { date in
                if let rate = item.rates.first(where: { $0.text("date") == date }) {
                    LabeledContent((usesBusinessVAT ? "Brutto ab " : "Ab ") + date, value: euros(rate.amount("amount")))
                    Button("Änderung am " + date + " entfernen", role: .destructive) {
                        item.fields["rateChanges"] = .array(item.rates.filter { $0.text("date") != date }.map(JSONValue.object))
                    }
                }
            }
        case .flexible:
            if usesBusinessVAT { businessAmountFields } else { amount("Monatsbudget", key: "amount") }
            Text("Der Monatsplan berücksichtigt das ganze Budget. Die Prognose rechnet anteilig ab heute bis Monatsende.")
                .font(.footnote).foregroundStyle(.secondary)
        case .annual:
            if usesBusinessVAT { businessAmountFields } else { amount("Jahresbetrag", key: "amount", signed: true) }
            monthPicker()
        case .loans:
            Toggle("Hohe Priorität", isOn: Binding(get: { item.fields.flag("highPriority") }, set: {
                item.fields["highPriority"] = .boolean($0)
            }))
            categoryPicker(default: "Kreditraten")
            amount("Ursprüngliche Kreditsumme (optional)", key: "originalPrincipal")
            amount("Restschuld am Stichtag", key: "balance")
            if item.fields.text("balanceDate").isEmpty {
                Button("Heutigen Stand übernehmen") { item.fields["balanceDate"] = .string(PlanDate.string(.now)) }
            } else {
                DatePicker("Stand der Restschuld", selection: Binding(
                    get: { PlanDate.parse(item.fields.text("balanceDate")) ?? .now },
                    set: { item.fields["balanceDate"] = .string(PlanDate.string($0)) }
                ), in: ...Date.now, displayedComponents: .date)
            }
            amount("Bis zum Stichtag gezahlt (optional)", key: "paidBefore")
            amount("Monatsrate", key: "payment")
            bookingDayPicker()
            amount("Jahreszins", key: "interestRate", unit: "%")
            amount("Restlaufzeit", key: "termMonths", unit: "Monate", integer: true)
            amount("Monatliche Sondertilgung", key: "extraPayment")
        case .goals:
            amount("Zielbetrag", key: "target")
            amount("Schon gespart", key: "saved")
            amount("Geplante Monatsrate", key: "monthly")
            Toggle("Zieldatum", isOn: Binding(get: { !item.fields.text("targetDate").isEmpty }, set: {
                item.fields["targetDate"] = .string($0 ? PlanDate.string(.now) : "")
            }))
            if !item.fields.text("targetDate").isEmpty {
                DatePicker("Ziel erreicht bis", selection: Binding(
                    get: { PlanDate.parse(item.fields.text("targetDate")) ?? .now },
                    set: { item.fields["targetDate"] = .string(PlanDate.string($0)) }
                ), displayedComponents: .date)
            }
        case .savings:
            Picker(businessAssets ? "Art des Vermögenswerts" : "Sparform", selection: Binding(get: { item.fields.text("kind", default: "dayMoney") }, set: { kind in
                if item.hasDepreciation { toggleDepreciation(false) }
                item.fields["kind"] = .string(kind)
            })) {
                ForEach(savingNames.keys.sorted(), id: \.self) { key in Text(businessAssets && key == "other" ? "Sonstiger Vermögenswert" : savingNames[key] ?? key).tag(key) }
            }
            if item.fields.text("kind") == "security" {
                PlanField(title: "ISIN oder Börsensymbol", text: Binding(get: { item.fields.text("symbol") }, set: {
                    if item.fields.text("symbol") != $0.uppercased() { resetPrice() }
                    item.fields["symbol"] = .string($0.uppercased())
                })).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Text("Mit ISIN wird der verfügbare Euro-Schlusskurs von Cboe Europe übernommen. Ohne ISIN gilt dein manueller Kurs. Der Datenstand bezeichnet die Kursdatei.")
                    .font(.footnote).foregroundStyle(.secondary)
                amount("Stückzahl", key: "quantity", unit: "Stück")
                amount("Kurs je Stück in Euro", key: "priceEur")
            } else {
                amount(item.hasDepreciation ? "Anschaffungskosten" : "Aktueller Stand", key: "balance")
                if businessAssets && item.fields.text("kind") == "other" {
                    Toggle("Lineare Abschreibung planen", isOn: Binding(get: { item.hasDepreciation }, set: toggleDepreciation))
                    if item.hasDepreciation {
                        DatePicker("Erster Abschreibungsmonat", selection: Binding(
                            get: { PlanDate.parse(item.fields.text("depreciationStart") + "-01") ?? .now },
                            set: { item.fields["depreciationStart"] = .string(String(PlanDate.string($0).prefix(7))) }
                        ), displayedComponents: .date)
                        amount("Nutzungsdauer", key: "usefulLifeMonths", unit: "Monate", integer: true)
                        amount("Restwert am Ende", key: "residualValue")
                        DatePicker("Buchwert berechnen für", selection: $valuationDate, displayedComponents: .date)
                        if let schedule = assetPreview.depreciation(on: valuationDate) {
                            LabeledContent("Abschreibung · Ø pro Monat", value: euros(schedule.monthly))
                            LabeledContent("Buchwert zum Monatsende", value: euros(schedule.book))
                        }
                    }
                }
            }
        case .history: EmptyView()
        }
    }

    private var businessAmountFields: some View {
        BusinessAmountFields(item: $item, vatEntry: $vatEntry, signed: section != .flexible)
    }

    private var assetPreview: PlanItem {
        var edited = item
        for key in ["balance", "usefulLifeMonths", "residualValue"] {
            if let text = amounts[key] { edited.fields[key] = germanAmount(text).map(JSONValue.number) }
        }
        return edited
    }

    private func toggleDepreciation(_ enabled: Bool) {
        if enabled {
            item.fields["depreciationStart"] = .string(String(PlanDate.string(.now).prefix(7)))
            item.fields["usefulLifeMonths"] = .number(36)
            item.fields["residualValue"] = .number(0)
        } else {
            if let value = assetPreview.depreciation(on: .now)?.book { amounts["balance"] = editableAmount(value) }
            for key in ["depreciationStart", "usefulLifeMonths", "residualValue"] {
                item.fields.removeValue(forKey: key)
                amounts.removeValue(forKey: key)
            }
        }
    }

    private func string(_ key: String, fallback: String = "") -> Binding<String> {
        Binding(get: { item.fields.text(key, default: fallback) }, set: { item.fields[key] = .string($0) })
    }

    private func amount(_ title: String, key: String, unit: String = "€", signed: Bool = false, integer: Bool = false, cardBalance: Bool = false) -> some View {
        PlanField(title: title, text: Binding(
            get: {
                if let edited = amounts[key] { return edited }
                let value = section == .expenses && key == "amount" ? item.expenseAmount() : item.fields.amount(key)
                return value == 0 ? "" : editableAmount(value)
            },
            set: { amounts[key] = $0 }
        ), prompt: "0", unit: unit,
           keyboard: signed ? .numbersAndPunctuation : integer ? .numberPad : .decimalPad, cardBalance: cardBalance)
    }

    private func categoryPicker(default fallback: String) -> some View {
        let categories = (sharedWorkspace ?? store.workspace) == .business ? ["Betriebskosten", "Personal", "Büro", "Software", "Marketing", "Versicherungen", "Mobilität", "Sonstige"] : standardExpenseCategories
        let base = categories + (section == .loans ? ["Kreditraten"] : [])
        let used = plan[.expenses].map(\.expenseCategory) + plan[.loans].map(\.loanCategory)
        let selected = item.costCategory(default: fallback)
        var seen = Set<String>()
        let options = (base + (used + [selected]).sorted()).filter {
            !$0.isEmpty && seen.insert($0.lowercased()).inserted
        }
        let display = options.first { $0.caseInsensitiveCompare(selected) == .orderedSame } ?? fallback
        return Picker("Kategorie", selection: Binding(get: { display }, set: { item.fields["category"] = .string($0) })) {
            ForEach(options, id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
    }

    private func bookingDayPicker(_ label: String = "Buchungstag") -> some View {
        Picker(label, selection: Binding(get: { item.fields.integer("bookingDay") ?? 0 }, set: { item.fields["bookingDay"] = .number(Double($0)) })) {
            Text("Kein fester Tag").tag(0)
            ForEach(1...31, id: \.self) { Text("\($0).").tag($0) }
        }
    }

    private func monthPicker() -> some View {
        Picker("Fälligkeitsmonat", selection: Binding(
            get: { item.fields.integer("month") ?? -1 },
            set: { item.fields["month"] = .number(Double($0)) }
        )) {
            if item.fields.integer("month") == nil { Text("Monat wählen").tag(-1) }
            ForEach(monthNames.indices, id: \.self) { Text(monthNames[$0]).tag($0) }
        }
    }

    private func resetPrice() {
        amounts.removeValue(forKey: "priceEur")
        item.fields["price"] = .number(0)
        item.fields["priceEur"] = .number(0)
        item.fields["currency"] = .string("EUR")
        item.fields.removeValue(forKey: "quoteUpdatedAt")
        item.fields.removeValue(forKey: "quoteVenue")
    }

    private func save() {
        var changed = item
        let name = changed.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf16.count <= 120 else {
            validation = "Bitte gib eine Bezeichnung mit höchstens 120 Zeichen ein."; return
        }
        if usesBusinessVAT && (vatEntry.map { germanAmount($0) == nil } == true || abs(item.expenseAmount()) > 1_000_000_000) {
            validation = "Bitte prüfe den eingegebenen Betrag."; return
        }
        changed.fields["name"] = .string(name)
        if section == .accounts && changed.fields.text("type") != "credit" { changed.fields.removeValue(forKey: "bookingDay") }
        for (key, value) in amounts {
            if section == .loans && key == "originalPrincipal" && (value.isEmpty || germanAmount(value) == 0) {
                changed.fields.removeValue(forKey: key)
                continue
            }
            guard let number = germanAmount(value),
                  key != "termMonths" || (number >= 0 && number.rounded() == number),
                  !([PlanSection.loans, .goals, .savings].contains(section)) || number >= 0 else {
                validation = "Bitte prüfe deine Beträge und Vertragsdaten."; return
            }
            changed.fields[key] = .number(number)
            if section == .expenses && key == "amount" && !changed.rates.isEmpty {
                changed.fields["rateChanges"] = .array(changed.rates.filter { $0.text("date") > PlanDate.string(.now) }.map(JSONValue.object))
            }
        }
        if section == .flexible {
            let value = changed.fields.amount("amount")
            guard value >= 0, (value * 100).rounded() / 100 == value else {
                validation = "Bitte gib ein Monatsbudget ab 0 € mit höchstens zwei Nachkommastellen ein."; return
            }
        }
        if (section == .expenses || section == .loans) && changed.fields.text("category").utf16.count > 80 {
            validation = "Die Kategorie darf höchstens 80 Zeichen lang sein."; return
        }
        if section == .savings && !changed.validDepreciation {
            validation = "Bitte prüfe die Anschaffungskosten, die Nutzungsdauer (1–1200 Monate) und den Restwert. Er darf die Anschaffungskosten nicht übersteigen."
            return
        }
        if section == .savings && changed.fields.text("kind") == "security" {
            let symbol = changed.fields.text("symbol").trimmingCharacters(in: .whitespacesAndNewlines)
            guard symbol.isEmpty || symbol.range(of: #"^[A-Z0-9.^=_:-]{1,30}$"#, options: .regularExpression) != nil else {
                validation = "Bitte gib ein gültiges Börsensymbol ein."; return
            }
            changed.fields["symbol"] = .string(symbol)
            if amounts["priceEur"] != nil {
                changed.fields["price"] = changed.fields["priceEur"]
                changed.fields["currency"] = .string("EUR")
                changed.fields["quoteVenue"] = .string("Manuell")
                changed.fields["quoteUpdatedAt"] = .string(ISO8601DateFormatter().string(from: Date()))
            }
            for key in ["quantity", "price", "priceEur"] where changed.fields[key] == nil {
                changed.fields[key] = .number(0)
            }
            changed.fields["currency"] = changed.fields["currency"] ?? .string("EUR")
        }
        validation = ""
        var revised = plan
        revised.save(changed, in: section)
        if section == .expenses && revised.storagePlan[.expenses].count > PlanSection.expenses.limit {
            validation = "Der Plan enthält bereits 250 monatliche oder quartalsweise Fixkosten."
            return
        }
        let result = revised
        if let sharedSave {
            savingShared = true
            Task {
                defer { savingShared = false }
                do { try await sharedSave(result); dismiss() }
                catch { validation = error.localizedDescription }
            }
        } else {
            Task { if await store.save(result, basedOn: plan) { dismiss() } }
        }
    }
}

func editableAmount(_ value: Double) -> String {
    value.formatted(.number.grouping(.never).precision(.fractionLength(0...10)).locale(Locale(identifier: "de_DE")))
}

struct CheckInView: View {
    @State private var plan: Plan
    init(plan: Plan, store: NjoraStore) {
        _plan = State(initialValue: plan)
        _note = State(initialValue: plan[.history].first { $0.fields.text("date") == PlanDate.string(.now) }?.fields.text("note") ?? "")
        self.store = store
    }
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var balances: [String: String] = [:]
    @State private var day = Date()
    @State private var note: String
    @State private var drafts: [String: (balances: [String: String], note: String)] = [:]

    @State private var revenueDrafts: [String: String] = [:]
    private var revenueMonth: (key: String, title: String) { PlanDate.previousRevenueMonth(for: day) }
    private var revenueText: Binding<String> {
        let key = revenueMonth.key
        return Binding(get: { revenueDrafts[key] ?? plan.monthlyRevenue[key]?.number.map(editableAmount) ?? "" },
                       set: { revenueDrafts[key] = $0 })
    }
    private var revenueAmount: Double? {
        let text = revenueText.wrappedValue
        return text.isEmpty ? nil : germanAmount(text)
    }

    private var checkInDate: Binding<Date> {
        Binding(get: { day }, set: { selected in
            let oldDate = PlanDate.string(day), selectedDate = PlanDate.string(selected)
            guard oldDate != selectedDate else { return }
            drafts[oldDate] = (balances, note)
            day = selected
            if let draft = drafts[selectedDate] {
                balances = draft.balances
                note = draft.note
                return
            }
            let snapshot = plan[.history].first { $0.fields.text("date") == selectedDate }
            note = snapshot?.fields.text("note") ?? ""
            if selectedDate != PlanDate.string(.now), let historical = snapshot?.fields["balances"]?.object {
                balances = Dictionary(uniqueKeysWithValues: plan[.accounts].map { ($0.id, editableAmount(historical.amount($0.id))) })
            } else {
                balances = [:]
            }
        })
    }
    @State private var validation = ""

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Datum", selection: checkInDate, in: ...Date(), displayedComponents: .date)
                if PlanDate.string(day) != PlanDate.string(.now) {
                    let existing = plan[.history].contains { $0.fields.text("date") == PlanDate.string(day) }
                    Text(existing ? "Du bearbeitest den Check-in für diesen Tag. Deine aktuellen Kontostände bleiben erhalten."
                         : "Für diesen Tag fehlt ein Check-in. Trage die damaligen Beträge ein. Als Ausgangswerte siehst du deine heutigen Kontostände.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if store.workspace == .business {
                    Section("Umsatz des Vormonats") {
                        PlanField(title: "Nettoumsatz " + revenueMonth.title, text: revenueText, prompt: "0,00", unit: "€", keyboard: .numbersAndPunctuation)
                    }
                }
                Section("Kontostände") {
                    ForEach(plan[.accounts]) { item in
                        PlanField(title: item.name, text: Binding(
                            get: { balances[item.id] ?? editableAmount(item.fields.amount("balance")) },
                            set: { balances[item.id] = $0 }
                        ), unit: "€", keyboard: .numbersAndPunctuation, cardBalance: item.fields.text("type") == "credit")
                    }
                }
                PlanField(title: "Notiz", text: $note, prompt: "Optional")
                Notice(text: validation.isEmpty ? store.notice(in: .editor) : validation)
            }
            .planFormStyle()
            .onDisappear { store.clearNotice(in: .editor) }
            .interactiveDismissDisabled(store.busy)
            .navigationTitle("Check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() }.disabled(store.busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern", action: save).disabled(store.busy || (store.workspace == .business ? revenueAmount == nil : plan[.accounts].isEmpty))
                }
            }
        }
    }

    private func save() {
        var accounts = plan[.accounts]
        for index in accounts.indices {
            guard let value = balances[accounts[index].id] else { continue }
            guard let amount = germanAmount(value) else { validation = "Bitte prüfe die eingegebenen Kontostände."; return }
            accounts[index].fields["balance"] = .number(amount)
        }
        let date = PlanDate.string(day)
        guard note.utf16.count <= 500 else { validation = "Die Notiz darf höchstens 500 Zeichen lang sein."; return }
        guard plan[.history].count < PlanSection.history.limit || plan[.history].contains(where: { $0.fields.text("date") == date }) else {
            validation = "Der Verlauf ist voll. Exportiere ihn und entferne bei Bedarf einen älteren Eintrag."; return
        }
        validation = ""
        var changed = plan
        if store.workspace == .business {
            guard let amount = revenueAmount else { validation = "Bitte gib den Umsatz des Vormonats ein."; return }
            changed.setRevenue(amount, forMonth: revenueMonth.key)
        }
        changed.recordCheckIn(accounts: accounts, date: date, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
        let result = changed
        Task { if await store.save(result, basedOn: plan) { dismiss() } }
    }
}

struct PlanFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let contents = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        data = contents
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct SettingsView: View {
    @EnvironmentObject private var appearance: AppearanceSettings
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var cadence = "weekly"
    @State private var delete = false
    @State private var importing = false
    @State private var exporting = false
    @State private var importPreview: Plan?
    @State private var importBaseline: Plan?
    @State private var exportDocument: PlanFile?
    @State private var notice = ""
    @State private var reminderActive = false
    @State private var resolveConflict = false
    @State private var profileBaseline: Plan?

    var body: some View {
        Form {
            if let billing = store.billing, billing.provider == "apple" || billing.provider == "stripe" {
                Section("Abonnement") {
                    if billing.provider == "apple" {
                        Link("Apple-Abo verwalten oder kündigen", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                        Text("Kündige dein Apple-Abo auch dann bei Apple, wenn du dein Njora-Konto löschst.").font(.footnote)
                    } else if billing.provider == "stripe" {
                        Text("Dein Web-Abo verwaltest du im Kontobereich von njora.de.")
                    }
                }
            }
            Section("Freigaben") {
                NavigationLink("Finanzbereich teilen") { SharingView(store: store, initial: store.workspace) }
            }
            Section("Erscheinungsbild") {
                ForEach(NjoraAppearance.allCases, id: \.self) { option in
                    Button {
                        do { try appearance.select(option) }
                        catch { notice = "Das Erscheinungsbild konnte nicht gespeichert werden." }
                    } label: {
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 6)
                                .fill(option.paper)
                                .overlay { Capsule().fill(option.accent).frame(width: 19, height: 6) }
                                .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(.secondary.opacity(0.3)) }
                                .frame(width: 34, height: 26)
                                .accessibilityHidden(true)
                            Text(option.title).foregroundStyle(.primary)
                            Spacer()
                            if option == appearance.selected {
                                Image(systemName: "checkmark").accessibilityHidden(true)
                            }
                        }
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(option == appearance.selected ? .isSelected : [])
                }
            }
            Section("Profil") {
                if let email = store.user?.email { Text(email).foregroundStyle(.secondary) }
                if store.plan != nil, store.billing?.active != false {
                    PlanField(title: "Name des Finanzplans", text: $name)
                    Picker("Check-in-Rhythmus", selection: $cadence) {
                        Text("Wöchentlich").tag("weekly"); Text("Täglich").tag("daily")
                    }
                    Button("Einstellungen speichern", action: saveProfile)
                        .disabled(store.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 80)
                }
            }
            Section("Erinnerung") {
                Text(reminderActive ? "Check-in-Erinnerung aktiv." : "Erinnerung täglich oder sonntags um 19 Uhr, passend zu deinem gespeicherten Rhythmus.")
                    .font(.footnote)
                Button(reminderActive ? "Erinnerung aktualisieren" : "Erinnerung aktivieren") { Task { await enableReminder() } }
                if reminderActive {
                    Button("Erinnerung ausschalten") {
                        NjoraReminder.disable()
                        reminderActive = false
                    }
                }
            }
            Section("Finanzplan") {
                Button("Sicherung als JSON exportieren", action: export).disabled(store.plan == nil)
                Button("JSON-Sicherung importieren") { importing = true }.disabled(store.billing?.active == false)
                if !store.syncStatus.isEmpty { Text(store.syncStatus).font(.footnote).foregroundStyle(.secondary) }
                if store.conflict {
                    Button("Versionskonflikt lösen") { resolveConflict = true }
                } else {
                    Button(store.syncing ? "Wird abgeglichen …" : "Jetzt mit der Cloud abgleichen") {
                        Task { await store.refresh(in: .settings) }
                    }.disabled(store.syncing)
                }
            }
            Section("Konto") {
                Button("Abmelden") {
                    Task { await store.endSession(deleteAccount: false, in: .settings); if store.state == .signedOut { dismiss() } }
                }.disabled(store.busy)
                Button("Konto löschen", role: .destructive) { delete = true }.disabled(store.busy)
                LegalLinksView()
            }
            Notice(text: notice.isEmpty ? store.notice(in: .settings) : notice)
        }
        .planFormStyle()
        .navigationTitle("Konto & Einstellungen")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
        .task {
            profileBaseline = store.plan
            name = store.plan?.name ?? ""
            cadence = store.plan?.cadence ?? "weekly"
            reminderActive = await UNUserNotificationCenter.current().pendingNotificationRequests().contains { $0.identifier == NjoraReminder.identifier }
        }
        .confirmationDialog("Welche Werte möchtest du bei Überschneidungen behalten?", isPresented: $resolveConflict,
                            titleVisibility: .visible) {
            Button("Werte dieses Geräts behalten") { store.resolve(.device) }
            Button("Werte aus der Cloud behalten") { store.resolve(.cloud) }
            Button("Abbrechen", role: .cancel) { }
        } message: { Text("Unabhängige Änderungen aus beiden Versionen werden übernommen.") }
        .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .json,
                      defaultFilename: "njora-sicherung-\(PlanDate.string(.now))") { result in
            exportDocument = nil
            if case .failure = result { notice = "Die Sicherung konnte nicht exportiert werden." }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= Plan.maximumBackupBytes else {
                    throw CocoaError(.fileReadTooLarge)
                }
                importBaseline = store.plan
                importPreview = try Plan.decodeBackup(Data(contentsOf: url))
            } catch CocoaError.userCancelled {
                return
            } catch let limit as PlanStorageError {
                notice = limit.localizedDescription
            } catch CocoaError.fileReadTooLarge {
                notice = "Die Sicherungsdatei ist zu groß."
            } catch { notice = "Die ausgewählte Datei ist keine gültige Njora-Sicherung." }
        }
        .confirmationDialog("Aktuellen Plan durch die Sicherung ersetzen?", isPresented: Binding(
            get: { importPreview != nil }, set: { if !$0 { importPreview = nil } }
        ), titleVisibility: .visible) {
            if let incoming = importPreview {
                Button("Sicherung übernehmen", role: .destructive) {
                    notice = ""
                    Task { if await store.save(incoming, basedOn: importBaseline, in: .settings) { profileBaseline = incoming; name = incoming.name; cadence = incoming.cadence } }
                }
            }
            Button("Abbrechen", role: .cancel) { importPreview = nil }
        } message: {
            if let incoming = importPreview {
                Text("\(incoming.name) · \(incoming[.accounts].count) Konten · \(incoming[.loans].count) Kredite · \(incoming[.history].count) Check-ins")
            }
        }
        .accountDeletionDialog(isPresented: $delete) {
            Task { await store.endSession(deleteAccount: true, in: .settings); if store.state == .signedOut { dismiss() } }
        }
    }

    private func saveProfile() {
        guard let baseline = profileBaseline else { return }
        var changed = baseline
        changed.fields["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        changed.fields["checkInCadence"] = .string(cadence)
        let plan = changed
        notice = ""
        Task {
            if await store.save(plan, basedOn: baseline, in: .settings), let saved = store.plan {
                profileBaseline = saved
                name = saved.name
                cadence = saved.cadence
                if reminderActive { await enableReminder() }
            }
        }
    }

    private func enableReminder() async {
        do {
            reminderActive = try await NjoraReminder.enable(cadence: store.plan?.cadence ?? "weekly")
            notice = reminderActive ? "Die Erinnerung ist eingerichtet." : "Aktiviere Mitteilungen für Njora in den iOS-Einstellungen."
        } catch { notice = "Die Erinnerung konnte nicht eingerichtet werden." }
    }

    private func export() {
        guard let plan = store.plan else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            exportDocument = PlanFile(data: try encoder.encode(plan))
            exporting = true
        } catch { notice = "Die Sicherung konnte nicht erstellt werden." }
    }
}
