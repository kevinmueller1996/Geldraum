import SwiftUI
import UserNotifications
import WidgetKit

@main
struct NjoraApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var store = NjoraStore()
    @State private var tab = DashboardTab.today
    @State private var emailAction: EmailAction?

    var body: some Scene {
        WindowGroup {
            Group {
                switch store.state {
                case .loading: ProgressView("Njora wird geöffnet …")
                case .signedOut: LoginView(store: store, emailAction: $emailAction)
                case .setup: SetupView(store: store)
                case .ready: Dashboard(store: store, tab: $tab)
                case .offline:
                    VStack(spacing: 20) {
                        BrandMark()
                        Text("Verbindung fehlt").font(.largeTitle.bold())
                        Text(store.message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                        Button("Erneut verbinden") { Task { await store.restore() } }
                            .buttonStyle(.borderedProminent)
                        Button("Abmelden", role: .destructive) { Task { await store.signOutLocally() } }
                    }.padding(30)
                #if DEBUG
                case .preview: Dashboard(store: store, tab: $tab)
                #endif
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(NjoraTheme.paper.ignoresSafeArea())
            .tint(NjoraTheme.accent)
            .environment(\.locale, Locale(identifier: "de_DE"))
            .overlay {
                if phase != .active {
                    ZStack { NjoraTheme.paper.ignoresSafeArea(); BrandMark() }
                        .accessibilityHidden(true)
                }
            }
            .task { await store.restore() }
            .onOpenURL { url in
                if url.scheme == "njora", url.host == "widget" {
                    switch url.path {
                    case "/budget": tab = .month
                    case "/balance": tab = .today
                    default: break
                    }
                    return
                }
                if let action = EmailAction(link: url.absoluteString) { emailAction = action }
            }
            .sheet(item: $emailAction) { action in
                EmailPasswordView(action: action, store: store)
            }
        }
    }
}

@MainActor
final class NjoraStore: ObservableObject {
    enum State {
        case loading, signedOut, setup, ready, offline
        #if DEBUG
        case preview
        #endif
    }
    @Published private(set) var state: State = .loading
    @Published private(set) var plan: Plan? {
        didSet {
            let snapshot = plan.map { plan in
                let metrics = PlanMetrics(plan: plan)
                let forecast = metrics.forecast
                return WidgetSnapshot(updated: metrics.today, balance: metrics.net, income: metrics.income,
                                      fixedCosts: metrics.fixedCosts, available: metrics.available,
                                      forecastLow: forecast.low, forecastHigh: forecast.high)
            }
            WidgetSnapshot.replace(with: snapshot)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
    @Published private(set) var user: AccountPayload.User?
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
    @Published private(set) var conflict = false
    private var revision: Int?
    private let api: NjoraAPI

    init(api: NjoraAPI = NjoraAPI()) { self.api = api }

    func restore() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-njora-demo") {
            plan = .demo
            state = .preview
            return
        }
        #endif
        guard !busy else { return }
        guard await api.hasSession() else { plan = nil; state = .signedOut; return }
        await run {
            do { try await self.reload() }
            catch {
                if (error as? APIError)?.status == 401 {
                    await self.signOutLocally()
                    return
                }
                if isRequestCancellation(error) { throw error }
                self.state = .offline
                throw error
            }
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

    func save(_ changed: Plan, in scope: NoticeScope = .editor) async -> Bool {
        #if DEBUG
        if state == .preview { plan = changed; return true }
        #endif
        return await run(in: scope) {
            self.revision = try await self.api.save(changed, revision: self.revision)
            self.conflict = false
            self.plan = changed
            self.state = .ready
        }
    }

    @discardableResult
    func refresh(in scope: NoticeScope = .editor) async -> Bool {
        #if DEBUG
        if state == .preview { return true }
        #endif
        return await run(in: scope) { try await self.reload() }
    }

    func search(_ query: String) async throws -> [SecuritySuggestion] { try await api.search(query) }

    func refreshQuotes(ifNeeded: Bool = false) async {
        guard state == .ready, let plan else { return }
        if ifNeeded {
            let cutoff = Date().addingTimeInterval(-15 * 60)
            let staleSecurity = plan[.savings].contains { item in
                item.fields.text("kind") == "security" && !item.fields.text("symbol").isEmpty
                    && (PlanDate.parseTradeTime(item.fields.text("quoteUpdatedAt")) ?? .distantPast) < cutoff
            }
            guard staleSecurity else { return }
        }
        let symbols = Set(plan[.savings].filter { $0.fields.text("kind") == "security" }
            .map { $0.fields.text("symbol").uppercased() }.filter { !$0.isEmpty }).sorted()
        guard !symbols.isEmpty else { notices[.section(.savings)] = "Lege zuerst ein Wertpapier mit Börsensymbol an."; return }
        await run(in: .section(.savings)) {
            let quotes = try await self.api.quotes(symbols)
            guard !quotes.isEmpty else {
                self.notices[.section(.savings)] = "Für deine Wertpapiere ist gerade kein neuer Kurs verfügbar."
                return
            }
            let bySymbol = Dictionary(quotes.map { ($0.symbol, $0) }, uniquingKeysWith: { first, _ in first })
            var changed = plan
            changed[.savings] = plan[.savings].map { item in
                guard item.fields.text("kind") == "security",
                      let quote = bySymbol[item.fields.text("symbol").uppercased()] else { return item }
                if let previousTime = PlanDate.parseTradeTime(item.fields.text("quoteUpdatedAt")),
                   let tradeTime = PlanDate.parseTradeTime(quote.marketTime), previousTime > tradeTime { return item }
                var updated = item
                updated.fields["price"] = .number(quote.price)
                updated.fields["priceEur"] = .number(quote.priceEur)
                updated.fields["currency"] = .string(quote.currency)
                updated.fields["quoteUpdatedAt"] = .string(quote.marketTime)
                updated.fields["quoteVenue"] = quote.venue.map(JSONValue.string)
                return updated
            }
            if changed[.savings] != plan[.savings] {
                try Task.checkCancellation()
                // Once the write has started, finish it even if the depot view disappears.
                let pending = Task { [changed, revision = self.revision, api = self.api] in
                    try await api.save(changed, revision: revision)
                }
                self.revision = try await pending.value
                self.plan = changed
            }
            self.notices[.section(.savings)] = "\(quotes.count) von \(symbols.count) Kursen abgerufen."
        }
    }

    func endSession(deleteAccount: Bool, in scope: NoticeScope = .account) async {
        await run(in: scope) {
            try await self.api.endSession(deleteAccount: deleteAccount)
            await self.signOutLocally()
        }
    }

    func signOutLocally() async {
        await api.clearSession()
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [NjoraReminder.identifier])
        user = nil
        plan = nil
        revision = nil
        state = .signedOut
        notices.removeAll()
        conflict = false
    }

    private func loadAfterAuthentication() async throws {
        plan = nil
        do { try await reload() }
        catch { state = .offline; throw error }
    }

    private func reload() async throws {
        let reply = try await api.account()
        conflict = false
        user = reply.user
        plan = reply.plan?.unifiedCosts
        revision = reply.revision
        state = reply.plan == nil ? .setup : .ready
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
                if error.status == 409 { conflict = true }
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

enum NjoraTheme {
    static let accent = Color(light: UIColor(red: 0.30, green: 0.14, blue: 0.12, alpha: 1), dark: UIColor(red: 0.94, green: 0.65, blue: 0.54, alpha: 1))
    static let paper = Color(light: UIColor(red: 0.96, green: 0.94, blue: 0.91, alpha: 1), dark: UIColor(red: 0.15, green: 0.12, blue: 0.11, alpha: 1))
    static let card = Color(light: UIColor(red: 1, green: 0.99, blue: 0.97, alpha: 1), dark: UIColor(red: 0.22, green: 0.18, blue: 0.17, alpha: 1))
    static let positive = Color(light: UIColor(red: 0.25, green: 0.38, blue: 0.25, alpha: 1), dark: UIColor(red: 0.59, green: 0.77, blue: 0.57, alpha: 1))
}

extension Color {
    fileprivate init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

struct BrandMark: View {
    var body: some View {
        Label("N J O R A", systemImage: "n.circle")
            .font(.system(.title3, design: .serif, weight: .semibold))
            .foregroundStyle(NjoraTheme.accent)
            .accessibilityLabel("Njora")
    }
}

struct Notice: View {
    let text: String
    var body: some View {
        if !text.isEmpty {
            Text(text).font(.footnote).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently)
        }
    }
}

struct LoginView: View {
    @ObservedObject var store: NjoraStore
    @Binding var emailAction: EmailAction?
    @State private var email = ""
    @State private var password = ""
    @State private var registering = false
    @State private var showLinkInput = false
    @State private var pendingEmailAction: EmailAction?
    @State private var mailLink = ""
    @State private var linkError = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                BrandMark()
                Text(registering ? "Dein Finanzplan beginnt hier." : "Willkommen zurück.")
                    .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(registering ? "Bestätige deine E-Mail-Adresse, um ein Konto anzulegen." : "Melde dich an und öffne deinen persönlichen Finanzüberblick.")
                    .foregroundStyle(.secondary)
                Picker("Zugang", selection: $registering) {
                    Text("Anmelden").tag(false)
                    Text("Konto erstellen").tag(true)
                }.pickerStyle(.segmented).onChange(of: registering) { _ in store.message = "" }
                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("E-Mail-Adresse").font(.subheadline.weight(.medium)).accessibilityHidden(true)
                        TextField("E-Mail-Adresse", text: $email, prompt: Text("name@firma.de"))
                            .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    if !registering {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Passwort").font(.subheadline.weight(.medium)).accessibilityHidden(true)
                            SecureField("Passwort", text: $password).textContentType(.password)
                        }
                    }
                }.textFieldStyle(.roundedBorder)
                Button {
                    Task {
                        if registering { await store.mail(action: "register", email: email) }
                        else if await store.login(email: email, password: password) { password = "" }
                    }
                } label: {
                    Text(registering ? "Bestätigungslink senden" : "Anmelden").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(store.busy || email.trimmingCharacters(in: .whitespaces).isEmpty || (!registering && password.isEmpty))
                if !registering {
                    Button("Passwort vergessen?") { Task { await store.mail(action: "forgot-password", email: email) } }
                        .disabled(email.isEmpty || store.busy)
                }
                Button("Link aus E-Mail öffnen") { mailLink = ""; linkError = ""; showLinkInput = true }
                Notice(text: store.message)
                LegalLinksView()
            }
            .padding(28).frame(maxWidth: 500).frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showLinkInput, onDismiss: {
            if let pendingEmailAction {
                self.pendingEmailAction = nil
                emailAction = pendingEmailAction
            }
        }) {
            NavigationStack {
                Form {
                    Text("Kopiere den Bestätigungs- oder Reset-Link aus der Njora-E-Mail und füge ihn hier ein.")
                    TextField("Link einfügen", text: $mailLink)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Notice(text: linkError)
                    Button("Weiter") {
                        guard let action = EmailAction(link: mailLink) else {
                            linkError = "Bitte füge den vollständigen Njora-Link ein."; return
                        }
                        pendingEmailAction = action
                        mailLink = ""
                        showLinkInput = false
                    }.disabled(mailLink.isEmpty)
                }.planFormStyle().navigationTitle("Link aus E-Mail").toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { showLinkInput = false } }
                }
            }
        }
    }
}

struct EmailPasswordView: View {
    let action: EmailAction
    @ObservedObject var store: NjoraStore
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var repeated = ""

    var body: some View {
        NavigationStack {
            Form {
                Text("Wähle ein Passwort mit mindestens zehn Zeichen und höchstens 72 Bytes.")
                SecureField("Passwort", text: $password).textContentType(.newPassword)
                SecureField("Passwort wiederholen", text: $repeated).textContentType(.newPassword)
                Notice(text: store.message)
                Button("Passwort speichern") {
                    Task { if await store.finish(action, password: password) { dismiss() } }
                }.disabled(store.busy || password.utf16.count < 10 || password.utf8.count > 72 || password != repeated)
            }
            .planFormStyle()
            .navigationTitle(action.title)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

struct SetupView: View {
    @ObservedObject var store: NjoraStore
    @State private var name = ""
    @State private var income = ""
    @State private var balance = ""
    @State private var cadence = "weekly"
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Gib deinem Finanzplan einen Namen. Weitere Konten, Ausgaben und Sparziele kannst du jederzeit ergänzen.")
                    PlanField(title: "Dein Name", text: $name, prompt: "Vorname")
                    PlanField(title: "Nettoeinkommen pro Monat", text: $income, prompt: "0", unit: "€", keyboard: .decimalPad)
                    PlanField(title: "Aktueller Kontostand", text: $balance, prompt: "0", unit: "€", keyboard: .numbersAndPunctuation)
                    Picker("Check-in", selection: $cadence) {
                        Text("Wöchentlich").tag("weekly")
                        Text("Täglich").tag("daily")
                    }
                }
                Notice(text: store.message)
                Button("Finanzplan erstellen") {
                    guard let earnings = germanAmount(income), let current = germanAmount(balance) else {
                        store.message = "Bitte prüfe deine Beträge."; return
                    }
                    var plan = Plan.blank(name: name.trimmingCharacters(in: .whitespacesAndNewlines))
                    plan.fields["checkInCadence"] = .string(cadence)
                    plan[.income][0].fields["amount"] = .number(earnings)
                    plan[.accounts][0].fields["balance"] = .number(current)
                    let newPlan = plan
                    Task { _ = await store.save(newPlan, in: .account) }
                }.disabled(store.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 80)
                Section("Konto") {
                    Button("Abmelden") { Task { await store.endSession(deleteAccount: false) } }.disabled(store.busy)
                    Button("Konto löschen", role: .destructive) { confirmDelete = true }.disabled(store.busy)
                    LegalLinksView()
                }
            }
            .planFormStyle()
            .navigationTitle("Dein Finanzplan")
            .confirmationDialog("Konto dauerhaft löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Konto endgültig löschen", role: .destructive) { Task { await store.endSession(deleteAccount: true) } }
            }
        }
    }
}

struct LegalLinksView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Link("Datenschutz", destination: URL(string: "https://njora.de/datenschutz")!)
            Link("Nutzungsbedingungen", destination: URL(string: "https://njora.de/nutzungsbedingungen")!)
            Link("Support", destination: URL(string: "https://njora.de/support")!)
            Link("Impressum", destination: URL(string: "https://njora.de/impressum")!)
        }.font(.footnote)
    }
}
