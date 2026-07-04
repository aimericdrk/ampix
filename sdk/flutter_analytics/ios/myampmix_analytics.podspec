#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint myampmix_analytics.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'myampmix_analytics'
  s.version          = '0.1.0'
  s.summary          = 'MyAmpMix Flutter analytics SDK — native platform plumbing.'
  s.description      = <<-DESC
Native (StoreKit) plumbing for the MyAmpMix Flutter analytics SDK's
automatic in-app-purchase (`$in_app_purchase`) autocapture.
                       DESC
  s.homepage         = 'https://myampmix.dev'
  s.license          = { :type => 'Proprietary', :text => 'See project root' }
  s.author           = { 'MyAmpMix' => 'engineering@myampmix.dev' }
  s.source           = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform = :ios, '13.0'

  # Flutter.framework does not contain a i386 slice.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'
end
