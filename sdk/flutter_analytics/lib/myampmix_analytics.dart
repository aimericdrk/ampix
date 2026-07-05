/// MyAmpMix Flutter analytics SDK.
///
/// Public surface per shared-contracts §8, including the milestone M2
/// autocapture widgets (MyAmpMixObserver, MyAmpMixTracker).
library;

export 'src/autocapture/myampmix_observer.dart' show MyAmpMixObserver;
export 'src/autocapture/myampmix_privacy.dart' show MyAmpMixPrivacy;
export 'src/autocapture/myampmix_tracker.dart' show MyAmpMixTracker;
export 'src/autocapture/screenshot_capturer.dart'
    show CapturedScreenshot, ScreenshotCapturer;
export 'src/config.dart';
export 'src/myampmix.dart' show MyAmpMix, SdkOverrides;
export 'src/people.dart' show People;
export 'src/version.dart';
