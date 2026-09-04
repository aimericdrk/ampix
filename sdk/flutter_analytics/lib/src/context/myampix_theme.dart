/// The app's effective color scheme, as declared by the host through
/// `MyAmpix.setTheme`.
///
/// Only needed by apps that let the user pick an appearance in-app: without a
/// declaration the SDK reports the PLATFORM brightness, which is the right
/// answer only while the app follows the system. An app whose own setting is
/// "always light" on a dark phone would otherwise be recorded as dark.
enum MyAmpixTheme {
  light,
  dark;

  /// The value sent on the wire as `context.theme`.
  String get wireValue => name;
}
