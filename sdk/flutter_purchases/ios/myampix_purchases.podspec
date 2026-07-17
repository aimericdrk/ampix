#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint myampix_purchases.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'myampix_purchases'
  s.version          = '0.1.0'
  s.summary          = 'MyAmpix Flutter purchases SDK — native iOS StoreKit 2 layer.'
  s.description      = <<-DESC
Native StoreKit 2 store-operation layer for the MyAmpix Flutter purchases SDK
(a RevenueCat-style client for the mobile_purchase server). Fetches products,
runs purchases with appAccountToken self-attribution, streams
Transaction.updates, finishes transactions after the server grants, and
replays currentEntitlements for restore. Holds no server URL/key; does no HTTP.
                       DESC
  s.homepage         = 'https://myampix.dev'
  s.license          = { :type => 'Proprietary', :text => 'See project root' }
  s.author           = { 'MyAmpix' => 'engineering@myampix.dev' }
  s.source           = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform = :ios, '15.0'

  # Flutter.framework does not contain an i386 slice. StoreKit 2 (async
  # Product/Transaction APIs) requires the iOS 15 deployment target above.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
  s.swift_version = '5.0'
end
