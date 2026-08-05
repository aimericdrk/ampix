export const RC_INITIAL = '$rc_initial_purchase';
export const RC_RENEWAL = '$rc_renewal';
export const RC_EXPIRATION = '$rc_expiration';
export const RC_CANCELLATION = '$rc_cancellation';
export const RC_NON_RENEWING = '$rc_non_renewing_purchase';
// `$rc_link` is an SDK identity event (re-emitted on every identify() when a RevenueCat link is
// set), not a subscription lifecycle event — excluded from the `$rc_%` lifecycle scans below.
export const RC_LINK_EVENT = '$rc_link';
export const PRICE_EXPR = "JSONExtractFloat(toJSONString(properties), '$price')";
export const PERIOD_EXPR = "JSONExtractString(toJSONString(properties), '$rc_period_type')";
export const PRODUCT_ID_EXPR = "JSONExtractString(toJSONString(properties), '$product_id')";
export const EXPIRATION_REASON_EXPR = "JSONExtractString(toJSONString(properties), '$rc_expiration_reason')";
export const CANCEL_REASON_EXPR = "JSONExtractString(toJSONString(properties), '$rc_cancel_reason')";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const RECENT_EVENTS_LIMIT = 20;

/** Fixed display order for `time_to_convert` buckets — CH's `GROUP BY bucket` has no guaranteed order. */
export const TIME_TO_CONVERT_BUCKET_ORDER = ['<1d', '1-3d', '3-7d', '7-14d', '14-30d', '30d+'];
