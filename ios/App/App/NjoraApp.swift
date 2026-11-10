import SwiftUI
import UserNotifications

@main
struct NjoraApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var store = NjoraStore()
    @State private var emailAction: EmailAction?

    var body: some Scene {
        WindowGroup {
            Group {
                switch store.state {
                case .loading: ProgressView("Njora wird geöffnet …")
                case .signedOut: LoginView(store: store, emailAction: $emailAction)
                case .setup: SetupView(store: store)
                case .ready: Dashboard(store: store)
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
                case .preview: Dashboard(store: store)
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
    @Published private(set) var plan: Plan?
    @Published private(set) var user: AccountPayload.User?
    @Published private(set) var busy = false
    @Published var message = ""
    @Published private(set) var conflict = false
    private var revision: Int?
    private let api = NjoraAPI()

    func restore() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-njora-demo") {
            plan = .demo
            state = .preview
            return
        }
        #endif
        guard !busy else { return }
        guard await api.hasSession() else { state = .signedOut; return }
        await run {
            do { try await self.reload() }
            catch {
                if (error as? APIError)?.status == 401 {
                    await self.signOutLocally()
                    return
                }
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

    func save(_ changed: Plan) async -> Bool {
        #if DEBUG
        if state == .preview { plan = changed; return true }
        #endif
        return await run {
            self.revision = try await self.api.save(changed, revision: self.revision)
            self.plan = changed
            self.state = .ready
        }
    }

    func refresh() async {
        #if DEBUG
        if state == .preview { return }
        #endif
        await run { try await self.reload() }
    }

    func search(_ query: String) async throws -> [SecuritySuggestion] { try await api.search(query) }

    func refreshQuotes() async {
        guard let plan else { return }
        let symbols = Set(plan[.savings].filter { $0.fields.text("kind") == "security" }
            .map { $0.fields.text("symbol").uppercased() }.filter { !$0.isEmpty }).sorted()
        guard !symbols.isEmpty else { message = "Lege zuerst ein Wertpapier mit Börsensymbol an."; return }
        await run {
            let quotes = try await self.api.quotes(symbols)
            let bySymbol = Dictionary(quotes.map { ($0.symbol, $0) }, uniquingKeysWith: { first, _ in first })
            var changed = plan
            changed[.savings] = plan[.savings].map { item in
                guard item.fields.text("kind") == "security",
                      let quote = bySymbol[item.fields.text("symbol").uppercased()] else { return item }
                var updated = item
                updated.fields["price"] = .number(quote.price)
                updated.fields["priceEur"] = .number(quote.priceEur)
                updated.fields["currency"] = .string(quote.currency)
                updated.fields["quoteUpdatedAt"] = .string(quote.marketTime)
                return updated
            }
            self.revision = try await self.api.save(changed, revision: self.revision)
            self.plan = changed
            self.message = "\(quotes.count) von \(symbols.count) Kursen aktualisiert."
        }
    }

    func endSession(deleteAccount: Bool) async {
        await run {
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
        message = ""
    }

    private func loadAfterAuthentication() async throws {
        do { try await reload() }
        catch { state = .offline; throw error }
    }

    private func reload() async throws {
        let reply = try await api.account()
        user = reply.user
        plan = reply.plan
        revision = reply.revision
        state = reply.plan == nil ? .setup : .ready
    }

    @discardableResult
    private func run(_ operation: () async throws -> Void) async -> Bool {
        guard !busy else { return false }
        message = ""
        conflict = false
        busy = true
        defer { busy = false }
        do { try await operation(); return true }
        catch let error as APIError {
            if error.status == 401, state != .signedOut { await signOutLocally() }
            conflict = error.status == 409
            message = error.message
        } catch {
            message = "Njora konnte den Dienst gerade nicht erreichen. Bitte versuche es erneut."
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
                    TextField("E-Mail-Adresse", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    if !registering {
                        SecureField("Passwort", text: $password).textContentType(.password)
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
                }.navigationTitle("Link aus E-Mail").toolbar {
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
                    TextField("Dein Name", text: $name)
                    TextField("Nettoeinkommen pro Monat", text: $income).keyboardType(.decimalPad)
                    TextField("Aktueller Kontostand", text: $balance).keyboardType(.numbersAndPunctuation)
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
                    Task { _ = await store.save(newPlan) }
                }.disabled(store.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 80)
                Section("Konto") {
                    Button("Abmelden") { Task { await store.endSession(deleteAccount: false) } }.disabled(store.busy)
                    Button("Konto löschen", role: .destructive) { confirmDelete = true }.disabled(store.busy)
                    LegalLinksView()
                }
            }
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
