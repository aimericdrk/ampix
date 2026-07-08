/// MyAmpix Flutter analytics SDK.
///
/// Public surface per shared-contracts §8, including the milestone M2
/// autocapture widgets (MyAmpixObserver, MyAmpixTracker).
library;

export 'src/autocapture/myampix_observer.dart' show MyAmpixObserver;
export 'src/autocapture/myampix_privacy.dart' show MyAmpixPrivacy;
export 'src/autocapture/myampix_tracker.dart' show MyAmpixTracker;
export 'src/autocapture/screenshot_capturer.dart'
    show CapturedScreenshot, ScreenshotCapturer;
export 'src/config.dart';
export 'src/myampix.dart' show MyAmpix, SdkOverrides;
export 'src/people.dart' show People;
export 'src/version.dart';
