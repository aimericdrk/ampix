import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';
import 'write_review_screen.dart';

/// Reviews screen, pushed FROM product detail — a second-level nested page
/// (`product_detail/reviews`), so the dashboard sees a real navigation
/// hierarchy instead of only top-level screens.
///
/// SDK calls: `track('reviews_viewed')` on load.
class ReviewsScreen extends StatefulWidget {
  const ReviewsScreen({super.key, required this.product});

  final Product product;

  @override
  State<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends State<ReviewsScreen> {
  static const _fakeReviews = [
    (author: 'Alice', rating: 5, text: 'Exactly what I hoped for.'),
    (author: 'Marc', rating: 4, text: 'Solid quality, fast shipping.'),
    (author: 'Nina', rating: 3, text: 'Decent, but a bit overpriced.'),
  ];

  @override
  void initState() {
    super.initState();
    final properties = {
      'product_id': widget.product.id,
      'review_count': _fakeReviews.length,
    };
    MyAmpix.instance.track('reviews_viewed', properties: properties);
    EventLog.instance.log('track("reviews_viewed")', properties);
  }

  void _writeReview() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        // Third navigation level: catalog tab > product_detail > reviews >
        // write. The slash-separated name keeps the hierarchy readable in
        // the dashboard's screen list.
        settings: const RouteSettings(name: 'product_detail/reviews/write'),
        builder: (_) => WriteReviewScreen(product: widget.product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Reviews — ${widget.product.name}')),
      body: ListView(
        children: [
          for (final review in _fakeReviews)
            ListTile(
              leading: CircleAvatar(child: Text(review.author[0])),
              title: Row(
                children: [
                  Text(review.author),
                  const SizedBox(width: 8),
                  for (var i = 0; i < review.rating; i++)
                    const Icon(Icons.star, size: 16, color: Colors.amber),
                ],
              ),
              subtitle: Text(review.text),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton.icon(
            onPressed: _writeReview,
            icon: const Icon(Icons.rate_review_outlined),
            label: const Text('Write a review'),
          ),
        ),
      ),
    );
  }
}
