import Foundation
import Security

func isRequestCancellation(_ error: Error) -> Bool {
    error is CancellationError || (error as? URLError)?.code == .cancelled
}

struct APIError: LocalizedError {
    let status: Int
    let message: String
    let code: String?
    var errorDescription: String? { message }

    init(_ status: Int, _ message: String, code: String? = nil) {
        self.status = status
        self.message = message
        self.code = code
    }
}

struct BillingStatus: Codable, Equatable {
    let active: Bool
    let accountToken: UUID
    let provider: String?
}

struct ClosingPrices: Decodable {
    static let venue = "Cboe Europe (DXE) · Schlusskurs"
    let asOf: String
    let prices: [String: Double]

    static func isin(_ item: PlanItem) -> String? {
        let symbol = item.fields.text("symbol").uppercased()
        guard item.fields.text("kind") == "security",
              symbol.range(of: #"^[A-Z]{2}[A-Z0-9]{9}[0-9]$"#, options: .regularExpression) != nil else { return nil }
        return symbol
    }

    func apply(to plan: inout Plan?) {
        guard var revised = plan, PlanDate.parse(asOf) != nil else { return }
        var changed = false
        let savings = revised[.savings].map { position in
            guard let isin = Self.isin(position), let price = prices[isin], price.isFinite, price > 0 else { return position }
            let fields = position.fields
            let previousDay = String(fields.text("quoteUpdatedAt").prefix(10))
            let venue = fields.text("quoteVenue")
            if previousDay > asOf || (venue == "Manuell" && previousDay == asOf) { return position }
            if venue == Self.venue && previousDay == asOf && fields.amount("priceEur") == price { return position }
            var result = position
            result.fields["quoteVenue"] = .string(Self.venue)
            result.fields["quoteUpdatedAt"] = .string(asOf)
            result.fields["currency"] = .string("EUR")
            result.fields["price"] = .number(price)
            result.fields["priceEur"] = .number(price)
            changed = true
            return result
        }
        if changed { revised[.savings] = savings; plan = revised }
    }
}

enum FinanceWorkspace: String, CaseIterable {
    case personal, business
    var title: String { self == .personal ? "Privat" : "Business" }
    var endpoint: String { self == .personal ? "/api/account" : "/api/account/business" }
}

struct AccountPayload: Decodable {
    var workspace: String? = nil
    var closingPrices: ClosingPrices? = nil
    let billing: BillingStatus?
    struct User: Codable, Equatable {
        let displayName: String
        let email: String
        var accountCreatedAt: String? = nil
    }
    let authenticated: Bool
    let user: User
    let plan: Plan?
    let revision: Int?
}

struct EmailAction: Identifiable {
    enum Kind { case confirmation, reset }
    let kind: Kind
    let token: String
    var id: String { token }
    var title: String { kind == .confirmation ? "E-Mail bestätigen" : "Neues Passwort" }
    var endpoint: String { kind == .confirmation ? "/api/auth/verify-email" : "/api/auth/reset-password" }

    init?(link: String) {
        guard let url = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host == "njora.de", url.user == nil, url.password == nil, url.port == nil else { return nil }
        switch url.path {
        case "/email-bestaetigen": kind = .confirmation
        case "/passwort-zuruecksetzen": kind = .reset
        default: return nil
        }
        var fragment = URLComponents()
        fragment.percentEncodedQuery = url.percentEncodedFragment
        guard let value = fragment.queryItems?.first(where: { $0.name == "token" })?.value,
              value.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil else { return nil }
        token = value
    }
}

private enum SessionKeychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "de.njora.finanzueberblick.session",
        kSecAttrAccount as String: "njora.de"
    ]

    static func read() throws -> String? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let stored = String(data: data, encoding: .utf8) else {
            let message = status == errSecInteractionNotAllowed
                ? "Entsperre dein Gerät, um den geschützten Finanzplan zu öffnen."
                : "Deine gespeicherte Anmeldung konnte nicht gelesen werden. Versuche es erneut."
            throw APIError(0, message)
        }
        return stored
    }

    static func write(_ token: String) throws {
        let data = Data(token.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard update == errSecItemNotFound, SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw APIError(0, "Deine Anmeldung konnte nicht sicher gespeichert werden.")
        }
    }

    static func clear() { SecItemDelete(query as CFDictionary) }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor NjoraAPI {
    static let origin = "https://njora.de"
    private static let cookieName = "__Host-njora_session"
    private var token: String?
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(configuration config: URLSessionConfiguration = .ephemeral, token: String? = nil) {
        self.token = token
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }

    func restoreSessionID() throws -> String? {
        if token == nil { token = try SessionKeychain.read() }
        return sessionID()
    }

    func sessionID() -> String? { token.map(LocalPlanDisk.key) }
    func clearSession() { token = nil; SessionKeychain.clear() }

    func login(email: String, password: String) async throws {
        try await authenticate("/api/auth/login", fields: ["email": .string(email), "password": .string(password)])
    }

    func sendMail(_ action: String, email: String) async throws -> String {
        struct Reply: Decodable { let message: String }
        let reply: Reply = try await request("/api/auth/\(action)", method: "POST", body: ["email": .string(email)], includeSession: false)
        return reply.message
    }

    func finish(_ action: EmailAction, password: String) async throws {
        try await authenticate(action.endpoint, fields: ["token": .string(action.token), "password": .string(password)])
    }

    func account(session: String, workspace: FinanceWorkspace = .personal, positions: [PlanItem] = []) async throws -> AccountPayload {
        let symbols = Set(positions.compactMap(ClosingPrices.isin)).sorted().joined(separator: ",")
        let (data, _) = try await send(workspace.endpoint, method: "GET", body: nil, expectedSession: session, closingSymbols: symbols)
        let reply = try decoder.decode(AccountPayload.self, from: data)
        guard workspace == .personal ? reply.workspace != "business" : reply.workspace == "business" else {
            throw APIError(503, "Dieser Finanzbereich ist gerade nicht verfügbar.")
        }
        return reply
    }

    func confirmPurchase(_ transaction: String, environment: String, session: String) async throws -> Bool {
        struct Reply: Decodable { let active: Bool }
        let reply: Reply = try await request("/api/billing", method: "POST", body: [
            "action": .string("apple"), "transaction": .string(transaction), "environment": .string(environment)
        ], expectedSession: session)
        return reply.active
    }

    func save(_ plan: Plan, revision: Int?, session: String, workspace: FinanceWorkspace = .personal) async throws -> Int {
        struct Saved: Decodable { let revision: Int }
        let reply: Saved = try await request(workspace.endpoint, method: "PUT", body: [
            "plan": .object(plan.storagePlan.fields), "revision": revision.map { .number(Double($0)) } ?? .null
        ], expectedSession: session)
        return reply.revision
    }

    func endSession(deleteAccount: Bool) async throws {
        struct Ended: Decodable { let deleted: Bool?; let signedOut: Bool? }
        let _: Ended = try await request(deleteAccount ? "/api/account" : "/api/auth/logout", method: deleteAccount ? "DELETE" : "POST")
        clearSession()
    }

    private func authenticate(_ path: String, fields: Record) async throws {
        struct Authenticated: Decodable { let authenticated: Bool }
        let (data, response) = try await send(path, method: "POST", body: fields, includeSession: false)
        let reply = try decoder.decode(Authenticated.self, from: data)
        guard reply.authenticated,
              let url = response.url,
              let header = response.value(forHTTPHeaderField: "Set-Cookie"),
              let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url)
                .first(where: { $0.name == Self.cookieName && $0.isSecure && $0.path == "/" }),
              cookie.value.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil else {
            throw APIError(0, "Der Njora-Dienst hat keine gültige Sitzung geliefert.")
        }
        try SessionKeychain.write(cookie.value)
        token = cookie.value
    }

    func sharing<T: Decodable>(_ fields: Record, session: String, writePlan: Bool) async throws -> T {
        try await request("/api/sharing", method: writePlan ? "PUT" : "POST", body: fields, expectedSession: session)
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Record? = nil, query: [URLQueryItem] = [], includeSession: Bool = true, expectedSession: String? = nil) async throws -> T {
        let (data, _) = try await send(path, method: method, body: body, query: query, includeSession: includeSession, expectedSession: expectedSession)
        return try decoder.decode(T.self, from: data)
    }

    private func send(_ path: String, method: String, body: Record?, query: [URLQueryItem] = [], includeSession: Bool = true, expectedSession: String? = nil, closingSymbols: String? = nil) async throws -> (Data, HTTPURLResponse) {
        if let expectedSession, expectedSession != sessionID() { throw CancellationError() }
        var components = URLComponents(string: Self.origin)!
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        if let closingSymbols { request.setValue(closingSymbols.isEmpty ? "1" : closingSymbols, forHTTPHeaderField: "X-Njora-Closing-Prices") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.origin, forHTTPHeaderField: "Origin")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if includeSession, let token { request.setValue("\(Self.cookieName)=\(token)", forHTTPHeaderField: "Cookie") }
        let data: Data
        let urlResponse: URLResponse
        do {
            (data, urlResponse) = try await session.data(for: request)
        } catch let error as URLError where (method == "GET" || path == "/api/market/quotes")
                    && [.timedOut, .networkConnectionLost].contains(error.code) {
            try await Task.sleep(nanoseconds: 300_000_000)
            (data, urlResponse) = try await session.data(for: request)
        }
        guard let response = urlResponse as? HTTPURLResponse else { throw APIError(0, "Ungültige Antwort vom Njora-Dienst.") }
        guard (200...299).contains(response.statusCode) else {
            let reply = try? decoder.decode(Record.self, from: data)
            let fallback = response.statusCode == 401 ? "Bitte melde dich erneut an." : "Der Njora-Dienst konnte die Anfrage nicht bearbeiten."
            throw APIError(response.statusCode, reply?.text("error", default: fallback) ?? fallback, code: reply?["code"]?.string)
        }
        return (data, response)
    }
}
