import 'package:flutter/material.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../state/event_log.dart';

/// A hardcoded promo for the Deals screen.
class DemoPromo {
  const DemoPromo({
    required this.code,
    required this.title,
    required this.discountPct,
  });

  final String code;
  final String title;
  final int discountPct;
}

const List<DemoPromo> demoPromos = [
  DemoPromo(code: 'SUMMER15', title: 'Summer sale — everything', discountPct: 15),
  DemoPromo(code: 'AUDIO20', title: '20% off all Audio', discountPct: 20),
  DemoPromo(code: 'FREESHIP', title: 'Free shipping over \$50', discountPct: 0),
];

/// Deals screen, pushed from the catalog banner (`catalog/deals`).
///
/// SDK calls: `track('deals_viewed')` on load; `track('promo_claimed')` +
/// `people.set({'last_promo': code})` when a promo is claimed.
class DealsScreen extends StatefulWidget {
  const DealsScreen({super.key});

  @override
  State<DealsScreen> createState() => _DealsScreenState();
}

class _DealsScreenState extends State<DealsScreen> {
  final Set<String> _claimed = {};

  @override
  void initState() {
    super.initState();
    final properties = {'promo_count': demoPromos.length};
    MyAmpix.instance.track('deals_viewed', properties: properties);
    EventLog.instance.log('track("deals_viewed")', properties);
  }

  void _claim(DemoPromo promo) {
    setState(() => _claimed.add(promo.code));
    final properties = {
      'promo_code': promo.code,
      'discount_pct': promo.discountPct,
    };
    MyAmpix.instance.track('promo_claimed', properties: properties);
    MyAmpix.instance.people.set({'last_promo': promo.code});
    EventLog.instance.log(
      'track("promo_claimed") + people.set({"last_promo": "${promo.code}"})',
      properties,
    );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Code ${promo.code} applied at checkout (demo)')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deals')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final promo in demoPromos)
            Card(
              child: ListTile(
                leading: const Icon(Icons.local_offer_outlined),
                title: Text(promo.title),
                subtitle: Text(promo.code),
                trailing: _claimed.contains(promo.code)
                    ? const Icon(Icons.check, color: Colors.green)
                    : FilledButton.tonal(
                        onPressed: () => _claim(promo),
                        child: const Text('Claim'),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}
