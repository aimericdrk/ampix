/// MyAmpix Flutter purchases SDK — RevenueCat-style public surface.
///
/// Model + enum exports are added by the P3.1 model tasks; the facade,
/// configuration, and log-level exports are added by P3.3.
library;

export 'src/models/customer_info.dart' show CustomerInfo;
export 'src/models/entitlement_info.dart' show EntitlementInfo, EntitlementInfos;
export 'src/models/enums.dart'
    show OwnershipType, PackageType, PeriodType, ProductType, Store;
export 'src/models/login_result.dart' show LogInResult;
export 'src/models/offering.dart' show Offering;
export 'src/models/offerings.dart' show Offerings;
export 'src/models/package.dart' show Package;
export 'src/models/purchase_result.dart' show PurchaseResult, StoreTransaction;
export 'src/models/purchases_error.dart' show PurchasesError, PurchasesErrorCode;
export 'src/models/store_product.dart' show StoreProduct;
export 'src/version.dart';
