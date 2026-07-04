import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import '../state/event_log.dart';
import '../state/session_state.dart';

/// Profile screen: fake login/logout.
///
/// SDK calls: `identify(userId)` + `people.set({'email', 'name'})` on
/// "Log in"; `reset()` on "Log out".
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  void _login() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final name = _nameController.text.trim();
    final email = _emailController.text.trim();
    // Fake login: the email is a stable, human-readable stand-in for a
    // real backend user id.
    final userId = email;
    MyAmpMix.instance.identify(userId);
    MyAmpMix.instance.people.set({'email': email, 'name': name});
    SessionState.instance.login(userId: userId, email: email, name: name);
    EventLog.instance.log('identify(...) + people.set({"email", "name"})', {
      'userId': userId,
    });
    _nameController.clear();
    _emailController.clear();
  }

  void _logout() {
    MyAmpMix.instance.reset();
    SessionState.instance.logout();
    EventLog.instance.log('reset()');
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: SessionState.instance,
      builder: (context, _) {
        final session = SessionState.instance;
        return Scaffold(
          appBar: AppBar(title: const Text('Profile')),
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: session.isLoggedIn
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Logged in as ${session.name}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text(session.email ?? ''),
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _logout,
                        child: const Text('Log out'),
                      ),
                    ],
                  )
                : Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextFormField(
                          controller: _nameController,
                          decoration: const InputDecoration(labelText: 'Name'),
                          validator: (value) =>
                              (value == null || value.trim().isEmpty)
                              ? 'Enter a name'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _emailController,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                          ),
                          keyboardType: TextInputType.emailAddress,
                          validator: (value) =>
                              (value == null || value.trim().isEmpty)
                              ? 'Enter an email'
                              : null,
                        ),
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: _login,
                          child: const Text('Log in'),
                        ),
                      ],
                    ),
                  ),
          ),
        );
      },
    );
  }
}
