import 'package:flutter/foundation.dart';

import '../models/product.dart';

/// In-memory shopping cart for the demo. Deliberately simple: no
/// persistence, no quantities — just a list of products added.
class CartState extends ChangeNotifier {
  CartState._();

  static final CartState instance = CartState._();

  final List<Product> _items = [];

  List<Product> get items => List.unmodifiable(_items);

  int get itemCount => _items.length;

  double get total => _items.fold(0.0, (sum, product) => sum + product.price);

  void add(Product product) {
    _items.add(product);
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}
