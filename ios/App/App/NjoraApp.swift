import WidgetKit
import StoreKit
import SwiftUI

@main
struct NjoraApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var appearance = AppearanceSettings()
    @StateObject private var store = NjoraStore()
    @State private var tab = DashboardTab.today
    @State private var emailAction: EmailAction?

    var body: some Scene {
        WindowGroup {
            Group {
                switch store.state {
                case .loading: ProgressView("Njora wird geöffnet …")
                case .signedOut: LoginView(store: store, emailAction: $emailAction)
                case .subscription: SubscriptionView(store: store)
                case .setup: SetupView(store: store)
                case .ready: Dashboard(store: store, tab: $tab).id(store.accountLifetime)
                case .offline:
                    VStack(spacing: 20) {
                        BrandMark()
                        Text("Finanzplan öffnen").font(.largeTitle.bold())
                        Text(store.message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                        Button("Erneut versuchen") { Task { await store.restore() } }
                            .buttonStyle(.borderedProminent)
                        Button("Abmelden", role: .destructive) { Task { await store.signOutLocally() } }
                    }.padding(30)
                #if DEBUG
                case .preview: Dashboard(store: store, tab: $tab)
                #endif
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(appearance.selected.paper.ignoresSafeArea())
            .tint(appearance.selected.accent)
            .environment(\.locale, Locale(identifier: "de_DE"))
            .overlay {
                if phase != .active {
                    ZStack { appearance.selected.paper.ignoresSafeArea(); BrandMark() }
                        .accessibilityHidden(true)
                }
            }
            .task { await store.restore() }
            .task(id: phase) {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 3_600_000_000_000) } catch { return }
                    if store.plan?[.savings].contains(where: { ClosingPrices.isin($0) != nil }) == true { store.requestSync() }
                }
            }
            .onChange(of: phase) { phase in
                if phase == .active { store.becameActive() }
            }
            .task {
                for await result in StoreKit.Transaction.updates {
                    if case .verified(let transaction) = result { _ = try? await store.confirm(transaction) }
                }
            }
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
            .environment(\.njoraAppearance, appearance.selected)
            .environmentObject(appearance)
        }
    }
}

@MainActor
final class AppearanceSettings: ObservableObject {
    @Published private(set) var selected = NjoraAppearance.load()

    func select(_ newValue: NjoraAppearance) throws {
        guard newValue != selected else { return }
        try newValue.save()
        selected = newValue
        WidgetCenter.shared.reloadAllTimelines()
    }
}

struct BrandMark: View {
    @Environment(\.njoraAppearance) private var theme
    var body: some View {
        Label("N J O R A", systemImage: "n.circle")
            .font(.system(.title3, design: .serif, weight: .semibold))
            .foregroundStyle(theme.accent)
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
                if registering {
                    Text("Du erstellst zunächst dein Konto. Das Monatsabo für deinen Finanzplan schließt du separat ab. Es gelten die [AGB](https://njora.de/nutzungsbedingungen). Hier findest du die [Datenschutzerklärung](https://njora.de/datenschutz).").font(.footnote)
                }
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
                if action.kind == .confirmation {
                    Text("Mit dem Freischalten deines Kontos akzeptierst du die [AGB](https://njora.de/nutzungsbedingungen).").font(.footnote)
                }
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
            .accountDeletionDialog(isPresented: $confirmDelete) {
                Task { await store.endSession(deleteAccount: true) }
            }
        }
    }
}

private struct AccountDeletionConfirmation: ViewModifier {
    @Environment(\.openURL) private var openURL
    @Binding var isPresented: Bool
    let delete: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog("Konto und Finanzplan dauerhaft löschen?", isPresented: $isPresented, titleVisibility: .visible) {
            Button("Apple-Abonnements öffnen") { openURL(URL(string: "https://apps.apple.com/account/subscriptions")!) }
            Button("Konto endgültig löschen", role: .destructive, action: delete)
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Ein Web-Abo endet sofort. Ein App-Store-Abo läuft nach der Kontolöschung weiter, auch in der Probezeit. Kündige es vor dem Löschen bei Apple, um weitere Abbuchungen zu vermeiden. Der bisherige Kauf ist an dieses Njora-Konto gebunden.")
        }
    }
}

extension View {
    func accountDeletionDialog(isPresented: Binding<Bool>, delete: @escaping () -> Void) -> some View {
        modifier(AccountDeletionConfirmation(isPresented: isPresented, delete: delete))
    }
}

struct LegalLinksView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Link("Datenschutz", destination: URL(string: "https://njora.de/datenschutz")!)
            Link("AGB und Nutzungsbedingungen", destination: URL(string: "https://njora.de/nutzungsbedingungen")!)
            Link("Support", destination: URL(string: "https://njora.de/support")!)
            Link("Impressum", destination: URL(string: "https://njora.de/impressum")!)
        }.font(.footnote)
    }
}

private struct SubscriptionView: View {
    @ObservedObject var store: NjoraStore
    @State private var product: Product?
    @State private var introductory = false
    @State private var working = false
    @State private var loadingProduct = false
    @State private var productError = ""
    @State private var notice = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Njora Monatsabo") {
                    if let product {
                        Text(introductory ? "Ein Monat kostenlos, danach \(product.displayPrice) pro Monat." : "\(product.displayPrice) pro Monat.")
                        Text("Das Abo verlängert sich monatlich, bis du es in deinen Apple-Abonnements kündigst.")
                        Button(introductory ? "Probemonat starten" : "Monatsabo abschließen") { Task { await purchase(product) } }
                            .disabled(working)
                    } else {
                        if loadingProduct {
                            ProgressView("Monatsangebot wird geladen …")
                        } else {
                            Button("Monatsangebot laden") { Task { await load() } }.disabled(working)
                        }
                    }
                    Button("Käufe wiederherstellen") { Task { await restore() } }.disabled(working)
                    Link("Apple-Abonnements verwalten", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                    Notice(text: notice.isEmpty ? productError : notice)
                }
                Section {
                    NavigationLink("Konto und Daten verwalten") { SettingsView(store: store) }
                    LegalLinksView()
                }
            }
            .navigationTitle("Njora abonnieren")
            .njoraNavigationBackground()
        }
        .task {
            do {
                for await result in StoreKit.Transaction.currentEntitlements {
                    if case .verified(let tx) = result, try await store.confirm(tx) { return }
                }
            } catch { notice = "Dein bestehender Kauf konnte gerade nicht geprüft werden." }
            await load()
        }
    }

    private func load() async {
        guard !loadingProduct else { return }
        loadingProduct = true
        productError = ""
        defer { loadingProduct = false }
        do {
            guard let found = try await Product.products(for: [NjoraStore.subscriptionID]).first,
                  let subscription = found.subscription,
                  subscription.subscriptionPeriod.unit == .month, subscription.subscriptionPeriod.value == 1 else {
                productError = "Das Monatsabo ist im App Store gerade nicht verfügbar."
                return
            }
            let offer = subscription.introductoryOffer
            let eligible = await subscription.isEligibleForIntroOffer
            introductory = eligible && offer?.paymentMode == .freeTrial && offer?.period.unit == .month && offer?.period.value == 1 && offer?.periodCount == 1
            product = found
        } catch {
            if !isRequestCancellation(error) { productError = "Das Angebot konnte nicht geladen werden." }
        }
    }

    private func purchase(_ product: Product) async {
        guard !working, let token = store.billing?.accountToken else { return }
        working = true
        defer { working = false }
        do {
            notice = ""
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case .success(.verified(let tx)):
                do {
                    if try await !store.confirm(tx) { notice = "Der Kauf konnte diesem Konto nicht zugeordnet werden." }
                } catch {
                    notice = "Apple hat den Kauf bestätigt. Die Freischaltung bei Njora steht aus. Nutze „Käufe wiederherstellen“."
                }
            case .pending: notice = "Dein Kauf wartet auf Bestätigung."
            case .userCancelled: break
            default: notice = "Der Kauf konnte nicht bestätigt werden."
            }
        } catch { notice = "Der App Store konnte den Kauf nicht abschließen. Prüfe deine Verbindung und versuche es erneut." }
    }

    private func restore() async {
        guard !working else { return }
        working = true
        defer { working = false }
        do {
            notice = ""
            try await AppStore.sync()
            var differentAccount = false
            for await result in StoreKit.Transaction.currentEntitlements {
                guard case .verified(let tx) = result, tx.productID == NjoraStore.subscriptionID else { continue }
                if tx.appAccountToken != store.billing?.accountToken {
                    differentAccount = true
                } else if try await store.confirm(tx) { return }
            }
            notice = differentAccount
                ? "Dieses Apple-Abo gehört zu einem anderen Njora-Konto. Melde dich dort an. Falls das Konto gelöscht wurde, kannst du die Abrechnung in deinen Apple-Abonnements beenden."
                : "Für dieses Njora-Konto wurde kein aktiver Kauf gefunden."
        } catch { notice = "Die Wiederherstellung ist gerade nicht möglich." }
    }
}
