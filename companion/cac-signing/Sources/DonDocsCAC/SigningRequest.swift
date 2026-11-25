import CryptoKit
import Foundation

enum SigningFailure: Int32, Error {
    case signingFailed = 1
    case canceled = 2
    case cardUnavailable = 3
    case invalidRequest = 4

    var message: String {
        switch self {
        case .signingFailed: return "The signing operation failed."
        case .canceled: return "CAC signing canceled."
        case .cardUnavailable: return "The selected CAC signing identity is no longer available."
        case .invalidRequest: return "Invalid CAC signing request."
        }
    }
}

struct SigningRequest: Decodable {
    let version: Int
    let purpose: String
    let certificateSHA256: String

    static func parse(_ json: String) throws -> Self {
        guard json.utf8.count <= 4096,
              let request = try? JSONDecoder().decode(Self.self, from: Data(json.utf8)),
              request.version == 1,
              validLabel(request.purpose),
              validHash(request.certificateSHA256)
        else { throw SigningFailure.invalidRequest }
        return request
    }

    private static func validLabel(_ value: String) -> Bool {
        let forbidden = CharacterSet.controlCharacters.union(.newlines).union(.illegalCharacters)
        return (1...160).contains(value.utf8.count)
            && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
            && value.rangeOfCharacter(from: forbidden) == nil
    }

    private static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    func confirmation(signer: String, data: Data) -> String {
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return [
            "Request from caller: " + purpose, "Certificate: " + signer,
            "Certificate fingerprint: " + certificateSHA256,
            "Data to sign (SHA-256): " + digest,
        ].joined(separator: "\n")
    }
}

// A pipe may return short reads. Stop at one byte over the limit even if the
// caller keeps it open or has more input waiting.
func readSigningData(read: (Int) throws -> Data?) throws -> Data {
    let limit = 16_384
    var data = Data()
    while data.count <= limit {
        guard let chunk = try read(limit + 1 - data.count), !chunk.isEmpty else { break }
        data.append(chunk)
    }
    guard !data.isEmpty, data.count <= limit else { throw SigningFailure.invalidRequest }
    return data
}

func authorizeAndSign<Identity>(
    _ request: SigningRequest, data: Data,
    lookup: (String) throws -> Identity?,
    approve: (SigningRequest, Identity, Data) -> Bool,
    sign: (Identity, Data) throws -> Data
) throws -> Data {
    guard let selected = try lookup(request.certificateSHA256) else { throw SigningFailure.cardUnavailable }
    guard approve(request, selected, data) else { throw SigningFailure.canceled }
    // Card removal or replacement while the user is reading the dialog must
    // never switch this request to a different identity.
    guard let current = try lookup(request.certificateSHA256) else { throw SigningFailure.cardUnavailable }
    return try sign(current, data)
}
