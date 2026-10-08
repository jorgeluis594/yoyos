#!/usr/bin/env ruby
require 'xcodeproj'

project_path = File.expand_path(ARGV.fetch(0))
module_path = File.expand_path('..', __dir__)
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'WhatsAppNativeProbe' }
abort 'Expo probe app target is missing' unless app
abort 'Storage test target already exists' if project.targets.any? { |target| target.name == 'WhatsAppStateStoreHostTests' }

target = project.new_target(:unit_test_bundle, 'WhatsAppStateStoreHostTests', :ios, '16.4', nil, :swift)
target.add_dependency(app)
group = project.new_group('WhatsApp Storage Tests')
%w[Storage/StrictStateJSON.swift Storage/NativeStateStore.swift Tests/WhatsAppBridgeTests/StateStoreTests.swift].each do |file|
  path = File.join(module_path, 'ios', file)
  abort "Missing source: #{path}" unless File.file?(path)
  target.source_build_phase.add_file_reference(group.new_file(path, :absolute))
end

target.build_configurations.each do |configuration|
  settings = configuration.build_settings
  settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
  settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/WhatsAppNativeProbe.app/WhatsAppNativeProbe'
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.yoyos.whatsappnativeprobe.storagetests'
  settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) WA02_APP_HOSTED'
  settings['SWIFT_VERSION'] = '6.0'
  settings['CODE_SIGNING_ALLOWED'] = 'YES'
  settings['CODE_SIGN_IDENTITY'] = '-'
end

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(target, false)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'WhatsAppStateStoreHostTests', true)

entitlements = File.join(File.dirname(project_path), 'WhatsAppNativeProbe', 'WhatsAppNativeProbe.entitlements')
abort 'Expo probe entitlements file is missing' unless File.file?(entitlements)
File.write(entitlements, <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>application-identifier</key><string>$(AppIdentifierPrefix)com.yoyos.whatsappnativeprobe</string>
    <key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)com.yoyos.whatsappnativeprobe</string></array>
  </dict></plist>
PLIST
