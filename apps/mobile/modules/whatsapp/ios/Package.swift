// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "WhatsAppBridgeTests",
  platforms: [.iOS("16.4")],
  products: [],
  targets: [
    .binaryTarget(name: "WhatsAppGo", path: "Frameworks/WhatsAppGo.xcframework"),
    .target(name: "WhatsAppStateStore", path: "Storage"),
    .testTarget(name: "WhatsAppBridgeTests", dependencies: ["WhatsAppGo", "WhatsAppStateStore"]),
  ]
)
