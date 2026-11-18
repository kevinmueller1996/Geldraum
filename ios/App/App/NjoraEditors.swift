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

        @objc func changed(_ field: UITextField) { input.text = field.text ?? "" }
    }
}

private struct PlanFormStyle: ViewModifier {
    @State private var editingField = false

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(NjoraTheme.paper)
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

struct PlanEditor: View {
    let section: PlanSection
    let plan: Plan
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var item: PlanItem
    @State private var amounts: [String: String] = [:]
    @State private var validation = ""
    @State private var showSearch = false

    init(section: PlanSection, item: PlanItem, plan: Plan, store: NjoraStore) {
        self.section = section
        self.plan = plan
        self.store = store
        _item = State(initialValue: item)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PlanField(title: "Bezeichnung", text: string("name"), prompt: section.itemTitle)
                }
                Section { fields }
                Notice(text: validation.isEmpty ? store.notice(in: .editor) : validation)
                if store.conflict {
                    Button("Neueren Plan laden und diesen Entwurf verwerfen", role: .destructive) {
                        Task { if await store.refresh() { dismiss() } }
                    }
                }
            }
            .planFormStyle()
            .navigationTitle(plan[section].contains(where: { $0.id == item.id }) ? "\(section.itemTitle) bearbeiten" : section.addTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { Label("Abbrechen", systemImage: "xmark") }
                        .labelStyle(.iconOnly).disabled(store.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) { Label("Speichern", systemImage: "checkmark") }
                        .labelStyle(.iconOnly)
                        .disabled(store.busy || store.conflict || item.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onDisappear { store.clearNotice(in: .editor) }
            .interactiveDismissDisabled(store.busy)
            .sheet(isPresented: $showSearch) {
                SecuritySearchView(store: store) { result in
                    if item.fields.text("symbol") != result.symbol { resetPrice() }
                    item.fields["symbol"] = .string(result.symbol)
                    item.fields["name"] = .string(result.name)
                }
            }
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
        case .income:
            amount("Betrag", key: "amount", signed: true)
            Toggle("Jährliche Einnahme", isOn: Binding(get: { item.fields.flag("annual") }, set: { value in
                item.fields["annual"] = .boolean(value)
                if value { item.fields["month"] = item.fields["month"] ?? .number(0) }
                else { item.fields.removeValue(forKey: "month") }
            }))
            if item.fields.flag("annual") { monthPicker() }
        case .expenses:
            Picker("Zahlungsrhythmus", selection: Binding(get: { item.frequency }, set: { frequency in
                item.fields["frequency"] = .string(frequency.rawValue)
                if frequency != .monthly && item.fields.integer("month") == nil {
                    item.fields["month"] = .number(Double(PlanMetrics(plan: plan).month))
                }
            })) {
                ForEach(ExpenseFrequency.allCases, id: \.self) { Text($0.label).tag($0) }
            }.pickerStyle(.menu)
            amount(item.frequency == .monthly ? "Monatsbetrag" : "Betrag je Zahlung", key: "amount", signed: true)
            if item.frequency != .monthly { monthPicker() }
            categoryPicker(default: "Wohnen")
            Picker("Buchungstag", selection: Binding(get: { item.fields.integer("bookingDay") ?? 0 }, set: { item.fields["bookingDay"] = .number(Double($0)) })) {
                Text("Kein fester Tag").tag(0)
                ForEach(1...31, id: \.self) { Text("\($0).").tag($0) }
            }
        case .annual:
            amount("Jahresbetrag", key: "amount", signed: true)
            monthPicker()
        case .loans:
            categoryPicker(default: "Kreditraten")
            amount("Restschuld", key: "balance")
            amount("Monatsrate", key: "payment")
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
            Picker("Sparform", selection: string("kind", fallback: "dayMoney")) {
                ForEach(savingNames.keys.sorted(), id: \.self) { key in Text(savingNames[key] ?? key).tag(key) }
            }
            if item.fields.text("kind") == "security" {
                PlanField(title: "Börsensymbol", text: Binding(get: { item.fields.text("symbol") }, set: {
                    if item.fields.text("symbol") != $0.uppercased() { resetPrice() }
                    item.fields["symbol"] = .string($0.uppercased())
                })).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Button("Wertpapier suchen") { showSearch = true }
                amount("Stückzahl", key: "quantity", unit: "Stück")
                LabeledAmount(label: "Letzter Kurs in EUR", amount: item.fields.amount("priceEur"))
            } else {
                amount("Aktueller Stand", key: "balance")
            }
        case .history: EmptyView()
        }
    }

    private func string(_ key: String, fallback: String = "") -> Binding<String> {
        Binding(get: { item.fields.text(key, default: fallback) }, set: { item.fields[key] = .string($0) })
    }

    private func amount(_ title: String, key: String, unit: String = "€", signed: Bool = false, integer: Bool = false, cardBalance: Bool = false) -> some View {
        PlanField(title: title, text: Binding(
            get: {
                if let edited = amounts[key] { return edited }
                let value = item.fields.amount(key)
                return value == 0 ? "" : editableAmount(value)
            },
            set: { amounts[key] = $0 }
        ), prompt: "0", unit: unit,
           keyboard: signed ? .numbersAndPunctuation : integer ? .numberPad : .decimalPad, cardBalance: cardBalance)
    }

    private func categoryPicker(default fallback: String) -> some View {
        let base = standardExpenseCategories + (section == .loans ? ["Kreditraten"] : [])
        let used = plan[.expenses].map { $0.fields.text("category") } + plan[.loans].compactMap { $0.fields["category"]?.string }
        let selected = section == .loans ? item.loanCategory : item.fields.text("category", default: fallback)
        var seen = Set<String>()
        let options = (base + (used + [selected]).sorted()).filter {
            !$0.isEmpty && seen.insert($0.lowercased()).inserted
        }
        let display = options.first { $0.caseInsensitiveCompare(selected) == .orderedSame } ?? fallback
        return Picker("Kategorie", selection: Binding(get: { display }, set: { item.fields["category"] = .string($0) })) {
            ForEach(options, id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.menu)
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
        changed.fields["name"] = .string(name)
        for (key, value) in amounts {
            guard let number = germanAmount(value),
                  key != "termMonths" || (number >= 0 && number.rounded() == number),
                  key != "interestRate" || number >= 0 else {
                validation = "Bitte prüfe deine Beträge und Vertragsdaten."; return
            }
            changed.fields[key] = .number(number)
        }
        if (section == .expenses || section == .loans) && changed.fields.text("category").utf16.count > 80 {
            validation = "Die Kategorie darf höchstens 80 Zeichen lang sein."; return
        }
        if section == .savings && changed.fields.text("kind") == "security" {
            let symbol = changed.fields.text("symbol").trimmingCharacters(in: .whitespacesAndNewlines)
            guard symbol.range(of: #"^[A-Z0-9.^=_:-]{1,30}$"#, options: .regularExpression) != nil else {
                validation = "Bitte gib ein gültiges Börsensymbol ein."; return
            }
            changed.fields["symbol"] = .string(symbol)
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
        Task { if await store.save(result) { dismiss() } }
    }
}

func editableAmount(_ value: Double) -> String {
    value.formatted(.number.grouping(.never).precision(.fractionLength(0...10)).locale(Locale(identifier: "de_DE")))
}

struct SecuritySearchView: View {
    let store: NjoraStore
    let choose: (SecuritySuggestion) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var suggestions: [SecuritySuggestion] = []
    @State private var message = ""

    var body: some View {
        NavigationStack {
            List {
                TextField("Name, ISIN oder Symbol", text: $query).autocorrectionDisabled()
                Notice(text: message)
                ForEach(suggestions) { item in
                    Button {
                        choose(item)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading) {
                            Text(item.name)
                            Text("\(item.symbol) · \(item.exchangeName)").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .planFormStyle()
            .navigationTitle("Wertpapier suchen")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
            .task(id: query) {
                let input = query.trimmingCharacters(in: .whitespacesAndNewlines)
                suggestions = []
                message = ""
                guard (2...64).contains(input.count) else { return }
                do {
                    try await Task.sleep(for: .milliseconds(300))
                    let result = try await store.search(input)
                    try Task.checkCancellation()
                    suggestions = result
                    if result.isEmpty { message = "Keine Wertpapiere gefunden." }
                } catch where Task.isCancelled { }
                catch { message = "Die Wertpapiersuche ist gerade nicht erreichbar." }
            }
        }
    }
}

struct CheckInView: View {
    let plan: Plan
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var balances: [String: String] = [:]
    @State private var day = Date()
    @State private var note = ""
    @State private var validation = ""

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Datum", selection: $day, in: ...Date(), displayedComponents: .date)
                if PlanDate.string(day) != PlanDate.string(.now) { Text("Dieser Nachtrag wird nur im Verlauf gespeichert.").font(.footnote) }
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
                if store.conflict {
                    Button("Neueren Plan laden und Entwurf verwerfen", role: .destructive) {
                        Task { if await store.refresh() { dismiss() } }
                    }
                }
            }
            .planFormStyle()
            .onDisappear { store.clearNotice(in: .editor) }
            .interactiveDismissDisabled(store.busy)
            .navigationTitle("Check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() }.disabled(store.busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Speichern", action: save).disabled(store.busy || store.conflict || plan[.accounts].isEmpty)
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
        changed.recordCheckIn(accounts: accounts, date: date, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
        let result = changed
        Task { if await store.save(result) { dismiss() } }
    }
}

enum NjoraReminder {
    static let identifier = "njora.check-in"
    static func enable(cadence: String) async throws -> Bool {
        let center = UNUserNotificationCenter.current()
        guard try await center.requestAuthorization(options: [.alert, .sound]) else { return false }
        var components = DateComponents()
        components.hour = 19
        components.minute = 0
        if cadence != "daily" { components.weekday = 1 }
        let content = UNMutableNotificationContent()
        content.title = "Zeit für deinen Njora-Check-in"
        content.body = "Aktualisiere deine Kontostände und behalte deinen Überblick."
        content.sound = .default
        try await center.add(UNNotificationRequest(identifier: identifier, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: true)))
        return true
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
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var cadence = "weekly"
    @State private var delete = false
    @State private var importing = false
    @State private var exporting = false
    @State private var importPreview: Plan?
    @State private var exportDocument: PlanFile?
    @State private var notice = ""
    @State private var reminderActive = false

    var body: some View {
        Form {
            Section("Profil") {
                if let email = store.user?.email { Text(email).foregroundStyle(.secondary) }
                PlanField(title: "Name des Finanzplans", text: $name)
                Picker("Check-in-Rhythmus", selection: $cadence) {
                    Text("Wöchentlich").tag("weekly"); Text("Täglich").tag("daily")
                }
                Button("Einstellungen speichern", action: saveProfile)
                    .disabled(store.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 80)
            }
            Section("Erinnerung") {
                Text(reminderActive ? "Check-in-Erinnerung aktiv." : "Erinnerung täglich oder sonntags um 19 Uhr, passend zu deinem gespeicherten Rhythmus.")
                    .font(.footnote)
                Button(reminderActive ? "Erinnerung aktualisieren" : "Erinnerung aktivieren") { Task { await enableReminder() } }
                if reminderActive {
                    Button("Erinnerung ausschalten") {
                        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [NjoraReminder.identifier])
                        reminderActive = false
                    }
                }
            }
            Section("Finanzplan") {
                Button("Sicherung als JSON exportieren", action: export)
                Button("JSON-Sicherung importieren") { importing = true }
                Button("Plan neu laden") { Task { await store.refresh(in: .settings) } }
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
            name = store.plan?.name ?? ""
            cadence = store.plan?.cadence ?? "weekly"
            reminderActive = await UNUserNotificationCenter.current().pendingNotificationRequests().contains { $0.identifier == NjoraReminder.identifier }
        }
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
                guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 500_000 else {
                    throw CocoaError(.fileReadTooLarge)
                }
                importPreview = try Plan.decodeBackup(Data(contentsOf: url))
            } catch { notice = "Die ausgewählte Datei ist keine gültige Njora-Sicherung." }
        }
        .confirmationDialog("Aktuellen Plan durch die Sicherung ersetzen?", isPresented: Binding(
            get: { importPreview != nil }, set: { if !$0 { importPreview = nil } }
        ), titleVisibility: .visible) {
            if let incoming = importPreview {
                Button("Sicherung übernehmen", role: .destructive) {
                    notice = ""
                    Task { if await store.save(incoming, in: .settings) { name = incoming.name; cadence = incoming.cadence } }
                }
            }
            Button("Abbrechen", role: .cancel) { importPreview = nil }
        } message: {
            if let incoming = importPreview {
                Text("\(incoming.name) · \(incoming[.accounts].count) Konten · \(incoming[.loans].count) Kredite · \(incoming[.history].count) Check-ins")
            }
        }
        .confirmationDialog("Konto und Finanzplan dauerhaft löschen?", isPresented: $delete, titleVisibility: .visible) {
            Button("Konto endgültig löschen", role: .destructive) {
                Task { await store.endSession(deleteAccount: true, in: .settings); if store.state == .signedOut { dismiss() } }
            }
        }
    }

    private func saveProfile() {
        guard var changed = store.plan else { return }
        changed.fields["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        changed.fields["checkInCadence"] = .string(cadence)
        let plan = changed
        notice = ""
        Task {
            if await store.save(plan, in: .settings), reminderActive { await enableReminder() }
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
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            exportDocument = PlanFile(data: try encoder.encode(plan))
            exporting = true
        } catch { notice = "Die Sicherung konnte nicht erstellt werden." }
    }
}
