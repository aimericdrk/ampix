/// A hardcoded catalog product for the demo shop.
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.price,
    required this.description,
  });

  final String id;
  final String name;
  final double price;
  final String description;
}

/// ~5 hardcoded products shown on the Catalog screen.
const List<Product> demoProducts = [
  Product(
    id: 'p1',
    name: 'Wireless Headphones',
    price: 89.99,
    description: 'Noise-cancelling over-ear headphones with 30h battery.',
  ),
  Product(
    id: 'p2',
    name: 'Mechanical Keyboard',
    price: 129.00,
    description: 'Hot-swappable RGB mechanical keyboard, tenkeyless.',
  ),
  Product(
    id: 'p3',
    name: 'Espresso Grinder',
    price: 59.50,
    description: 'Conical burr grinder tuned for fresh espresso shots.',
  ),
  Product(
    id: 'p4',
    name: 'Running Shoes',
    price: 74.99,
    description: 'Lightweight trainers built for daily road runs.',
  ),
  Product(
    id: 'p5',
    name: 'Smart Water Bottle',
    price: 34.00,
    description: 'Tracks hydration and syncs intake to your phone.',
  ),
];
