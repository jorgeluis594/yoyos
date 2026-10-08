// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "WhatsAppBridgeTests",
  platforms: [.iOS(.v16)],
  products: [],
  targets: [
    .binaryTarget(name: "WhatsAppGo", path: "Frameworks/WhatsAppGo.xcframework"),
    .testTarget(name: "WhatsAppBridgeTests", dependencies: ["WhatsAppGo"]),
  ]
)
