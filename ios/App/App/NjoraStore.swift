import Network
import StoreKit
import SwiftUI
import UserNotifications
import WidgetKit

@MainActor
final class NjoraStore: ObservableObject {
    enum State {
        case loading, signedOut, setup, ready, offline, subscription
        #if DEBUG
        case preview
        #endif
    }
    @Published private(set) var state: State = .loading
    @Published private(set) var plan: Plan? {
        didSet { updateWidget() }
    }
    @Published private(set) var user: AccountPayload.User?
    @Published private(set) var accountLifetime = UUID()
    @Published private(set) var busy = false
    enum NoticeScope: Hashable {
        case account, overview, month, section(PlanSection), editor, settings
    }
    @Published private var notices: [NoticeScope: String] = [:]
    var message: String {
        get { notice(in: .account) }
        set { notices[.account] = newValue }
    }
    func notice(in scope: NoticeScope) -> String { notices[scope] ?? "" }
    func clearNotice(in scope: NoticeScope) { notices[scope] = nil }
    @Published private(set) var billing: BillingStatus?
    @Published private(set) var conflict = false
    var needsSync: Bool { local?.pending == true }
    private var widgetDay: Date?
    private func updateWidget() {
        let visible = billing?.active == false ? nil : plan
        publishWidget(visible)
        widgetDay = visible == nil ? nil : Date()
    }
    func becameActive() {
        if state == .offline {
            Task { await restore() }
            return
        }
        if let widgetDay, !Calendar.current.isDateInToday(widgetDay) { updateWidget() }
        requestSync()
    }
    private let publishWidget: (Plan?) -> Void
    private let clearAccountReminder: () -> Void
    private let api: NjoraAPI
    private let disk: LocalPlanDisk
    private let monitor = NWPathMonitor()
    private var file: URL?
    private var local: LocalFinancePlan?
    private var session: String?
    private var epoch = UUID()
    private var syncTask: Task<Bool, Never>?
    private var retryTask: Task<Void, Never>?
    private var retryDelay: UInt64 = 2
    private var editDuringSync = false
    private var refreshNotices: [NoticeScope: String] = [:]
    private var conflictingReply: AccountPayload?
    @Published private(set) var syncStatus = ""
    @Published private(set) var syncing = false

    init(api: NjoraAPI = NjoraAPI(), disk: LocalPlanDisk = LocalPlanDisk(),
         clearAccountReminder: @escaping () -> Void = NjoraReminder.disable,
         publishWidget: @escaping (Plan?) -> Void = WidgetSnapshot.update) {
        self.clearAccountReminder = clearAccountReminder
        self.publishWidget = publishWidget
        self.api = api
        self.disk = disk
        monitor.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied { Task { @MainActor in self?.requestSync() } }
        }
        monitor.start(queue: DispatchQueue(label: "de.njora.connectivity"))
    }

    deinit { monitor.cancel(); syncTask?.cancel(); retryTask?.cancel() }

    func restore() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-njora-demo") {
            plan = .demo
            state = .preview
            return
        }
        #endif
        guard !busy, state == .loading || state == .offline else { return }
        await run {
            do {
                guard let key = try await self.api.restoreSessionID() else { self.plan = nil; self.state = .signedOut; return }
                self.session = key
                if let file = try self.disk.boundFile(session: key), let record = try self.disk.load(from: file) {
                    self.file = file
                    self.apply(record)
                    self.syncStatus = record.pending ? "Auf diesem Gerät gespeichert. Cloud-Abgleich ausstehend." : ""
                    self.requestSync()
                } else { try await self.openAccount() }
            } catch { self.state = .offline; throw error }
        }
    }

    func login(email: String, password: String) async -> Bool {
        await run {
            try await self.api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            try await self.loadAfterAuthentication()
        }
    }

    func mail(action: String, email: String) async {
        await run { self.message = try await self.api.sendMail(action, email: email.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    func finish(_ action: EmailAction, password: String) async -> Bool {
        await run {
            try await self.api.finish(action, password: password)
            try await self.loadAfterAuthentication()
        }
    }

    func save(_ changed: Plan, basedOn original: Plan? = nil, in scope: NoticeScope = .editor) async -> Bool {
        #if DEBUG
        if state == .preview { plan = changed; return true }
        #endif
        guard !busy, var record = local, state == .ready || state == .setup else { return false }
        do {
            if let original, original != record.local {
                var edit = record
                edit.sending = nil
                edit.base = original
                edit.local = changed
                try edit.reconcile(record.local, revision: record.revision)
                record.local = edit.local
            } else { record.local = changed }
            try record.local?.checkStorageLimits()
            try persist(record)
            if syncing { editDuringSync = true }
            clearNotice(in: scope)
            if !conflict { syncStatus = "Auf diesem Gerät gespeichert. Cloud-Abgleich ausstehend." }
            requestSync()
            return true
        } catch {
            if error is PlanConflict {
                notices[scope] = "Dieser Eintrag hat sich während der Bearbeitung geändert. Öffne ihn erneut."
            } else if let limit = error as? PlanStorageError {
                notices[scope] = limit.localizedDescription
            } else {
                notices[scope] = "Auf diesem Gerät konnte nicht gespeichert werden. Prüfe den freien Speicher und versuche es erneut."
            }
            return false
        }
    }

    private func apply(_ record: LocalFinancePlan) {
        local = record
        user = record.user
        let wasLocked = billing?.active == false
        billing = record.billing
        if plan != record.local { plan = record.local }
        else if wasLocked != (billing?.active == false) { updateWidget() }
        state = billing?.active == false ? .subscription : (record.local == nil ? .setup : .ready)
    }

    private func persist(_ record: LocalFinancePlan) throws {
        guard let file else { throw CocoaError(.fileNoSuchFile) }
        guard local != record else { return }
        try disk.write(record, to: file)
        apply(record)
    }

    func requestSync() {
        guard let session, local != nil, syncTask == nil, !conflict else { return }
        retryTask?.cancel()
        retryTask = nil
        let generation = epoch
        syncing = true
        editDuringSync = false
        syncTask = Task {
            let completed = await self.synchronize(session: session, generation: generation)
            guard generation == self.epoch else { return false }
            self.syncing = false
            self.syncTask = nil
            if self.editDuringSync && self.needsSync && self.retryTask == nil { self.requestSync() }
            return completed
        }
    }

    private func synchronize(session: String, generation: UUID) async -> Bool {
        do {
            let reply = try await api.account(session: session, positions: local?.local?[.savings] ?? [])
            guard generation == epoch, var record = local, disk.file(reply.user.email) == file else { return false }
            let replacedAccount = !record.belongsToAccount(in: reply)
            if replacedAccount {
                record = .cloud(reply)
            }
            record.applyIdentity(reply)
            do { try record.reconcile(reply.plan, revision: reply.revision) }
            catch is PlanConflict {
                try persist(record)
                conflict = true
                conflictingReply = reply
                syncStatus = "Änderungen überschneiden sich. Bitte wähle in Konto & Einstellungen den gewünschten Stand."
                return false
            }
            if record.billing?.active != false { reply.closingPrices?.apply(to: &record.local) }
            try persist(record)
            if replacedAccount {
                // Close editors bound to the former account, even if both plans are populated.
                accountLifetime = UUID()
                notices.removeAll()
                refreshNotices.removeAll()
                clearAccountReminder()
            }
            while var next = local, next.pending, let outgoing = next.local {
                guard next.billing?.active != false else {
                    syncStatus = "Lokal gespeichert. Der Cloud-Abgleich benötigt ein aktives Abo."
                    return false
                }
                next.sending = outgoing
                try persist(next)
                let revision = try await api.save(outgoing, revision: next.revision, session: session)
                guard generation == epoch, var latest = local else { return false }
                latest.base = outgoing
                latest.revision = revision
                latest.sending = nil
                try persist(latest)
            }
            retryDelay = 2
            for (scope, message) in refreshNotices where notices[scope] == message { clearNotice(in: scope) }
            refreshNotices.removeAll()
            syncStatus = "Mit der Cloud abgeglichen."
            return true
        } catch {
            guard generation == epoch, !Task.isCancelled else { return false }
            let status = (error as? APIError)?.status
            if status == 401 {
                await signOutLocally()
                message = "Bitte melde dich erneut an. Lokale Änderungen stehen in deinem Konto wieder bereit."
                return false
            }
            if let status, (400..<500).contains(status), ![402, 408, 409, 429].contains(status) {
                syncStatus = "Die Cloud hat den Plan abgelehnt. Deine lokale Fassung bleibt gespeichert. " + (error.localizedDescription)
                return false
            }
            syncStatus = local?.pending == true ? "Lokal gespeichert. Cloud-Abgleich ausstehend." : "Offline-Stand auf diesem Gerät."
            let delay = retryDelay
            retryDelay = min(delay * 2, 120)
            retryTask = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { return }
                self?.requestSync()
            }
            return false
        }
    }

    func resolve(_ preference: MergePreference) {
        guard let reply = conflictingReply, var record = local else { return }
        do {
            try record.reconcile(reply.plan, revision: reply.revision, prefer: preference)
            try persist(record)
            conflict = false
            conflictingReply = nil
            syncStatus = "Cloud-Abgleich ausstehend."
            requestSync()
        } catch { syncStatus = "Die Auswahl konnte auf diesem Gerät nicht gespeichert werden." }
    }

    @discardableResult
    func refresh(in scope: NoticeScope = .editor) async -> Bool {
        #if DEBUG
        if state == .preview { return true }
        #endif
        requestSync()
        guard await syncTask?.value == true, !conflict, !needsSync else {
            if scope != .settings && state != .signedOut {
                notices[scope] = syncStatus
                refreshNotices[scope] = syncStatus
            }
            return false
        }
        clearNotice(in: scope)
        return true
    }

    func endSession(deleteAccount: Bool, in scope: NoticeScope = .account) async {
        if !deleteAccount && local?.pending == true {
            notices[scope] = "Auf diesem Gerät sind Änderungen offen. Gleiche sie vor dem Abmelden mit der Cloud ab."
            requestSync()
            return
        }
        await run(in: scope) {
            _ = await self.syncTask?.value
            try await self.api.endSession(deleteAccount: deleteAccount)
            if let file = self.file { try? FileManager.default.removeItem(at: file) }
            await self.signOutLocally()
        }
    }

    func signOutLocally() async {
        epoch = UUID()
        syncTask?.cancel(); syncTask = nil
        retryTask?.cancel(); retryTask = nil
        syncing = false
        refreshNotices.removeAll()
        if let session { try? disk.unbind(session: session) }
        if let file, local?.pending == false { try? FileManager.default.removeItem(at: file) }
        session = nil
        file = nil
        local = nil
        conflictingReply = nil
        syncStatus = ""
        conflict = false
        user = nil
        billing = nil
        plan = nil
        state = .signedOut
        notices.removeAll()
        clearAccountReminder()
        await api.clearSession()
    }

    private func loadAfterAuthentication() async throws {
        epoch = UUID()
        syncTask?.cancel(); syncTask = nil
        retryTask?.cancel(); retryTask = nil
        syncing = false
        notices.removeAll()
        refreshNotices.removeAll()
        conflict = false
        conflictingReply = nil
        syncStatus = ""
        if let session { try? disk.unbind(session: session) }
        if let file, local?.pending == false { try? FileManager.default.removeItem(at: file) }
        file = nil
        local = nil
        plan = nil
        user = nil
        billing = nil
        session = await api.sessionID()
        do { try await openAccount() }
        catch { state = .offline; throw error }
    }

    private func openAccount() async throws {
        guard let session else { throw CancellationError() }
        let generation = epoch
        let reply = try await api.account(session: session)
        guard generation == epoch else { throw CancellationError() }
        let target = disk.file(reply.user.email)
        let cached = try disk.load(from: target)
        let replacedAccount = cached.map { !$0.belongsToAccount(in: reply) } ?? false
        var record = replacedAccount ? .cloud(reply) : cached ?? .cloud(reply)
        record.applyIdentity(reply)
        if !record.pending { try record.reconcile(reply.plan, revision: reply.revision) }
        if record.billing?.active != false { reply.closingPrices?.apply(to: &record.local) }
        try disk.write(record, to: target)
        try disk.bind(target, session: session)
        file = target
        if replacedAccount {
            accountLifetime = UUID()
            clearAccountReminder()
        }
        apply(record)
        if record.pending { requestSync() } else { syncStatus = "Mit der Cloud abgeglichen." }
    }

    static let subscriptionID = "de.njora.finanzueberblick.monthly"

    func confirm(_ transaction: StoreKit.Transaction) async throws -> Bool {
        let generation = epoch
        guard let session, transaction.productID == Self.subscriptionID, let token = billing?.accountToken,
              transaction.appAccountToken == token else { return false }
        let active = try await api.confirmPurchase(String(transaction.originalID), environment: transaction.environment.rawValue, session: session)
        guard generation == epoch else { throw CancellationError() }
        requestSync()
        _ = await syncTask?.value
        guard generation == epoch else { throw CancellationError() }
        if active && billing?.active != true { try await openAccount() }
        await transaction.finish()
        return active
    }

    @discardableResult
    private func run(in scope: NoticeScope = .account, _ operation: () async throws -> Void) async -> Bool {
        guard !busy else { return false }
        notices[scope] = nil
        busy = true
        defer { busy = false }
        do { try await operation(); return true }
        catch let error as APIError {
            if error.status == 401, state != .signedOut {
                await signOutLocally()
                message = error.message
            } else {
                notices[scope] = error.message
            }
        } catch {
            if isRequestCancellation(error) { return false }
            if let transport = error as? URLError {
                switch transport.code {
                case .notConnectedToInternet, .dataNotAllowed:
                    notices[scope] = "Dein Gerät ist offline. Versuche es wieder, sobald du Internet hast."
                case .timedOut:
                    notices[scope] = "Die Antwort von Njora hat zu lange gedauert. Bitte erneut versuchen."
                default:
                    notices[scope] = "Die Verbindung zu Njora wurde unterbrochen. Bitte erneut versuchen."
                }
            } else if error is DecodingError {
                notices[scope] = "Die Antwort von Njora konnte nicht gelesen werden. Bitte aktualisiere die Ansicht."
            } else {
                notices[scope] = "Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen."
            }
        }
        return false
    }
}

private extension WidgetSnapshot {
    static func update(_ plan: Plan?) {
        let snapshot = plan.map { plan in
            let metrics = PlanMetrics(plan: plan)
            let forecast = metrics.forecast
            return WidgetSnapshot(updated: metrics.today, balance: metrics.net, income: metrics.income,
                                  fixedCosts: metrics.fixedCosts, available: metrics.available,
                                  forecastLow: forecast.low, forecastHigh: forecast.high)
        }
        if WidgetSnapshot.replace(with: snapshot) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

enum NjoraReminder {
    static let identifier = "njora.check-in"
    static func disable() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }

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
