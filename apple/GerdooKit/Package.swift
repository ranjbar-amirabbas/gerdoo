// swift-tools-version: 6.0
import PackageDescription

// macOS is in the platform list purely so `swift test` runs the ported logic
// from the command line, without booting a simulator. Nothing ships there.
let package = Package(
  name: "GerdooKit",
  platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [
    .library(name: "GerdooKit", targets: ["GerdooKit"])
  ],
  targets: [
    .target(
      name: "GerdooKit",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "GerdooKitTests",
      dependencies: ["GerdooKit"],
      swiftSettings: [.swiftLanguageMode(.v5)]
    )
  ]
)
