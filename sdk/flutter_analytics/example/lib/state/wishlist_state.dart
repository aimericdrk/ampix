import 'package:flutter/foundation.dart';

import '../models/product.dart';

/// In-memory wishlist for the demo. Same spirit as [CartState]: no
/// persistence, just enough state to demo wishlist events.
class WishlistState extends ChangeNotifier {
  WishlistState._();

  static final WishlistState instance = WishlistState._();

  final List<Product> _items = [];

  List<Product> get items => List.unmodifiable(_items);

  int get itemCount => _items.length;

  bool contains(Product product) =>
      _items.any((item) => item.id == product.id);

  /// Adds [product] if absent, removes it if present. Returns true when the
  /// product ended up ADDED.
  bool toggle(Product product) {
    final added = !contains(product);
    if (added) {
      _items.add(product);
    } else {
      _items.removeWhere((item) => item.id == product.id);
    }
    notifyListeners();
    return added;
  }
}
