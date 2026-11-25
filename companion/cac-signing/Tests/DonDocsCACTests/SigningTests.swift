import CryptoTokenKit
import Foundation
import Security
import Testing
@testable import DonDocsCAC

private let fingerprint = String(repeating: "a", count: 64)

private func request(_ overrides: [String: Any] = [:]) throws -> SigningRequest {
    let fields: [String: Any] = [
        "version": 1, "certificateSHA256": fingerprint, "purpose": "Approve synthetic record",
    ]
    let data = try JSONSerialization.data(withJSONObject: fields.merging(overrides) { _, new in new })
    return try SigningRequest.parse(String(decoding: data, as: UTF8.self))
}

@Test func approvalIdentifiesTheSelectedCardAndExactPayload() throws {
    let parsed = try request()
    let data = Data("abc".utf8)
    let signature = try authorizeAndSign(parsed, data: data, lookup: { hash in
        #expect(hash == fingerprint)
        return "Test signer"
    }, approve: { context, identity, payload in
        let displayed = context.confirmation(signer: identity, data: payload)
        for value in ["Approve synthetic record", identity, fingerprint,
                      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"] {
            #expect(displayed.contains(value))
        }
        return true
    }, sign: { _, received in
        #expect(received == data)
        return Data([42])
    })
    #expect(signature == Data([42]))
}

@Test func rejectsMalformedRequests() throws {
    for bad: [String: Any] in [
        ["version": 2], ["purpose": "A\nB"], ["purpose": ""], ["purpose": "   "],
        ["certificateSHA256": String(repeating: "g", count: 64)],
        ["purpose": String(repeating: "A", count: 4097)],
    ] {
        #expect(throws: SigningFailure.invalidRequest) { try request(bad) }
    }
    #expect(throws: SigningFailure.invalidRequest) { try SigningRequest.parse("{}") }
}

@Test func inputLimitIncludesFragmentedReads() throws {
    for size in [0, 1, 16_384, 16_385, 50_000] {
        var consumed = 0
        func read(_ maximum: Int) -> Data? {
            let count = min(size - consumed, maximum, 157)
            consumed += count
            return count == 0 ? nil : Data(repeating: 7, count: count)
        }
        if (1...16_384).contains(size) {
            let data = try readSigningData(read: read)
            #expect(data.count == size)
        } else {
            #expect(throws: SigningFailure.invalidRequest) { try readSigningData(read: read) }
        }
        #expect(consumed == min(size, 16_385))
    }
}

@Test func cancellationAndCardRemovalNeverSign() throws {
    let parsed = try request()
    for (availableReads, consent, expected) in [(2, false, SigningFailure.canceled),
                                                 (0, true, .cardUnavailable), (1, true, .cardUnavailable)] {
        var reads = 0
        var prompts = 0
        #expect(throws: expected) {
            try authorizeAndSign(parsed, data: Data([1]), lookup: { _ -> String? in
                reads += 1
                return reads <= availableReads ? "Selected card" : nil
            }, approve: { _, _, _ in
                prompts += 1
                return consent
            }, sign: { _, _ in
                Issue.record("Unexpected signing call")
                return Data()
            })
        }
        #expect(prompts == (availableReads == 0 ? 0 : 1))
    }
}

@Test func cardErrorsRemainDistinct() {
    let removed = NSError(domain: TKErrorDomain, code: TKError.Code.tokenNotFound.rawValue)
    let wrapped = NSError(domain: NSOSStatusErrorDomain, code: Int(errSecInternalComponent),
                          userInfo: [NSUnderlyingErrorKey: removed])
    #expect(classifyCardError(wrapped) == .cardUnavailable)
    #expect(classifyCardError(NSError(domain: NSOSStatusErrorDomain, code: Int(errSecUserCanceled))) == .canceled)
    #expect(classifyCardError(NSError(domain: TKErrorDomain, code: TKError.Code.authenticationFailed.rawValue)) == .signingFailed)
}

@Test func keychainLookupDistinguishesRemovalFromFailure() throws {
    let found: Int? = try copyKeychainItem { $0 = 7; return errSecSuccess }
    #expect(found == 7)
    let removed: Int? = try copyKeychainItem { _ in errSecItemNotFound }
    #expect(removed == nil)
    for (status, expected) in [(errSecUserCanceled, SigningFailure.canceled),
                               (errSecInteractionNotAllowed, .signingFailed),
                               (errSecSuccess, .signingFailed)] {
        #expect(throws: expected) {
            let _: Int? = try copyKeychainItem { _ in status }
        }
    }
}

@Test func signatureVerifiesOnlyForTheOriginalMessage() throws {
    let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
                                     kSecAttrKeySizeInBits as String: 2048]
    let key = try #require(SecKeyCreateRandomKey(attributes as CFDictionary, nil))
    let publicKey = try #require(SecKeyCopyPublicKey(key))
    for count in [1, 32, 16_384] {
        var data = Data(repeating: 0x42, count: count)
        let signature = try signMessage(data, using: key) as CFData
        #expect(SecKeyVerifySignature(publicKey, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, signature, nil))
        data[0] ^= 1
        #expect(!SecKeyVerifySignature(publicKey, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, signature, nil))
    }
}

private final class TestBundleMarker: NSObject {}

@Test func disconnectedOutputPreservesExitStatus() throws {
    let executable = Bundle(for: TestBundleMarker.self).bundleURL
        .deletingLastPathComponent().appendingPathComponent("DonDocsCAC")
    func run(_ command: String, stdout: FileHandle, stderr: FileHandle) throws -> Int32 {
        let process = Process()
        process.executableURL = executable
        process.arguments = [command]
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()
        #expect(process.terminationReason == .exit)
        return process.terminationStatus
    }

    let pipe = Pipe()
    try pipe.fileHandleForReading.close()
    let readOnly = try FileHandle(forReadingFrom: URL(fileURLWithPath: "/dev/null"))
    defer { try? readOnly.close() }
    for output in [pipe.fileHandleForWriting, readOnly] {
        #expect(try run("list", stdout: output, stderr: .nullDevice) == SigningFailure.signingFailed.rawValue)
        #expect(try run("unknown", stdout: .nullDevice, stderr: output) == SigningFailure.invalidRequest.rawValue)
    }
}
