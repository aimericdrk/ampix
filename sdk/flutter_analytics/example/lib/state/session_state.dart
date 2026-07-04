import 'package:flutter/foundation.dart';

/// Fake logged-in user state for the demo Profile screen.
class SessionState extends ChangeNotifier {
  SessionState._();

  static final SessionState instance = SessionState._();

  String? userId;
  String? email;
  String? name;

  bool get isLoggedIn => userId != null;

  void login({
    required String userId,
    required String email,
    required String name,
  }) {
    this.userId = userId;
    this.email = email;
    this.name = name;
    notifyListeners();
  }

  void logout() {
    userId = null;
    email = null;
    name = null;
    notifyListeners();
  }
}
