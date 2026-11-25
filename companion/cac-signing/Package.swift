// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DonDocsCAC",
    platforms: [.macOS(.v12)],
    products: [.executable(name: "DonDocsCAC", targets: ["DonDocsCAC"])],
    targets: [
        .executableTarget(name: "DonDocsCAC"),
        .testTarget(name: "DonDocsCACTests", dependencies: ["DonDocsCAC"]),
    ]
)
