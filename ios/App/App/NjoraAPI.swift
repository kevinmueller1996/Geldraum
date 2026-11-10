import Foundation
import Security

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

struct AccountPayload: Decodable {
    struct User: Decodable { let displayName: String; let email: String }
    let authenticated: Bool
    let user: User
    let plan: Plan?
    let revision: Int?
}

struct SecuritySuggestion: Decodable, Identifiable {
    let symbol: String
    let name: String
    let exchangeName: String
    var id: String { symbol }
}

struct SecurityQuote: Decodable {
    let symbol: String
    let name: String
    let price: Double
    let priceEur: Double
    let currency: String
    let marketTime: String
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

    static func read() -> String? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
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
    private var token = SessionKeychain.read()
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }

    func hasSession() -> Bool { token != nil }
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

    func account() async throws -> AccountPayload { try await request("/api/account") }

    func save(_ plan: Plan, revision: Int?) async throws -> Int {
        struct Saved: Decodable { let revision: Int }
        let reply: Saved = try await request("/api/account", method: "PUT", body: [
            "plan": .object(plan.fields), "revision": revision.map { .number(Double($0)) } ?? .null
        ])
        return reply.revision
    }

    func endSession(deleteAccount: Bool) async throws {
        struct Ended: Decodable { let deleted: Bool?; let signedOut: Bool? }
        let _: Ended = try await request(deleteAccount ? "/api/account" : "/api/auth/logout", method: deleteAccount ? "DELETE" : "POST")
        clearSession()
    }

    func search(_ query: String) async throws -> [SecuritySuggestion] {
        struct Reply: Decodable { let suggestions: [SecuritySuggestion] }
        let reply: Reply = try await request("/api/market/search", query: [URLQueryItem(name: "q", value: query)])
        return reply.suggestions
    }

    func quotes(_ symbols: [String]) async throws -> [SecurityQuote] {
        struct Reply: Decodable { let quotes: [SecurityQuote] }
        var result: [SecurityQuote] = []
        for start in stride(from: 0, to: symbols.count, by: 20) {
            let chunk = symbols[start..<min(start + 20, symbols.count)]
            let reply: Reply = try await request("/api/market/quotes", method: "POST", body: ["symbols": .array(chunk.map(JSONValue.string))])
            result.append(contentsOf: reply.quotes)
        }
        return result
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

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Record? = nil, query: [URLQueryItem] = [], includeSession: Bool = true) async throws -> T {
        let (data, _) = try await send(path, method: method, body: body, query: query, includeSession: includeSession)
        return try decoder.decode(T.self, from: data)
    }

    private func send(_ path: String, method: String, body: Record?, query: [URLQueryItem] = [], includeSession: Bool = true) async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(string: Self.origin)!
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.origin, forHTTPHeaderField: "Origin")
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if includeSession, let token { request.setValue("\(Self.cookieName)=\(token)", forHTTPHeaderField: "Cookie") }
        let (data, urlResponse) = try await session.data(for: request)
        guard let response = urlResponse as? HTTPURLResponse else { throw APIError(0, "Ungültige Antwort vom Njora-Dienst.") }
        guard (200...299).contains(response.statusCode) else {
            let reply = try? decoder.decode(Record.self, from: data)
            throw APIError(response.statusCode, reply?.text("error", default: "Der Njora-Dienst konnte die Anfrage nicht bearbeiten.") ?? "Der Njora-Dienst ist gerade nicht verfügbar.", code: reply?["code"]?.string)
        }
        return (data, response)
    }
}
