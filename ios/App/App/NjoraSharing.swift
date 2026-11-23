import SwiftUI

private struct Grant: Decodable, Identifiable {
    let id: String
    let email: String
    let role: String
    let active: Int
    var permission: String { role == "edit" ? "Mitbearbeiten" : "Nur ansehen" }
}

private struct GrantList: Decodable { let owned, received: [Grant] }
private struct Acknowledged: Decodable { let ok: Bool; let mailed: Bool? }
private struct SharedPlan: Decodable { let plan: Plan?; let role: String; let revision: Int? }

struct SharingView: View {
    @ObservedObject var store: NjoraStore
    @State private var workspace: FinanceWorkspace

    init(store: NjoraStore, initial: FinanceWorkspace) {
        self.store = store
        _workspace = State(initialValue: initial)
    }

    var body: some View {
        VStack {
            Picker("Finanzbereich", selection: $workspace) {
                ForEach(FinanceWorkspace.allCases, id: \.self) { Text($0.title).tag($0) }
            }.pickerStyle(.segmented).padding(.horizontal)
            SharingList(store: store, workspace: workspace).id(workspace)
        }.navigationTitle("Freigaben")
    }
}

private struct SharingList: View {
    @ObservedObject var store: NjoraStore
    let workspace: FinanceWorkspace
    @State private var list: GrantList?
    @State private var email = ""
    @State private var role = "view"
    @State private var message = ""
    @State private var busy = false
    @State private var removal: Grant?

    var body: some View {
        Form {
            Section("\(workspace.title) teilen") {
                Text("Eingeladene nutzen ein eigenes kostenloses Njora-Konto. Der Zugriff ist in deinem Bereichsabo enthalten.").font(.footnote).foregroundStyle(.secondary)
                TextField("E-Mail-Adresse", text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Picker("Berechtigung", selection: $role) {
                    Text("Nur ansehen").tag("view")
                    Text("Mitbearbeiten").tag("edit")
                }
                Button("Einladung erstellen") {
                    perform("invite", ["email":.string(email), "role":.string(role)])
                }.disabled(email.isEmpty || list == nil)
            }
            if let list {
                Section("Von dir freigegeben") {
                    if list.owned.isEmpty { Text("Noch keine Freigaben").foregroundStyle(.secondary) }
                    ForEach(list.owned) { grant in
                        VStack(alignment: .leading, spacing: 7) {
                            Text(grant.email)
                            Text(grant.permission + (grant.active == 1 ? " · Angenommen" : " · Einladung offen")).font(.footnote)
                            if grant.active == 0 {
                                let link = URL(string: "https://njora.de/freigaben?bereich=" + (workspace == .business ? "business" : "private"))!
                                ShareLink(item: link, message: Text("Ich lade dich in meinen Finanzbereich \(workspace.title) ein. Melde dich innerhalb von sieben Tagen mit \(grant.email) an.")) { Label("Einladungslink teilen", systemImage: "square.and.arrow.up") }
                            }
                            Button("Widerrufen", role: .destructive) { removal = grant }
                        }.buttonStyle(.borderless)
                    }
                }
                Section("Mit dir geteilt") {
                    if list.received.isEmpty { Text("Keine Einladungen für diesen Bereich").foregroundStyle(.secondary) }
                    ForEach(list.received) { grant in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(grant.email)
                            Text(grant.permission).font(.footnote)
                            if grant.active == 1 {
                                NavigationLink("Finanzplan öffnen") { SharedFinance(store: store, workspace: workspace, grant: grant) }
                            } else {
                                Button("Annehmen") { perform("accept", ["id":.string(grant.id)]) }
                            }
                            Button(grant.active == 1 ? "Verlassen" : "Ablehnen", role: .destructive) { removal = grant }
                        }.buttonStyle(.borderless)
                    }
                }
            }
            if !message.isEmpty { Text(message).font(.footnote) }
            if list == nil { Button("Freigaben laden") { Task { await refresh() } } }
        }.disabled(busy).task { await refresh() }.refreshable { await refresh() }
        .alert("Freigabe beenden?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), presenting: removal) { grant in
            Button("Beenden", role: .destructive) { perform("remove", ["id":.string(grant.id)]) }
            Button("Abbrechen", role: .cancel) {}
        } message: { grant in Text("\(workspace.title) · \(grant.email)") }
    }

    private func refresh() async {
        do { list = try await store.sharing("list", workspace: workspace) }
        catch { list = nil; message = error.localizedDescription }
    }

    private func perform(_ action: String, _ fields: Record) {
        busy = true
        Task {
            defer { busy = false }
            do {
                let reply: Acknowledged = try await store.sharing(action, workspace: workspace, fields: fields)
                message = action == "invite" ? (reply.mailed == true ? "Einladung per E-Mail verschickt." : "Einladung angelegt. Teile jetzt den Einladungslink.") : ""
                if action == "invite" { email = "" }
                await refresh()
            } catch { message = error.localizedDescription }
        }
    }
}

private struct SharedFinance: View {
    @ObservedObject var store: NjoraStore
    let workspace: FinanceWorkspace
    let grant: Grant
    @State private var record: SharedPlan?
    @State private var message = ""
    @State private var selection: Selection?
    @Environment(\.scenePhase) private var phase
    private struct Selection: Identifiable {
        let section: PlanSection
        let item: PlanItem
        let snapshot: SharedPlan
        var id: String { section.rawValue + item.id }
    }

    var body: some View {
        List {
            Section { Text(grant.email); Text(grant.permission).font(.footnote) }
            if let record, let plan = record.plan {
                if workspace == .business, !plan.monthlyRevenue.isEmpty {
                    Section("Monatsumsatz") {
                        ForEach(plan.monthlyRevenue.keys.sorted(by: >), id: \.self) { month in
                            LabeledContent(month, value: euros(plan.monthlyRevenue.amount(month)))
                        }
                    }
                }
                ForEach(PlanSection.allCases.filter { workspace == .personal || $0 != .goals }) { section in
                    sectionContent(section, plan: plan, snapshot: record)
                }
            } else if record != nil { Text("In diesem Finanzbereich wurde noch kein Plan angelegt.") }
            if !message.isEmpty { Text(message) }
        }.navigationTitle(workspace.title + " · Geteilt")
        .task { await load() }.refreshable { await load() }
        .onChange(of: phase) { value in if value == .active { Task { await load() } } }
        .sheet(item: $selection) { choice in
            if let plan = choice.snapshot.plan, let revision = choice.snapshot.revision {
                PlanEditor(section: choice.section, item: choice.item, plan: plan, store: store, sharedWorkspace: workspace) { updated in
                    struct Saved: Decodable { let revision: Int }
                    let _: Saved = try await store.sharing("plan", workspace: workspace, fields: [
                        "id":.string(grant.id), "revision":.number(Double(revision)), "plan":.object(updated.storagePlan.fields)
                    ], writePlan: true)
                    await load()
                }
            }
        }
    }

    private func sectionContent(_ section: PlanSection, plan: Plan, snapshot: SharedPlan) -> some View {
        let business = workspace == .business
        let editable = snapshot.role == "edit" && section != .history
        return Section(business && section == .savings ? "Vermögenswerte" : section.title) {
            ForEach(plan.entriesByDueDate(in: section)) { item in
                if section == .history {
                    LabeledContent(item.fields.text("date"), value: item.fields["netBalance"]?.number.map(euros) ?? item.fields.text("note"))
                } else if editable {
                    Button { selection = Selection(section: section, item: item, snapshot: snapshot) } label: {
                        PlanItemRow(item: item, section: section, businessAssets: business, compactLoans: business)
                    }.buttonStyle(.plain)
                } else {
                    PlanItemRow(item: item, section: section, businessAssets: business, compactLoans: business)
                }
            }
            if editable && section != .annual && plan[section].count < section.limit {
                Button(section.addTitle) { selection = Selection(section: section, item: section.newItem, snapshot: snapshot) }
            }
        }
    }

    private func load() async {
        do { record = try await store.sharing("plan", workspace: workspace, fields: ["id":.string(grant.id)]); message = "" }
        catch { record = nil; selection = nil; message = error.localizedDescription }
    }
}
