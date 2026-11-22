// Compile with NjoraStore.swift, NjoraAPI.swift, NjoraLocalPlan.swift, Plan.swift and WidgetSnapshot.swift.
import Foundation

private struct TestFailure: Error { let reason: String }
private func check(_ value: Bool, _ reason: String) throws {
    if !value { throw TestFailure(reason: reason) }
}

private final class AccountTransport: URLProtocol, @unchecked Sendable {
    struct Server {
        var online = true
        var plan = Plan.blank(name: "Testplan")
        var revision = 1
        var loseNextReply = false
        var writes = 0
        var active = true
        var hasPlan = true
        var accountCreatedAt = "2025-01-01T00:00:00.000Z"
    }
    private static let lock = NSLock()
    private static var server = Server()
    static func change<T>(_ action: (inout Server) throws -> T) rethrows -> T {
        try lock.withLock { try action(&server) }
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        do {
            let (status, json): (Int, Data) = try Self.change { server in
                guard server.online else { throw URLError(.notConnectedToInternet) }
                guard request.url?.path == "/api/account" else { throw TestFailure(reason: "Unexpected route") }
                if request.httpMethod == "PUT" {
                    struct Write: Decodable { let revision: Int; let plan: Plan }
                    var body = request.httpBody ?? Data()
                    if let stream = request.httpBodyStream {
                        stream.open()
                        defer { stream.close() }
                        var buffer = [UInt8](repeating: 0, count: 4096)
                        while true {
                            let n = stream.read(&buffer, maxLength: buffer.count)
                            guard n > 0 else { break }
                            body.append(contentsOf: buffer.prefix(n))
                        }
                    }
                    let write = try JSONDecoder().decode(Write.self, from: body)
                    guard write.revision == server.revision else { return (409, Data("{}".utf8)) }
                    server.plan = write.plan
                    server.revision += 1
                    server.writes += 1
                    if server.loseNextReply {
                        server.loseNextReply = false
                        server.online = false
                        throw URLError(.networkConnectionLost)
                    }
                    return (200, try JSONSerialization.data(withJSONObject: ["revision": server.revision]))
                }
                let plan = try JSONSerialization.jsonObject(with: JSONEncoder().encode(server.plan))
                return (200, try JSONSerialization.data(withJSONObject: ["authenticated": true,
                    "billing": ["active": server.active, "accountToken": "BB000000-AAAA-CCCC-BBBB-000000000001"],
                    "user": ["email": "test@example.invalid", "displayName": "Test", "accountCreatedAt": server.accountCreatedAt],
                    "plan": server.hasPlan ? plan : NSNull(), "revision": server.hasPlan ? server.revision as Any : NSNull()]))
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: json)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
}

@main
private enum OfflinePlanTests {
    @MainActor static func main() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let disk = LocalPlanDisk(directory: folder)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AccountTransport.self]
        let api = NjoraAPI(configuration: config, token: "test-only-session")
        func makeStore() -> NjoraStore { NjoraStore(api: api, disk: disk, publishWidget: { _ in }) }
        var store: NjoraStore? = makeStore()
        await store!.restore()
        try check(store!.state == .ready, "First online load")
        AccountTransport.change { $0.online = false }
        try check(!(await store!.refresh()), "Offline read must not report a successful refresh on a clean plan")
        var changed = store!.plan!
        changed.fields["name"] = .string("Offline")
        try check(await store!.save(changed), "Offline edit acknowledged")
        changed.fields["liquidity"] = .number(420)
        try check(await store!.save(changed), "Second offline edit")
        _ = await store!.refresh()
        try check(store!.needsSync, "Persistent outbox")
        store = nil
        var widgetPlan: Plan?
        var removedReminder = false
        let reopened = NjoraStore(api: api, disk: disk, clearAccountReminder: { removedReminder = true }, publishWidget: { widgetPlan = $0 })
        await reopened.restore()
        try check(reopened.state == .ready && reopened.plan == changed, "Offline restart")
        _ = await reopened.refresh()
        let unauthorized = NjoraStore(api: NjoraAPI(configuration: config, token: "different-session"), disk: disk,
                                      publishWidget: { _ in })
        await unauthorized.restore()
        try check(unauthorized.plan == nil, "Unrelated session cannot read this account offline")
        AccountTransport.change {
            $0.online = true
            $0.plan.fields["checkInCadence"] = .string("daily")
            $0.revision += 1
            $0.loseNextReply = true
        }
        _ = await reopened.refresh()
        try check(reopened.needsSync && AccountTransport.change { $0.writes } == 1, "Lost acknowledgement")
        var next = reopened.plan!
        next.fields["name"] = .string("After acknowledgement loss")
        try check(await reopened.save(next), "Another edit after lost reply")
        AccountTransport.change { $0.online = true }
        _ = await reopened.refresh()
        _ = await reopened.refresh()
        try check(!reopened.needsSync && reopened.plan == AccountTransport.change { $0.plan }, "Converged")
        try check(reopened.plan?.cadence == "daily" && AccountTransport.change { $0.writes } == 2, "No duplicate writes")

        AccountTransport.change { $0.online = false }
        var conflict = reopened.plan!
        conflict.fields["name"] = .string("On device")
        try check(await reopened.save(conflict), "Local conflicting edit")
        _ = await reopened.refresh()
        AccountTransport.change {
            $0.plan.fields["name"] = .string("In cloud")
            $0.plan.fields["liquidity"] = .number(840)
            $0.revision += 1
            $0.online = true
        }
        _ = await reopened.refresh()
        try check(reopened.conflict && reopened.plan?.name == "On device", "Conflict retained")
        reopened.resolve(.device)
        _ = await reopened.refresh()
        try check(!reopened.needsSync && reopened.plan?.name == "On device" && reopened.plan?.fields.amount("liquidity") == 840,
                  "Explicit choice preserves independent edits")
        let file = disk.file("test@example.invalid")
        let diskPlan = try disk.load(from: file)
        try check(diskPlan?.local == reopened.plan && diskPlan?.pending == false, "Acknowledged state persisted")
        let existing = reopened.plan!
        let moved = folder.appendingPathExtension("saved")
        try FileManager.default.moveItem(at: folder, to: moved)
        try Data().write(to: folder)
        var unsaved = existing
        unsaved.fields["name"] = .string("Disk write must fail")
        try check(!(await reopened.save(unsaved)) && reopened.plan == existing, "No false acknowledgement on storage failure")
        try FileManager.default.removeItem(at: folder)
        try FileManager.default.moveItem(at: moved, to: folder)

        AccountTransport.change { $0.online = false }
        var automatic = existing
        automatic.fields["name"] = .string("Automatic retry")
        try check(await reopened.save(automatic), "Local save before reconnect")
        _ = await reopened.refresh()
        AccountTransport.change { $0.online = true }
        for _ in 0..<100 where reopened.needsSync { try await Task.sleep(nanoseconds: 100_000_000) }
        try check(!reopened.needsSync && AccountTransport.change { $0.plan } == automatic, "Automatic retry")

        let profileBaseline = reopened.plan!
        var cloudProfile = profileBaseline
        cloudProfile.fields["name"] = .string("Cloud name")
        AccountTransport.change { $0.plan = cloudProfile; $0.revision += 1 }
        try check(await reopened.refresh(), "Online refresh")
        var form = profileBaseline
        form.fields["checkInCadence"] = .string("weekly")
        try check(await reopened.save(form, basedOn: profileBaseline), "Open profile saves independent changes")
        try check(await reopened.refresh() && reopened.plan?.name == "Cloud name", "Cloud name preserved")
        AccountTransport.change { $0.active = false }
        try check(await reopened.refresh() && reopened.state == .subscription && widgetPlan == nil, "Expired entitlement clears widget")
        AccountTransport.change { $0.active = true }
        try check(await reopened.refresh() && reopened.state == .ready && widgetPlan == reopened.plan, "Renewed entitlement restores widget")

        var baseline = Plan.blank(name: "Merge")
        let first = PlanItem(["id": .string("a"), "name": .string("Rent"), "amount": .number(100)])
        let second = PlanItem(["id": .string("b"), "name": .string("Gas"), "amount": .number(20)])
        baseline[.expenses] = [first, second]
        var device = baseline
        device[.expenses] = [first]
        var cloud = baseline
        var revised = first
        revised.fields["amount"] = .number(200)
        cloud.save(revised, in: .expenses)
        var record = LocalFinancePlan(user: diskPlan!.user, revision: 1, base: baseline, local: device)
        try record.reconcile(cloud, revision: 2)
        try check(record.local?[.expenses] == [revised], "Deletion and independent update")
        record.base = baseline
        record.local = device
        var edited = second
        edited.fields["amount"] = .number(40)
        cloud.save(edited, in: .expenses)
        do {
            try record.reconcile(cloud, revision: 3)
            throw TestFailure(reason: "Edit versus deletion should conflict")
        } catch is PlanConflict {}
        try record.reconcile(cloud, revision: 3, prefer: .cloud)
        try check(record.local?[.expenses] == [revised, edited], "Explicit cloud choice")
        record.base = baseline
        record.sending = cloud
        record.local = baseline
        var remoteAfterWrite = cloud
        remoteAfterWrite.fields["checkInCadence"] = .string("daily")
        try record.reconcile(remoteAfterWrite, revision: 5)
        try check(record.local?[.expenses] == baseline[.expenses] && record.local?.cadence == "daily",
                  "An offline undo survives a lost acknowledgement followed by a remote edit")
        var oldPlan = Plan.blank(name: "Backup")
        oldPlan.fields.removeValue(forKey: PlanSection.savings.rawValue)
        let oldBackup = try Plan.decodeBackup(JSONEncoder().encode(oldPlan))
        try check(oldBackup[.savings].isEmpty, "Backup predating portfolios is accepted")
        let formatted = Data(repeating: 32, count: 500_000) + (try JSONEncoder().encode(oldPlan))
        let imported = try Plan.decodeBackup(formatted)
        try check(imported.name == oldPlan.name, "Legacy formatted backup near the cloud size limit")
        var oversized = oldBackup
        oversized.fields["futureField"] = .string(String(repeating: "x", count: 500_000))
        let beforeOversizedEdit = reopened.plan
        try check(!(await reopened.save(oversized)) && reopened.plan == beforeOversizedEdit,
                  "Local plan remains usable after exceeding cloud capacity")
        var badBackup = oldBackup
        badBackup[.accounts][0].fields["balance"] = .string("unlesbar")
        for broken in [Plan(fields: ["name": .string("unvollständig")]), badBackup] {
            do {
                _ = try Plan.decodeBackup(JSONEncoder().encode(broken))
                throw TestFailure(reason: "Invalid local replacement must be blocked")
            } catch CocoaError.fileReadCorruptFile { }
        }
        var badSchedule = oldBackup
        var bill = PlanSection.expenses.newItem
        bill.fields["frequency"] = .string("once")
        bill.fields["dueDate"] = .string("2026-02-30")
        badSchedule[.expenses] = [bill]
        do {
            _ = try Plan.decodeBackup(JSONEncoder().encode(badSchedule))
            throw TestFailure(reason: "An invalid invoice due date must be rejected")
        } catch CocoaError.fileReadCorruptFile { }

        var archive = oldBackup
        let accountID = archive[.accounts][0].id
        archive[.history] = [PlanItem(["id": .string("keep"), "date": .string("2021-06-01"),
                "note": .string("Original"), "netBalance": .number(130),
                "balances": .object([accountID: .number(100), "removed": .number(30)])])]
        var historicAccounts = archive[.accounts]
        historicAccounts[0].fields["balance"] = .number(110)
        archive.recordCheckIn(accounts: historicAccounts, date: "2021-06-01", note: "Korrektur")
        let revision = archive[.history][0]
        try check(revision.id == "keep" && revision.fields.amount("netBalance") == 140
                  && revision.fields["balances"]?.object?.amount("removed") == 30
                  && archive[.accounts][0].fields.amount("balance") == 0, "Historic edit retains account and snapshot identities")
        try check(PlanItem(["category": .string("Unter\u{ad}haltung")]).expenseCategory == "Unterhaltung",
                  "Imported soft hyphens do not split categories")
        try check(euros(0.06 / 12).contains("0,01") && euros(-0.06 / 12).contains("-0,01")
                  && euros(2_000 - 0.06 / 12).contains("2.000,00"), "Half-cent averages match web currency formatting")
        var zeroInvoice = Plan.blank(name: "Zero")
        zeroInvoice[.expenses] = [PlanItem(["id":.string("zero"),"name":.string("Invoice"),"frequency":.string("once"),
                                           "amount":.number(0),"dueDate":.string("2028-02-29")])]
        for day in ["2028-02-28","2028-02-29","2028-03-01"] {
            let forecast = PlanMetrics(plan: zeroInvoice, today: PlanDate.parse(day)!).forecast
            try check(forecast.rowsFromToday.isEmpty && forecast.uncertain.isEmpty, "Zero invoice never creates forecast rows")
        }
        AccountTransport.change { $0.online = false }
        var formerPlan = reopened.plan!
        formerPlan.fields["name"] = .string("Draft from the deleted account")
        try check(await reopened.save(formerPlan), "Queue draft from old lifetime")
        _ = await reopened.refresh()
        let beforeReplacement = AccountTransport.change { $0.writes }
        AccountTransport.change {
            $0.online = true
            $0.accountCreatedAt = "2026-01-01T00:00:00.000Z"
            $0.hasPlan = false
        }
        try check(await reopened.refresh(), "Read the new account lifetime")
        try check(reopened.state == .setup && reopened.plan == nil && !reopened.needsSync && widgetPlan == nil
                  && removedReminder && AccountTransport.change { $0.writes } == beforeReplacement, "No stale financial data enters a recreated account")
        let legacy = AccountPayload.User(displayName: "Test", email: "test@example.invalid")
        let empty = AccountPayload(billing: nil, authenticated: true, user: legacy, plan: nil, revision: nil)
        let unsent = LocalFinancePlan(user: legacy, revision: nil, base: nil, local: formerPlan)
        try check(unsent.belongsToAccount(in: empty), "Preserve legitimate first offline plan")
        let old = LocalFinancePlan(user: legacy, revision: 4, base: formerPlan, local: formerPlan)
        try check(!old.belongsToAccount(in: empty), "Legacy previously synchronized record cannot populate a fresh account")
        let oldUser = AccountPayload.User(displayName: "Test", email: legacy.email, accountCreatedAt: "2025-01-01T00:00:00.000Z")
        let abandoned = LocalFinancePlan(user: oldUser, revision: 5, base: oldBackup, local: formerPlan)
        try disk.write(abandoned, to: disk.file(legacy.email))
        let newlyCreated = Plan.blank(name: "New account")
        AccountTransport.change { $0.hasPlan = true; $0.plan = newlyCreated; $0.revision = 1 }
        let fresh = NjoraStore(api: NjoraAPI(configuration: config, token: "new-recreated-login"), disk: disk,
                               clearAccountReminder: {}, publishWidget: { widgetPlan = $0 })
        await fresh.restore()
        try check(fresh.plan == newlyCreated && widgetPlan == newlyCreated && !fresh.needsSync,
                  "A newly authenticated account never reuses the deleted account's pending draft")
        print("PASS: same-address account recreation clears pending plan, widget and cloud outbox")
        print("PASS: backup schema, invalid dates, historic balances and category normalization")
        print("PASS: local write failure, automatic retry, concurrent deletion and cloud choice")
        print("PASS: offline edits, offline restart, session isolation, lost acknowledgement, revision merge and conflict resolution")
    }
}
