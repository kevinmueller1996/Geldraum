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
        try value.encode(fields)
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

    static func decodeBackup(_ data: Data) throws -> Plan {
        let decoded = try JSONDecoder().decode(Plan.self, from: data)
        guard let name = decoded.fields["name"]?.string, name.utf16.count <= 80 else {
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
                  items.allSatisfy({ $0.object != nil }) else {
                throw CocoaError(.fileReadCorruptFile)
            }
        }
        plan[.savings] = plan[.savings].map { item in
            var saving = item
            if saving.fields["balance"] == nil { saving.fields["balance"] = .number(0) }
            if saving.fields.text("kind") == "security" {
                saving.fields["symbol"] = .string(saving.fields.text("symbol").uppercased())
                if saving.fields["quantity"] == nil { saving.fields["quantity"] = .number(0) }
                if saving.fields["price"] == nil { saving.fields["price"] = .number(0) }
                if saving.fields["priceEur"] == nil { saving.fields["priceEur"] = .number(saving.fields.amount("price")) }
                if saving.fields["currency"] == nil { saving.fields["currency"] = .string("EUR") }
            }
            return saving
        }
        return plan
    }

    subscript(section: PlanSection) -> [PlanItem] {
        get { fields[section.rawValue]?.array?.compactMap { $0.object.map(PlanItem.init) } ?? [] }
        set { fields[section.rawValue] = .array(newValue.map { .object($0.fields) }) }
    }

    mutating func save(_ item: PlanItem, in section: PlanSection) {
        var items = self[section]
        if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item }
        else { items.append(item) }
        self[section] = items
    }

    mutating func recordCheckIn(accounts: [PlanItem], date: String, note: String) {
        self[.accounts] = accounts
        var balances: Record = [:]
        for account in accounts { balances[account.id] = .number(account.fields.amount("balance")) }
        let snapshot = PlanItem([
            "id": .string(UUID().uuidString), "date": .string(date), "balances": .object(balances),
            "netBalance": .number(accounts.reduce(0) { $0 + $1.netBalance }), "note": .string(note)
        ])
        self[.history] = (self[.history].filter { $0.fields.text("date") != date } + [snapshot])
            .sorted { $0.fields.text("date") < $1.fields.text("date") }
    }
}

struct PlanItem: Identifiable, Equatable {
    var fields: Record
    init(_ fields: Record) { self.fields = fields }
    var id: String { fields.text("id") }
    var name: String { fields.text("name") }
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
        guard payment > 0 else { return balance }
        guard rate > 0 else { return max(0, balance - payment * Double(months)) }
        let factor = pow(1 + rate, Double(months))
        return max(0, balance * factor - payment * ((factor - 1) / rate))
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

struct PlanMetrics {
    let plan: Plan
    var today: Date = .now
    private var calendar: Calendar { .current }
    var month: Int { calendar.component(.month, from: today) - 1 }
    var net: Double { plan[.accounts].reduce(0) { $0 + $1.netBalance } }
    var income: Double { plan[.income].filter { !$0.fields.flag("annual") }.sum("amount") }
    var expenses: Double { plan[.expenses].sum("amount") }
    var reserve: Double { plan[.annual].sum("amount") / 12 }
    var payments: Double { plan[.loans].sum("payment") + plan[.loans].sum("extraPayment") }
    var available: Double { income - expenses - reserve - payments }
    var annualIncome: [PlanItem] { plan[.income].filter { $0.fields.flag("annual") && $0.fields.integer("month") == month } }
    var annualCosts: [PlanItem] { plan[.annual].filter { $0.fields.integer("month") == month } }
    var forecast: Double {
        let day = calendar.component(.day, from: today)
        let days = calendar.range(of: .day, in: .month, for: today)?.count ?? 30
        let share = Double(max(0, days - day)) / Double(days)
        let remainingExpenses = plan[.expenses].reduce(0.0) { sum, item in
            let booking = item.fields.integer("bookingDay") ?? 0
            let fraction = booking == 0 ? share : (booking > day ? 1.0 : 0.0)
            return sum + item.fields.amount("amount") * fraction
        }
        return net + (income + annualIncome.sum("amount") - payments - annualCosts.sum("amount")) * share - remainingExpenses
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
    private static func formatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
    static func string(_ date: Date) -> String { formatter().string(from: date) }
    static func parse(_ value: String) -> Date? { formatter().date(from: value) }
}

func euros(_ amount: Double) -> String {
    amount.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")))
}

func germanAmount(_ value: String) -> Double? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return 0 }
    let normalized = trimmed.contains(",") ? trimmed.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".") : trimmed
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
        return plan
    }
}
#endif
