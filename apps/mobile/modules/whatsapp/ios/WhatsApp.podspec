Pod::Spec.new do |s|
  s.name = 'WhatsApp'
  s.version = '0.1.0'
  s.summary = 'Local WhatsApp Go bridge for Yoyos'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Yoyos'
  s.homepage = 'https://github.com/jorgeluis594/yoyos'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.source_files = 'WhatsAppModule.swift', 'Storage/*.swift'
  s.vendored_frameworks = 'Frameworks/WhatsAppGo.xcframework'
  s.dependency 'ExpoModulesCore'
  unless File.directory?(File.join(__dir__, 'Frameworks/WhatsAppGo.xcframework'))
    raise 'WhatsAppGo.xcframework is missing; run modules/whatsapp/scripts/build-go.sh ios before pod install'
  end
end
