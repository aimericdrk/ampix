/// A hardcoded catalog product for the demo shop.
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.price,
    required this.description,
    required this.category,
  });

  final String id;
  final String name;
  final double price;
  final String description;
  final String category;
}

/// Hardcoded products shown on the Catalog screen, spread across a few
/// categories so the nested Category screen has something to filter.
const List<Product> demoProducts = [
  Product(
    id: 'p1',
    name: 'Wireless Headphones',
    price: 89.99,
    description: 'Noise-cancelling over-ear headphones with 30h battery.',
    category: 'Audio',
  ),
  Product(
    id: 'p2',
    name: 'Mechanical Keyboard',
    price: 129.00,
    description: 'Hot-swappable RGB mechanical keyboard, tenkeyless.',
    category: 'Office',
  ),
  Product(
    id: 'p3',
    name: 'Espresso Grinder',
    price: 59.50,
    description: 'Conical burr grinder tuned for fresh espresso shots.',
    category: 'Kitchen',
  ),
  Product(
    id: 'p4',
    name: 'Running Shoes',
    price: 74.99,
    description: 'Lightweight trainers built for daily road runs.',
    category: 'Sport',
  ),
  Product(
    id: 'p5',
    name: 'Smart Water Bottle',
    price: 34.00,
    description: 'Tracks hydration and syncs intake to your phone.',
    category: 'Sport',
  ),
  Product(
    id: 'p6',
    name: 'Bluetooth Speaker',
    price: 49.99,
    description: 'Pocket-sized waterproof speaker with punchy bass.',
    category: 'Audio',
  ),
  Product(
    id: 'p7',
    name: 'Standing Desk Mat',
    price: 42.00,
    description: 'Anti-fatigue mat for long standing-desk sessions.',
    category: 'Office',
  ),
  Product(
    id: 'p8',
    name: 'Pour-Over Kettle',
    price: 64.90,
    description: 'Gooseneck kettle with precise temperature control.',
    category: 'Kitchen',
  ),
];

/// Distinct categories, in first-seen order.
List<String> demoCategories() {
  final seen = <String>[];
  for (final product in demoProducts) {
    if (!seen.contains(product.category)) seen.add(product.category);
  }
  return seen;
}
