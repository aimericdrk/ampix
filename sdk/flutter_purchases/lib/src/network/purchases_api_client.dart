import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/customer_info.dart';
import '../models/offerings.dart';
import '../models/purchases_error.dart';

/// HTTP client for the three `mobile_purchase` public endpoints
/// (`GET /v1/offerings`, `GET /v1/subscribers/:appUserId`,
/// `POST /v1/receipts`), authenticated with the `mp_pub_` public SDK key via
/// `Authorization: Bearer <apiKey>` (server `PublicApiKeyGuard`).
///
/// Every failure is surfaced as a typed [PurchasesError] (design §6): the
/// RFC-7807 HTTP status maps to a [PurchasesErrorCode], and any transport
/// exception (offline/timeout) maps to [PurchasesErrorCode.networkError]. A raw
/// `http`/`SocketException` never escapes to callers.
///
/// `originalAppUserId` and `requestDate` are not part of the server body — the
/// client injects the requested id and a stamped fetch time into every
/// [CustomerInfo] it returns.
class PurchasesApiClient {
  PurchasesApiClient({
    required http.Client client,
    required String serverUrl,
    required String apiKey,
    String Function()? nowIso8601,
  })  : _client = client,
        // A trailing slash would yield `//v1/...`; normalize once, here, at the
        // single place serverUrl is consumed (mirrors Uploader).
        _serverUrl = serverUrl.replaceFirst(RegExp(r'/+$'), ''),
        _apiKey = apiKey,
        _nowIso8601 =
            nowIso8601 ?? (() => DateTime.now().toUtc().toIso8601String());

  final http.Client _client;
  final String _serverUrl;
  final String _apiKey;
  final String Function() _nowIso8601;

  Map<String, String> get _authHeaders => {
        'Accept': 'application/json',
        'Authorization': 'Bearer $_apiKey',
      };

  /// `GET /v1/offerings` → `{ current: ResolvedOffering | null }` → [Offerings].
  Future<Offerings> getOfferings() async =>
      Offerings.fromJson(await _get('/v1/offerings'));

  /// `GET /v1/subscribers/:appUserId` → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> getSubscriber(String appUserId) async => _toCustomerInfo(
        await _get('/v1/subscribers/${Uri.encodeComponent(appUserId)}'),
        appUserId,
      );

  /// `POST /v1/receipts { app_user_id, platform, fetch_token, product_id? }`
  /// → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> postReceipt({
    required String appUserId,
    required String platform,
    required String fetchToken,
    String? productId,
  }) async =>
      _toCustomerInfo(
        await _post('/v1/receipts', <String, Object?>{
          'app_user_id': appUserId,
          'platform': platform,
          'fetch_token': fetchToken,
          'product_id': ?productId,
        }),
        appUserId,
      );

  CustomerInfo _toCustomerInfo(Map<String, dynamic> body, String appUserId) {
    final customer =
        (body['customerInfo'] as Map<String, dynamic>?) ?? const {};
    return CustomerInfo.fromJson(
      customer,
      originalAppUserId: appUserId,
      requestDate: _nowIso8601(),
    );
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final http.Response response;
    try {
      response = await _client.get(
        Uri.parse('$_serverUrl$path'),
        headers: _authHeaders,
      );
    } on Object catch (error) {
      throw _networkError(error);
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, Object?> payload,
  ) async {
    final http.Response response;
    try {
      response = await _client.post(
        Uri.parse('$_serverUrl$path'),
        headers: {..._authHeaders, 'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
    } on Object catch (error) {
      throw _networkError(error);
    }
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode == 200 || response.statusCode == 201) {
      if (response.body.isEmpty) return const {};
      try {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } on Object catch (e) {
        throw PurchasesError(
          PurchasesErrorCode.unknownError,
          'Malformed response body from the purchases API',
          underlyingErrorMessage: e.toString(),
        );
      }
    }
    throw _statusError(response);
  }

  PurchasesError _networkError(Object error) => PurchasesError(
        PurchasesErrorCode.networkError,
        'A network error occurred while communicating with the server.',
        underlyingErrorMessage: '$error',
      );

  PurchasesError _statusError(http.Response response) {
    final code = switch (response.statusCode) {
      401 => PurchasesErrorCode.configurationError,
      402 => PurchasesErrorCode.invalidReceiptError,
      409 => PurchasesErrorCode.productAlreadyPurchasedError,
      503 => PurchasesErrorCode.storeProblemError,
      _ => PurchasesErrorCode.unknownError,
    };
    return PurchasesError(
      code,
      _messageFor(code),
      underlyingErrorMessage: _problemDetail(response.body),
    );
  }

  /// Extracts the RFC-7807 `detail` (falling back to `title`, then the raw
  /// body) for the error's `underlyingErrorMessage`.
  String? _problemDetail(String body) {
    if (body.isEmpty) return null;
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map) {
        final detail = decoded['detail'] ?? decoded['title'];
        return (detail ?? body).toString();
      }
    } on FormatException {
      // Not JSON — surface the raw body verbatim.
    }
    return body;
  }

  String _messageFor(PurchasesErrorCode code) => switch (code) {
        PurchasesErrorCode.configurationError =>
          'There is an issue with your configuration.',
        PurchasesErrorCode.invalidReceiptError => 'The receipt is not valid.',
        PurchasesErrorCode.productAlreadyPurchasedError =>
          'This product is already active for the user.',
        PurchasesErrorCode.storeProblemError =>
          'There was a problem with the store.',
        _ => 'An unknown error occurred.',
      };
}
