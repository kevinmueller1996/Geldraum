import CryptoKit
import Foundation

struct LocalFinancePlan: Codable, Equatable {
    var otherWorkspaceName: String? = nil
    var user: AccountPayload.User
    var billing: BillingStatus?
    var revision: Int?
    var base: Plan?
    var local: Plan?
    // Preserve the in-flight snapshot across a crash or a lost acknowledgement.
    var sending: Plan?
    var pending: Bool { local != base || sending != nil }

    static func cloud(_ reply: AccountPayload) -> Self {
        let plan = reply.plan?.unifiedCosts
        return Self(otherWorkspaceName: reply.otherWorkspaceName, user: reply.user, billing: reply.billing, revision: reply.revision, base: plan, local: plan)
    }

    func belongsToAccount(in reply: AccountPayload) -> Bool {
        if let cached = user.accountCreatedAt, let current = reply.user.accountCreatedAt {
            return cached == current
        }
        // The API only clears a stored plan/revision when an account is deleted.
        // A legacy offline first plan has neither and is still eligible for upload.
        return !(base != nil && revision != nil && reply.plan == nil && reply.revision == nil)
    }

    mutating func applyIdentity(_ reply: AccountPayload) {
        let createdAt = reply.user.accountCreatedAt ?? user.accountCreatedAt
        otherWorkspaceName = reply.otherWorkspaceName
        user = reply.user
        user.accountCreatedAt = createdAt
        billing = reply.billing
    }

    mutating func reconcile(_ remote: Plan?, revision next: Int?, prefer: MergePreference? = nil) throws {
        let server = remote?.unifiedCosts
        let baseline = base.map { JSONValue.object($0.fields) }
        let draft = local.map { JSONValue.object($0.fields) }
        let cloud = server.map { JSONValue.object($0.fields) }
        let merged: JSONValue?
        if let sending, draft != cloud {
            // A later edit may even undo a value from the unacknowledged PUT.
            // Replay that edit against the reconciled outgoing snapshot.
            let outgoing = JSONValue.object(sending.fields)
            let first = try mergePlanValue(baseline, outgoing, cloud, prefer)
            merged = try mergePlanValue(outgoing, draft, first, prefer)
        } else {
            merged = try mergePlanValue(baseline, draft, cloud, prefer)
        }
        local = merged?.object.map(Plan.init(fields:))
        base = server
        revision = next
        sending = nil
    }
}

enum MergePreference { case device, cloud }
struct PlanConflict: Error {}

private func mergePlanValue(_ base: JSONValue?, _ local: JSONValue?, _ remote: JSONValue?,
                            _ prefer: MergePreference?, arrayKey: String = "id") throws -> JSONValue? {
    if local == remote || remote == base { return local }
    if local == base { return remote }
    if arrayKey != "vatRecord", let b = base?.object, let l = local?.object, let r = remote?.object {
        var result = Record()
        for key in Set(l.keys).union(r.keys) {
            var original = (key == "monthlyRevenue" || key == "monthlyRevenueVAT") && b[key] == nil && l[key]?.object != nil && r[key]?.object != nil ? .object([:]) : b[key]
            if key == "flexibleCosts", original == nil, l[key]?.array != nil, r[key]?.array != nil { original = .array([]) }
            let childKey = key == "monthlyRevenueVAT" ? "vatMonths" : arrayKey == "vatMonths" ? "vatRecord" : key == PlanSection.history.rawValue ? "date" : "id"
            result[key] = try mergePlanValue(original, l[key], r[key], prefer, arrayKey: childKey)
        }
        return .object(result)
    }
    if let b = base?.array, let l = local?.array, let r = remote?.array {
        func index(_ items: [JSONValue]) -> [String: JSONValue]? {
            var result = [String: JSONValue]()
            for item in items {
                guard let id = item.object?[arrayKey]?.string, result[id] == nil else { return nil }
                result[id] = item
            }
            return result
        }
        if let before = index(b), let device = index(l), let cloud = index(r) {
            let order = r + l.filter { item in item.object?[arrayKey]?.string.map { cloud[$0] == nil } ?? false }
            return .array(try order.compactMap { item in
                let id = item.object!.text(arrayKey)
                return try mergePlanValue(before[id], device[id], cloud[id], prefer)
            })
        }
    }
    guard let prefer else { throw PlanConflict() }
    return prefer == .device ? local : remote
}

struct LocalPlanDisk {
    let directory: URL
    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OfflinePlans", isDirectory: true)
    }
    static func key(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    func file(_ email: String, workspace: FinanceWorkspace = .personal) -> URL {
        let owner = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return directory.appendingPathComponent(Self.key(workspace == .personal ? owner : "business\0" + owner))
    }
    func load(from file: URL) throws -> LocalFinancePlan? {
        do {
            var record = try JSONDecoder().decode(LocalFinancePlan.self, from: Data(contentsOf: file))
            record.base = record.base?.unifiedCosts
            record.local = record.local?.unifiedCosts
            record.sending = record.sending?.unifiedCosts
            return record
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
    func write(_ record: LocalFinancePlan, to file: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                               attributes: [.protectionKey: FileProtectionType.complete])
        var dir = directory
        var options = URLResourceValues()
        options.isExcludedFromBackup = true
        try dir.setResourceValues(options)
        try JSONEncoder().encode(record).write(to: file, options: [.atomic, .completeFileProtection])
    }
    func bind(_ file: URL, session: String) throws {
        try Data(file.lastPathComponent.utf8).write(to: directory.appendingPathComponent("session-" + session),
                                                  options: [.atomic, .completeFileProtection])
    }
    func boundFile(session: String) throws -> URL? {
        do {
            let key = try String(contentsOf: directory.appendingPathComponent("session-" + session), encoding: .utf8)
            guard key.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw CocoaError(.fileReadCorruptFile) }
            return directory.appendingPathComponent(key)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
    func unbind(session: String) throws {
        do { try FileManager.default.removeItem(at: directory.appendingPathComponent("session-" + session)) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { }
    }
}
