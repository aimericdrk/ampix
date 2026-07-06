import 'package:flutter/material.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

import 'cart_screen.dart';
import 'catalog_screen.dart';
import 'event_log_screen.dart';
import 'profile_screen.dart';
import 'settings_screen.dart';

/// Hosts the bottom-tab navigation. Each tab is rebuilt fresh whenever it
/// is selected (rather than kept alive via IndexedStack) so a screen's
/// `initState` — and the "on load" / "on entering" tracking calls it
/// makes — fires every time the user actually navigates to that tab,
/// matching real screen-view semantics.
class RootScreen extends StatefulWidget {
  const RootScreen({super.key});

  @override
  State<RootScreen> createState() => _RootScreenState();
}

class _RootScreenState extends State<RootScreen> {
  int _index = 0;

  /// Stable per-tab screen names. Bottom-nav switches are NOT Navigator route
  /// pushes, so `MyAmpMixObserver` never sees them — without `trackScreen`
  /// every tab would collapse into the single hosting route. One STABLE name
  /// per tab makes each a distinct screen (distinct `$screen_view` + reference
  /// screenshot). The pushed `product_detail` route stays one screen (its
  /// layout is the same for every product; per-product analytics come from the
  /// `product_clicked` event's properties, not a screenshot per product).
  static const _tabNames = ['catalog', 'cart', 'profile', 'settings', 'log'];

  @override
  void initState() {
    super.initState();
    // The initial tab is a screen view the observer can't see either.
    MyAmpMix.instance.trackScreen(_tabNames[_index]);
  }

  void _onTabSelected(int index) {
    setState(() => _index = index);
    MyAmpMix.instance.trackScreen(_tabNames[index]);
  }

  Widget _buildBody() {
    switch (_index) {
      case 0:
        return const CatalogScreen();
      case 1:
        return const CartScreen();
      case 2:
        return const ProfileScreen();
      case 3:
        return const SettingsScreen();
      case 4:
        return const EventLogScreen();
      default:
        return const CatalogScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _buildBody(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: _onTabSelected,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.storefront_outlined),
            selectedIcon: Icon(Icons.storefront),
            label: 'Catalog',
          ),
          NavigationDestination(
            icon: Icon(Icons.shopping_cart_outlined),
            selectedIcon: Icon(Icons.shopping_cart),
            label: 'Cart',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
          NavigationDestination(
            icon: Icon(Icons.list_alt),
            label: 'Log',
          ),
        ],
      ),
    );
  }
}
