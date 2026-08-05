import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../models/product.dart';
import '../state/event_log.dart';

/// Write-review screen — the DEEPEST nested page in the demo
/// (`product_detail/reviews/write`, three pushes below the catalog tab).
///
/// SDK calls: `timeEvent('review_submitted')` on load, so the eventual
/// `track('review_submitted')` auto-attaches how long the user spent
/// writing; `people.increment({'reviews_written': 1})` on submit.
class WriteReviewScreen extends StatefulWidget {
  const WriteReviewScreen({super.key, required this.product});

  final Product product;

  @override
  State<WriteReviewScreen> createState() => _WriteReviewScreenState();
}

class _WriteReviewScreenState extends State<WriteReviewScreen> {
  int _rating = 4;
  final _textController = TextEditingController();

  @override
  void initState() {
    super.initState();
    MyAmpix.instance.timeEvent('review_submitted');
    EventLog.instance.log('timeEvent("review_submitted")');
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  void _submit() {
    final properties = {
      'product_id': widget.product.id,
      'rating': _rating,
      'has_text': _textController.text.trim().isNotEmpty,
    };
    MyAmpix.instance.track('review_submitted', properties: properties);
    MyAmpix.instance.people.increment({'reviews_written': 1});
    EventLog.instance.log(
      'track("review_submitted") + people.increment({"reviews_written": 1})',
      properties,
    );
    Navigator.of(context).pop();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Review submitted!')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Write a review')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.product.name,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                for (var star = 1; star <= 5; star++)
                  IconButton(
                    onPressed: () => setState(() => _rating = star),
                    icon: Icon(
                      star <= _rating ? Icons.star : Icons.star_border,
                      color: Colors.amber,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _textController,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Your review (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _submit,
                child: const Text('Submit review'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
