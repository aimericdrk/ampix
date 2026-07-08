#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint myampix_analytics.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'myampix_analytics'
  s.version          = '0.1.0'
  s.summary          = 'MyAmpix Flutter analytics SDK — native platform plumbing.'
  s.description      = <<-DESC
Native (StoreKit) plumbing for the MyAmpix Flutter analytics SDK's
automatic in-app-purchase (`$in_app_purchase`) autocapture.
                       DESC
  s.homepage         = 'https://myampix.dev'
  s.license          = { :type => 'Proprietary', :text => 'See project root' }
  s.author           = { 'MyAmpix' => 'engineering@myampix.dev' }
  s.source           = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform = :ios, '13.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'
end
