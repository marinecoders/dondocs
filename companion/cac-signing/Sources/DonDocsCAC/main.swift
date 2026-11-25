import AppKit
import CryptoTokenKit
import CryptoKit
import Darwin
import Foundation
import Security

private struct SigningIdentity {
    let certificate: SecCertificate
    let key: SecKey
    let fingerprint: String
}

private struct PublicIdentity: Encodable {
    let fingerprint: String
    let certificate: Data
    let chain: [Data]
}

// A missing item is normal when a card is removed during discovery.
func copyKeychainItem<Item>(_ copy: (inout Item?) -> OSStatus) throws -> Item? {
    var item: Item?
    let status = copy(&item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else {
        throw classifyCardError(NSError(domain: NSOSStatusErrorDomain, code: Int(status)))
    }
    guard let item else { throw SigningFailure.signingFailed }
    return item
}

private func cardIdentities(matching selectedFingerprint: String? = nil) throws -> [SigningIdentity] {
    let query: [String: Any] = [
        kSecClass as String: kSecClassIdentity,
        kSecReturnRef as String: true,
        kSecMatchLimit as String: kSecMatchLimitAll,
    ]
    guard let result: CFTypeRef = try copyKeychainItem({ SecItemCopyMatching(query as CFDictionary, &$0) })
    else { return [] }
    guard let identities = result as? [SecIdentity] else { throw SigningFailure.signingFailed }
    return try identities.compactMap { identity in
        guard let certificate: SecCertificate = try copyKeychainItem({ SecIdentityCopyCertificate(identity, &$0) })
        else { return nil }
        let hash = SHA256.hash(data: SecCertificateCopyData(certificate) as Data)
        let fingerprint = hash.map { String(format: "%02x", $0) }.joined()
        if let selectedFingerprint, selectedFingerprint != fingerprint { return nil }
        guard let key: SecKey = try copyKeychainItem({ SecIdentityCopyPrivateKey(identity, &$0) })
        else { return nil }
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any] else {
            throw SigningFailure.signingFailed
        }
        guard let token = attributes[kSecAttrTokenID as String] as? String,
              token.hasPrefix("com.apple.pivtoken:"),
              SecKeyIsAlgorithmSupported(key, .sign, .rsaSignatureMessagePKCS1v15SHA256) else { return nil }
        return SigningIdentity(certificate: certificate, key: key, fingerprint: fingerprint)
    }
}

private func publicIdentity(_ identity: SigningIdentity) -> PublicIdentity {
    var chain: [Data] = []
    var trust: SecTrust?
    if SecTrustCreateWithCertificates(identity.certificate, SecPolicyCreateBasicX509(), &trust) == errSecSuccess,
       let trust {
        SecTrustSetNetworkFetchAllowed(trust, false)
        _ = SecTrustEvaluateWithError(trust, nil)
        let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate] ?? []
        chain = certificates.dropFirst().map { SecCertificateCopyData($0) as Data }
    }
    return PublicIdentity(fingerprint: identity.fingerprint, certificate: SecCertificateCopyData(identity.certificate) as Data, chain: chain)
}

private func approve(_ request: SigningRequest, identity: SigningIdentity, data: Data) -> Bool {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Authorize a CAC signature?"
    let signer = SecCertificateCopySubjectSummary(identity.certificate) as String? ?? "CAC signing certificate"
    alert.informativeText = request.confirmation(signer: signer, data: data)
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Sign with CAC")
    alert.buttons.first?.keyEquivalent = "\u{1b}"
    return alert.runModal() == .alertSecondButtonReturn
}

func signMessage(_ data: Data, using key: SecKey) throws -> Data {
    var error: Unmanaged<CFError>?
    if let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, &error) {
        return signature as Data
    }
    if let error = error?.takeRetainedValue() {
        throw classifyCardError(error as Error as NSError)
    }
    throw SigningFailure.signingFailed
}

func classifyCardError(_ error: NSError) -> SigningFailure {
    let errors = [error, error.userInfo[NSUnderlyingErrorKey] as? NSError].compactMap { $0 }
    for cause in errors {
        switch (cause.domain, cause.code) {
        case (NSOSStatusErrorDomain, Int(errSecUserCanceled)), (TKErrorDomain, TKError.Code.canceledByUser.rawValue):
            return .canceled
        case (NSOSStatusErrorDomain, Int(errSecItemNotFound)), (TKErrorDomain, TKError.Code.tokenNotFound.rawValue),
             (TKErrorDomain, TKError.Code.objectNotFound.rawValue):
            return .cardUnavailable
        default:
            continue
        }
    }
    return .signingFailed
}

// A disconnected caller is an output error, including when writing a diagnostic.
signal(SIGPIPE, SIG_IGN)
do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["list"] {
        let identities = try cardIdentities().map(publicIdentity)
        try FileHandle.standardOutput.write(contentsOf: JSONEncoder().encode(identities))
    } else if arguments.count == 2, arguments[0] == "sign" {
        let request = try SigningRequest.parse(arguments[1])
        let data = try readSigningData { try FileHandle.standardInput.read(upToCount: $0) }
        let signature = try authorizeAndSign(request, data: data, lookup: { fingerprint in
            try cardIdentities(matching: fingerprint).first
        }, approve: approve, sign: { try signMessage($1, using: $0.key) })
        try FileHandle.standardOutput.write(contentsOf: signature)
    } else {
        throw SigningFailure.invalidRequest
    }
} catch {
    let failure = error as? SigningFailure ?? .signingFailed
    try? FileHandle.standardError.write(contentsOf: Data((failure.message + "\n").utf8))
    exit(failure.rawValue)
}
