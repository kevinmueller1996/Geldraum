import Foundation

enum JSONValue: Codable, Equatable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), boolean(Bool), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .boolean(item) }
        else if let item = try? value.decode(Double.self) { self = .number(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode([String: JSONValue].self) { self = .object(item) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .boolean(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }

    var object: Record? { if case .object(let item) = self { return item }; return nil }
    var array: [JSONValue]? { if case .array(let item) = self { return item }; return nil }
    var string: String? { if case .string(let item) = self { return item }; return nil }
    var number: Double? { if case .number(let item) = self { return item }; return nil }
    var bool: Bool? { if case .boolean(let item) = self { return item }; return nil }
}

typealias Record = [String: JSONValue]

extension Dictionary where Key == String, Value == JSONValue {
    func text(_ key: String, default fallback: String = "") -> String { self[key]?.string ?? fallback }
    func amount(_ key: String) -> Double { self[key]?.number ?? 0 }
    func integer(_ key: String) -> Int? { self[key]?.number.flatMap(Int.init(exactly:)) }
    func flag(_ key: String) -> Bool { self[key]?.bool ?? false }
}

struct Plan: Codable, Equatable {
    // The server persists a shared JSON document. Keep unfamiliar keys and nested values
    // intact when editing a field so a newer web client cannot lose data on an iOS save.
    var fields: Record

    init(fields: Record) { self.fields = fields }
    init(from decoder: Decoder) throws { fields = try decoder.singleValueContainer().decode(Record.self) }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        try value.encode(storagePlan.fields)
    }

    var name: String { fields.text("name", default: "Mein Finanzplan") }
    var cadence: String { fields.text("checkInCadence") == "daily" ? "daily" : "weekly" }

    static func blank(name: String) -> Plan {
        var plan = Plan(fields: [
            "name": .string(name), "liquidity": .number(0), "checkInCadence": .string("weekly"),
            "categoryColors": .object([:]),
            "scenario": .object(["name": .string("Großes Projekt"), "cost": .number(0), "equity": .number(0)])
        ])
        for section in PlanSection.allCases { plan[section] = [] }
        plan[.accounts] = [PlanSection.accounts.newItem]
        plan[.income] = [PlanSection.income.newItem]
        return plan
    }

    static let maximumBackupBytes = 4_000_000

    static func decodeBackup(_ data: Data) throws -> Plan {
        // Older backups were pretty-printed and can be larger than the stored JSON.
        guard data.count <= maximumBackupBytes else { throw CocoaError(.fileReadTooLarge) }
        let decoded = try JSONDecoder().decode(Plan.self, from: data)
        guard let name = decoded.fields["name"]?.string, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.utf16.count <= 80,
              PlanSection.allCases.allSatisfy({ decoded.fields[$0.rawValue]?.array != nil || ($0 == .savings && decoded.fields[$0.rawValue] == nil) }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        var plan = decoded
        let defaults = Plan.blank(name: name)
        for section in PlanSection.allCases {
            let value = decoded.fields[section.rawValue]
            if value == nil || value == .null {
                plan[section] = defaults[section]
                continue
            }
            guard let items = value?.array, items.count <= section.limit,
                  items.allSatisfy({ !($0.object?.text("id") ?? "").isEmpty }),
                  Set(items.compactMap { $0.object?.text("id") }).count == items.count else {
                throw CocoaError(.fileReadCorruptFile)
            }
        }
        plan[.savings] = plan[.savings].map { item in
            var saving = item
            if saving.fields["balance"] == nil { saving.fields["balance"] = .number(0) }
            if saving.fields.text("kind") == "security" {
                if saving.fields["symbol"] == nil || saving.fields["symbol"]?.string != nil {
                    saving.fields["symbol"] = .string(saving.fields.text("symbol").uppercased())
                }
                if saving.fields["quantity"] == nil { saving.fields["quantity"] = .number(0) }
                if saving.fields["price"] == nil { saving.fields["price"] = .number(0) }
                if saving.fields["priceEur"] == nil { saving.fields["priceEur"] = .number(saving.fields.amount("price")) }
                if saving.fields["currency"] == nil { saving.fields["currency"] = .string("EUR") }
            }
            return saving
        }
        guard plan.isRestorable else { throw CocoaError(.fileReadCorruptFile) }
        let unified = plan.unifiedCosts
        try unified.checkStorageLimits()
        return unified
    }

    func checkStorageLimits() throws {
        let stored = storagePlan
        for section in PlanSection.allCases where stored[section].count > section.limit {
            throw PlanStorageError.limit(section)
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        guard try encoder.encode(stored).count <= 500_000 else { throw PlanStorageError.tooLarge }
    }

    // Imports replace the entire local plan. Validate known fields before an offline
    // restore, while preserving unknown keys for newer clients.
    private var isRestorable: Bool {
        guard fields.optionalMoney("liquidity"),
              fields["checkInCadence"].map({ ["weekly", "daily"].contains($0.string ?? "") }) ?? true,
              fields["categoryColors"].map({ $0.object?.values.allSatisfy { $0.string.map { $0.utf16.count <= 80 } == true } == true }) ?? true else { return false }
        if let scenario = fields["scenario"] {
            guard let data = scenario.object, data.hasText("name", 160), data.hasMoney("cost"), data.hasMoney("equity") else { return false }
        }
        return PlanSection.allCases.allSatisfy { section in
            self[section].allSatisfy { $0.isRestorable(in: section) }
        }
    }

    subscript(section: PlanSection) -> [PlanItem] {
        get { fields[section.rawValue]?.array?.compactMap { $0.object.map(PlanItem.init) } ?? [] }
        set { fields[section.rawValue] = .array(newValue.map { .object($0.fields) }) }
    }

    var unifiedCosts: Plan {
        guard !self[.annual].isEmpty else { return self }
        var result = self
        var expenses = self[.expenses]
        var used = Set(expenses.map(\.id))
        let reserved = Set(self[.annual].map(\.id))
        var suffix = 0
        for var entry in self[.annual] {
            if used.contains(entry.id) {
                var id: String
                repeat {
                    suffix += 1
                    id = "legacy-annual-\(suffix)"
                } while used.contains(id) || reserved.contains(id)
                entry.fields["id"] = .string(id)
            }
            used.insert(entry.id)
            entry.fields["frequency"] = .string("annual")
            if entry.fields.text("category").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                entry.fields["category"] = .string("Sonstige")
            }
            expenses.append(entry)
        }
        result[.expenses] = expenses
        result[.annual] = []
        return result
    }

    // Older servers accept 250 recurring entries plus 100 annual entries.
    var storagePlan: Plan {
        let expenses = self[.expenses]
        guard expenses.count > PlanSection.expenses.limit, self[.annual].isEmpty else { return self }
        let overflow = expenses.count - PlanSection.expenses.limit
        let annual = expenses.filter { $0.frequency == .annual }.suffix(overflow)
        let ids = Set(annual.map(\.id))
        var result = self
        result[.expenses] = expenses.filter { !ids.contains($0.id) }
        result[.annual] = Array(annual)
        return result
    }

    func entriesByDueDate(in section: PlanSection) -> [PlanItem] {
        let items = self[section]
        switch section {
        case .expenses, .annual, .income:
            func dueKey(_ item: PlanItem) -> (Int, Int) {
                let monthly = (section == .expenses && item.frequency == .monthly)
                    || (section == .income && !item.fields.flag("annual"))
                let month = monthly ? -1 : (item.fields.integer("month") ?? 12)
                let day = item.fields.integer("bookingDay") ?? 0
                return (month, day > 0 ? day : 32)
            }
            return items.sorted {
                if $0.frequency == .once && $1.frequency == .once {
                    return $0.fields.text("dueDate") < $1.fields.text("dueDate")
                }
                return dueKey($0) < dueKey($1)
            }
        case .loans:
            return items.sorted {
                let left = $0.fields.amount("balance"), right = $1.fields.amount("balance")
                return left == right ? $0.name.localizedStandardCompare($1.name) == .orderedAscending : left > right
            }
        case .history:
            return items.sorted { $0.fields.text("date") < $1.fields.text("date") }
        case .goals:
            return items.sorted {
                let first = $0.fields.text("targetDate"), second = $1.fields.text("targetDate")
                return !first.isEmpty && (second.isEmpty || first < second)
            }
        default: return items
        }
    }

    mutating func save(_ item: PlanItem, in section: PlanSection) {
        var items = self[section]
        if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item }
        else { items.append(item) }
        self[section] = items
    }

    mutating func recordCheckIn(accounts: [PlanItem], date: String, note: String) {
        let isToday = date == PlanDate.string(.now)
        let previous = self[.history].first { $0.fields.text("date") == date }
        let oldBalances = previous?.fields["balances"]?.object ?? [:]
        var balances = isToday ? [:] : oldBalances
        var net = accounts.reduce(0) { $0 + $1.netBalance }
        if !isToday, let previous {
            // Retain the contribution from accounts which have since been removed.
            net += PlanMetrics(plan: self).net(for: previous) - accounts.reduce(0) { total, account in
                total + oldBalances.amount(account.id) * (account.fields.text("type") == "credit" ? -1 : 1)
            }
        }
        if isToday { self[.accounts] = accounts }
        for account in accounts { balances[account.id] = .number(account.fields.amount("balance")) }
        var snapshot = previous ?? PlanItem(["id": .string(UUID().uuidString), "date": .string(date)])
        snapshot.fields["balances"] = .object(balances)
        snapshot.fields["netBalance"] = .number(net)
        snapshot.fields["note"] = .string(note)
        self[.history] = (self[.history].filter { $0.fields.text("date") != date } + [snapshot])
            .sorted { $0.fields.text("date") < $1.fields.text("date") }
    }
}

enum PlanStorageError: LocalizedError {
    case limit(PlanSection), tooLarge
    var errorDescription: String? {
        switch self {
        case .limit(let section): "Für „\(section.title)“ sind höchstens \(section.limit) Einträge möglich."
        case .tooLarge: "Der Finanzplan ist für den Cloud-Abgleich zu groß. Kürze Einträge oder exportiere und entferne ältere Check-ins."
        }
    }
}

enum ExpenseFrequency: String, CaseIterable {
    case monthly, quarterly, annual, once

    var sectionTitle: String {
        switch self {
        case .monthly: "Monatliche Kosten"
        case .quarterly: "Quartalsweise Kosten"
        case .annual: "Jährliche Kosten"
        case .once: "Einmalige Rechnungen"
        }
    }
    var months: Int {
        switch self { case .monthly: 1; case .quarterly: 3; case .annual: 12; case .once: 1 }
    }
    var label: String {
        switch self { case .monthly: "Monatlich"; case .quarterly: "Quartalsweise"; case .annual: "Jährlich"; case .once: "Einmalig" }
    }
    func isDue(in month: Int, anchor: Int) -> Bool {
        self != .once && (month - anchor).isMultiple(of: months)
    }
}

let standardExpenseCategories = ["Wohnen", "Versicherungen", "Mobilität", "Kommunikation", "Lebenshaltung", "Abos & Sonstiges", "Sonstige"]

struct PlanItem: Identifiable, Equatable {
    var fields: Record
    init(_ fields: Record) { self.fields = fields }
    var id: String { fields.text("id") }
    var name: String { fields.text("name") }
    var frequency: ExpenseFrequency { ExpenseFrequency(rawValue: fields.text("frequency")) ?? .monthly }
    func costCategory(default fallback: String) -> String {
        let cleaned = fields.text("category").filter { !"\u{00ad}\u{200b}\u{2060}\u{feff}".contains($0) }
        let label = cleaned.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if label.lowercased().replacingOccurrences(of: " ", with: "") == "unterhaltung" { return "Unterhaltung" }
        switch label.lowercased() {
        case "": return fallback
        case "versicherung", "versicherungen": return "Versicherungen"
        default: return label
        }
    }
    var expenseCategory: String { costCategory(default: "Sonstige") }
    var loanCategory: String { costCategory(default: "Kreditraten") }
    var bookingDayLabel: String? {
        guard let day = fields.integer("bookingDay"), day > 0 else { return nil }
        return "am \(day)."
    }
    var monthlyLoanPayment: Double {
        let instalment = max(0, fields.amount("payment") + fields.amount("extraPayment"))
        guard let balance = fields["balance"]?.number else { return instalment }
        let outstanding = max(0, balance) * (1 + max(0, fields.amount("interestRate")) / 1200)
        return min(instalment, (outstanding * 100).rounded() / 100)
    }
    var rates: [Record] { fields["rateChanges"]?.array?.compactMap(\.object) ?? [] }
    func expenseAmount(on date: Date = .now) -> Double {
        let changes = rates
        guard !changes.isEmpty else { return fields.amount("amount") }
        let stamp = PlanDate.string(date)
        return changes.filter { $0.text("date") <= stamp }.max { $0.text("date") < $1.text("date") }?.amount("amount") ?? fields.amount("amount")
    }
    func monthlyExpense(on date: Date) -> Double { frequency == .once ? 0 : expenseAmount(on: date) / Double(frequency.months) }
    var monthlyExpense: Double { monthlyExpense(on: .now) }
    func annualExpenseCents(on date: Date) -> Double {
        frequency == .once ? 0 : budgetCents(expenseAmount(on: date)) * Double(12 / frequency.months)
    }

    var netBalance: Double { fields.amount("balance") * (fields.text("type") == "credit" ? -1 : 1) }
    var savingValue: Double {
        if fields.text("kind") == "security" {
            return max(0, fields.amount("quantity")) * max(0, fields["priceEur"]?.number ?? fields.amount("price"))
        }
        return max(0, fields.amount("balance"))
    }

    func balanceAfter(months: Int) -> Double {
        let rate = max(0, fields.amount("interestRate")) / 1_200
        let payment = max(0, fields.amount("payment") + fields.amount("extraPayment"))
        let balance = fields.amount("balance")
        guard rate > 0 else { return max(0, balance - payment * Double(months)) }
        let growth = expm1(Double(months) * log1p(rate))
        return max(0, balance + (balance * rate - payment) * growth / rate)
    }

    func monthlyGoalNeed(today: Date = .now) -> Double? {
        guard let target = PlanDate.parse(fields.text("targetDate")) else { return nil }
        let open = max(0, fields.amount("target") - fields.amount("saved"))
        let calendar = Calendar.current
        let from = calendar.dateComponents([.year, .month, .day], from: today)
        let to = calendar.dateComponents([.year, .month, .day], from: target)
        let months = ((to.year ?? 0) - (from.year ?? 0)) * 12 + (to.month ?? 0) - (from.month ?? 0)
        return open / Double(max(1, months + ((to.day ?? 0) >= (from.day ?? 0) ? 1 : 0)))
    }
}

private extension Record {
    func hasText(_ key: String, _ limit: Int) -> Bool {
        self[key]?.string.map { $0.utf16.count <= limit } == true
    }
    func hasMoney(_ key: String) -> Bool {
        self[key]?.number.map { $0.isFinite && abs($0) <= 1_000_000_000 } == true
    }
    func optionalMoney(_ key: String) -> Bool { self[key] == nil || hasMoney(key) }
    func optionalText(_ key: String, _ limit: Int) -> Bool { self[key] == nil || hasText(key, limit) }
}

private extension PlanItem {
    func isRestorable(in section: PlanSection) -> Bool {
        let f = fields
        guard !id.isEmpty, f.hasText("id", 100), section == .history || f.hasText("name", 120) else { return false }
        let dayOK = f["bookingDay"] == nil || (0...31).contains(f.integer("bookingDay") ?? -1)
        let hasMonth = (0..<12).contains(f.integer("month") ?? -1)
        switch section {
        case .income:
            return dayOK && f.hasMoney("amount") && f["annual"]?.bool != nil && (f["month"] == nil || hasMonth)
        case .expenses:
            guard dayOK, f.hasMoney("amount"), f.hasText("category", 80),
                  f["frequency"] == nil || ExpenseFrequency(rawValue: f.text("frequency")) != nil else { return false }
            if let changes = f["rateChanges"] {
                guard frequency == .monthly, let array = changes.array, array.count <= 60, rates.count == array.count,
                      Set(rates.map { $0.text("date") }).count == rates.count,
                      rates.allSatisfy({ PlanDate.parse($0.text("date")) != nil && $0.hasMoney("amount") }) else { return false }
            }
            switch frequency {
            case .once: return PlanDate.parse(f.text("dueDate")) != nil && (f["paid"] == nil || f["paid"]?.bool != nil)
            case .monthly: return f["month"] == nil
            case .annual, .quarterly: return hasMonth
            }
        case .annual: return dayOK && f.hasMoney("amount") && hasMonth && f.optionalText("category", 80)
        case .loans:
            return dayOK && f.hasMoney("balance") && f.hasMoney("payment") && f.optionalText("category", 80)
                && f.optionalMoney("interestRate") && f.optionalMoney("extraPayment")
                && (f["termMonths"] == nil || (f.integer("termMonths") ?? -1) >= 0)
        case .goals:
            return f.hasMoney("target") && f.hasMoney("saved") && f.optionalMoney("monthly")
                && (f["targetDate"] == nil || f["targetDate"]?.string == "" || PlanDate.parse(f.text("targetDate")) != nil)
        case .savings:
            guard ["security", "cash", "dayMoney", "fixedDeposit", "buildingSavings", "other"].contains(f.text("kind")),
                  f.hasMoney("balance") else { return false }
            return f.text("kind") != "security" || (f.hasText("symbol", 30) && f.hasMoney("quantity")
                && f.hasMoney("priceEur") && f.hasMoney("price") && f.hasText("currency", 10)
                && f.optionalText("quoteVenue", 80) && f.optionalText("quoteUpdatedAt", 40))
        case .accounts:
            return dayOK && ["bank", "credit", "cash"].contains(f.text("type")) && f.hasMoney("balance")
                && f.optionalText("category", 80) && f.optionalMoney("monthlyPayment") && f.amount("monthlyPayment") >= 0
        case .history:
            guard let balances = f["balances"]?.object, balances.keys.allSatisfy({ balances.hasMoney($0) }) else { return false }
            return PlanDate.parse(f.text("date")) != nil && f.hasText("note", 500) && f.optionalMoney("netBalance")
        }
    }
}

enum PlanSection: String, CaseIterable, Identifiable {
    case accounts, income = "incomes", expenses, annual = "annualCosts", loans = "commitments", goals, savings, history = "snapshots"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .accounts: "Konten & Karten"
        case .income: "Einkommen"
        case .expenses: "Fixkosten"
        case .annual: "Jahreskosten"
        case .loans: "Kredite"
        case .goals: "Sparziele"
        case .savings: "Ersparnisse & Depot"
        case .history: "Verlauf"
        }
    }
    var itemTitle: String {
        switch self {
        case .accounts: "Konto"
        case .income: "Einnahme"
        case .expenses: "Fixkostenposten"
        case .annual: "Jahreskostenposten"
        case .loans: "Kredit"
        case .goals: "Sparziel"
        case .savings: "Sparanlage"
        case .history: "Check-in"
        }
    }

    var addTitle: String { "\(itemTitle) anlegen" }

    var emptyMessage: String {
        switch self {
        case .accounts: "Noch keine Konten"
        case .income: "Noch keine Einnahmen"
        case .expenses: "Noch keine Fixkosten"
        case .annual: "Noch keine Jahreskosten"
        case .loans: "Noch keine Kredite"
        case .goals: "Noch keine Sparziele"
        case .savings: "Noch keine Sparanlagen"
        case .history: "Noch keine Check-ins"
        }
    }

    var limit: Int {
        switch self {
        case .accounts: 30
        case .income: 50
        case .expenses: 250
        case .history: 500
        default: 100
        }
    }
    var newItem: PlanItem {
        var values: Record = ["id": .string(UUID().uuidString), "name": .string("")]
        switch self {
        case .accounts: values.merge(["name": .string("Girokonto"), "type": .string("bank"), "balance": .number(0)]) { _, new in new }
        case .income: values.merge(["name": .string("Nettoeinkommen"), "amount": .number(0), "annual": .boolean(false)]) { _, new in new }
        case .expenses: values.merge(["amount": .number(0), "category": .string("Wohnen"), "bookingDay": .number(0)]) { _, new in new }
        case .annual: values.merge(["amount": .number(0), "month": .number(0)]) { _, new in new }
        case .loans: values.merge(["balance": .number(0), "payment": .number(0)]) { _, new in new }
        case .goals: values.merge(["target": .number(0), "saved": .number(0), "monthly": .number(0)]) { _, new in new }
        case .savings: values.merge(["kind": .string("dayMoney"), "balance": .number(0)]) { _, new in new }
        case .history: break
        }
        return PlanItem(values)
    }
}

struct ForecastEntry: Identifiable {
    let section: PlanSection
    let item: PlanItem
    var id: String { section.rawValue + "." + item.id }
    let amount: Double
    let day: Int
    let monthUnknown: Bool
    var bookingDate: Date? = nil
}

struct MonthForecast {
    let balance: Double
    var rowsFromToday: [ForecastEntry] = []
    var scheduled: [ForecastEntry] = []
    var uncertain: [ForecastEntry] = []
    var datedBalance: Double { scheduled.reduce(balance) { $0 + $1.amount } }
    var low: Double { uncertain.reduce(datedBalance) { $0 + min(0, $1.amount) } }
    var high: Double { uncertain.reduce(datedBalance) { $0 + max(0, $1.amount) } }
}

struct PlanMetrics {
    let plan: Plan
    var today: Date = .now
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }
    var month: Int { calendar.component(.month, from: today) - 1 }
    var net: Double { plan[.accounts].reduce(0) { $0 + $1.netBalance } }
    var income: Double { plan[.income].filter { !$0.fields.flag("annual") }.sum("amount") }
    var incomeThisMonth: Double { income + annualIncome.sum("amount") }
    var incomePerYear: Double { income * 12 + plan[.income].filter { $0.fields.flag("annual") }.sum("amount") }
    var fixedCosts: Double {
        let loanCents = plan[.loans].reduce(0.0) { $0 + 12 * budgetCents($1.monthlyLoanPayment) }
        return plan[.expenses].reduce(loanCents) { $0 + $1.annualExpenseCents(on: today) } / 1200
    }
    var rankedCategories: [(name: String, amount: Double)] {
        var totals: [String: Double] = [:]
        var labels: [String: String] = [:]
        func add(_ category: String, amount: Double) {
            let label = category.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            let name = label.isEmpty ? "Sonstige" : label
            let key = name.lowercased()
            if labels[key] == nil { labels[key] = name }
            totals[key, default: 0] += amount
        }
        for item in plan[.expenses] where item.frequency != .once { add(item.expenseCategory, amount: item.annualExpenseCents(on: today)) }
        for loan in loansWithPayments { add(loan.loanCategory, amount: 12 * budgetCents(loan.monthlyLoanPayment)) }
        return totals.map { (name: labels[$0.key] ?? $0.key, amount: $0.value / 1200) }.sorted {
            if $0.amount != $1.amount { return $0.amount > $1.amount }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }
    var loansWithPayments: [PlanItem] {
        plan[.loans].filter { $0.monthlyLoanPayment > 0 }.sorted {
            if $0.monthlyLoanPayment != $1.monthlyLoanPayment { return $0.monthlyLoanPayment > $1.monthlyLoanPayment }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }
    var payments: Double { plan[.loans].reduce(0) { $0 + $1.monthlyLoanPayment } }
    var available: Double { income - fixedCosts }
    var annualIncome: [PlanItem] { plan[.income].filter { $0.fields.flag("annual") && $0.fields.integer("month") == month } }
    var specialCosts: [PlanItem] {
        plan.entriesByDueDate(in: .expenses).filter {
            if $0.frequency == .once {
                return !$0.fields.flag("paid") && $0.fields.text("dueDate").prefix(7) == PlanDate.string(today).prefix(7)
            }
            return $0.frequency != .monthly && $0.frequency.isDue(in: month, anchor: $0.fields.integer("month") ?? 0)
        }
    }
    // Card balances are already deducted in net. Settlement changes the two account balances together.
    var cardSettlements: [(account: PlanItem, date: Date?)] {
        let start = calendar.startOfDay(for: today)
        func nextDate(_ account: PlanItem) -> Date? {
            guard let day = account.fields.integer("bookingDay"), (1...31).contains(day),
                  let month = calendar.dateInterval(of: .month, for: start) else { return nil }
            for first in [month.start, month.end] {
                let last = calendar.range(of: .day, in: .month, for: first)?.count ?? 31
                if let date = calendar.date(byAdding: .day, value: min(day, last) - 1, to: first), date >= start { return date }
            }
            return nil
        }
        return plan[.accounts].filter { $0.fields.text("type") == "credit" && $0.fields.amount("balance") > 0 }
            .map { (account: $0, date: nextDate($0)) }
            .sorted {
                let first = $0.date ?? .distantFuture, second = $1.date ?? .distantFuture
                return first == second ? $0.account.name.localizedStandardCompare($1.account.name) == .orderedAscending : first < second
            }
    }
    var forecast: MonthForecast {
        let start = calendar.startOfDay(for: today)
        let day = calendar.component(.day, from: start)
        let lastDay = calendar.range(of: .day, in: .month, for: today)?.count ?? 31
        var result = MonthForecast(balance: net)
        func include(_ item: PlanItem, section: PlanSection, amount: Double, monthUnknown: Bool = false) {
            guard amount != 0 else { return }
            let due = min(lastDay, item.fields.integer("bookingDay") ?? 0)
            if due > 0 && due < day { return }
            let entry = ForecastEntry(section: section, item: item, amount: amount,
                                      day: due, monthUnknown: monthUnknown,
                                      bookingDate: due > 0 ? calendar.date(byAdding: .day, value: due - day, to: start) : nil)
            if due > day && !monthUnknown { result.scheduled.append(entry) }
            else { result.uncertain.append(entry) }
        }
        for item in plan[.income] {
            let annual = item.fields.flag("annual")
            let dueMonth = item.fields.integer("month")
            if annual, let dueMonth, dueMonth != month { continue }
            include(item, section: .income, amount: item.fields.amount("amount"), monthUnknown: annual && dueMonth == nil)
        }
        for item in plan[.expenses] {
            if item.frequency == .once {
                guard !item.fields.flag("paid"), item.fields.amount("amount") != 0,
                      let due = PlanDate.parse(item.fields.text("dueDate")) else { continue }
                let entry = ForecastEntry(section: .expenses, item: item, amount: -item.fields.amount("amount"),
                    day: calendar.component(.day, from: due), monthUnknown: false, bookingDate: due)
                if calendar.startOfDay(for: due) <= start { result.uncertain.append(entry) }
                else if calendar.isDate(due, equalTo: start, toGranularity: .month) { result.scheduled.append(entry) }
            } else if item.frequency.isDue(in: month, anchor: item.fields.integer("month") ?? 0) {
                let bookedDay = min(lastDay, item.fields.integer("bookingDay") ?? 0)
                let date = bookedDay > 0 ? calendar.date(byAdding: .day, value: bookedDay - day, to: start) ?? start : start
                include(item, section: .expenses, amount: -item.expenseAmount(on: date))
            }
        }
        for loan in loansWithPayments { include(loan, section: .loans, amount: -loan.monthlyLoanPayment) }
        let transfers = cardSettlements.map { card in
            ForecastEntry(section: .accounts, item: card.account, amount: -card.account.fields.amount("balance"),
                          day: card.date.map { calendar.component(.day, from: $0) } ?? 0,
                          monthUnknown: false, bookingDate: card.date)
        }
        result.rowsFromToday = (result.scheduled + transfers).sorted {
            ($0.bookingDate ?? .distantFuture) < ($1.bookingDate ?? .distantFuture)
        }
        return result
    }

    func net(for snapshot: PlanItem) -> Double {
        if let value = snapshot.fields["netBalance"]?.number { return value }
        let balances = snapshot.fields["balances"]?.object ?? [:]
        return plan[.accounts].reduce(0) { total, account in
            total + balances.amount(account.id) * (account.fields.text("type") == "credit" ? -1 : 1)
        }
    }
}

extension Array where Element == PlanItem {
    func sum(_ key: String) -> Double { reduce(0) { $0 + $1.fields.amount(key) } }
}

enum PlanDate {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func parse(_ value: String) -> Date? {
        guard value.utf8.count == 10 else { return nil }
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        return date
    }
    static func parseTradeTime(_ value: String) -> Date? {
        (try? Date(value, strategy: .iso8601))
            ?? (try? Date(value, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
    }
}

func euros(_ amount: Double) -> String {
    amount.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")).rounded(rule: .toNearestOrAwayFromZero))
}

// Preserve imported sub-cent amounts, but remove binary noise from whole cents.
private func budgetCents(_ amount: Double) -> Double {
    let value = amount * 100, nearest = value.rounded()
    return abs(value - nearest) <= abs(value) * Double.ulpOfOne * 4 ? nearest : value
}

// During editing, a sign or an unfinished thousands group can still become a number.
func acceptsAmountEdit(_ value: String, signed: Bool) -> Bool {
    if !signed && value.hasPrefix("-") { return false }
    return value.range(of: #"\A[+-]?(?:[0-9]*(?:[,.][0-9]*)?|[1-9][0-9]{0,2}(?:\.[0-9]{3})+(?:\.[0-9]{0,3}|,[0-9]*)?)\z"#,
                       options: .regularExpression) != nil
}

func germanAmount(_ value: String) -> Double? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return 0 }
    // In the German interface, pasted values such as 40.000 and 40.000,50
    // use grouping. Still accept a decimal point from a hardware keyboard.
    let grouped = trimmed.range(of: #"^[+-]?[1-9][0-9]{0,2}(?:\.[0-9]{3})+(?:,[0-9]+)?$"#,
                                options: .regularExpression) != nil
    let digits = grouped ? trimmed.replacingOccurrences(of: ".", with: "") : trimmed
    guard digits.range(of: #"^[+-]?(?:[0-9]+(?:[,.][0-9]*)?|[,.][0-9]+)$"#,
                       options: .regularExpression) != nil else { return nil }
    let normalized = digits.replacingOccurrences(of: ",", with: ".")
    guard let amount = Double(normalized), amount.isFinite, abs(amount) <= 1_000_000_000 else { return nil }
    return amount
}

#if DEBUG
extension Plan {
    static var demo: Plan {
        var plan = Plan.blank(name: "Alex")
        func item(_ name: String, _ values: Record) -> PlanItem {
            var fields = values
            fields["id"] = .string(UUID().uuidString)
            fields["name"] = .string(name)
            return PlanItem(fields)
        }
        plan[.accounts] = [
            item("Girokonto", ["type": .string("bank"), "balance": .number(3850)]),
            item("Kreditkarte", ["type": .string("credit"), "balance": .number(620)])
        ]
        plan[.income] = [item("Nettoeinkommen", ["amount": .number(4200), "annual": .boolean(false)])]
        plan[.expenses] = [
            item("Wohnen", ["amount": .number(1250), "category": .string("Wohnen")]),
            item("Lebenshaltung", ["amount": .number(620), "category": .string("Lebenshaltung")]),
            item("Abos & Sonstiges", ["amount": .number(430), "category": .string("Abos & Sonstiges")])
        ]
        plan[.annual] = [item("Versicherungen", ["amount": .number(720), "month": .number(2)])]
        plan[.loans] = [item("Autofinanzierung", ["balance": .number(7800), "payment": .number(240)])]
        plan[.goals] = [item("Notgroschen", ["target": .number(12000), "saved": .number(8400), "monthly": .number(300)])]
        plan[.history] = [2860.0, 3110.0, 3020.0, 3230.0].enumerated().compactMap { index, amount in
            guard let date = Calendar.current.date(byAdding: .day, value: (index - 3) * 7, to: .now) else { return nil }
            return item("", ["date": .string(PlanDate.string(date)), "balances": .object([:]),
                             "note": .string(""), "netBalance": .number(amount)])
        }
        return plan.unifiedCosts
    }
}
#endif
