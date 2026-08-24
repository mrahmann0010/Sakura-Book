// Single import surface for the rest of the app and for drizzle-kit.
// Every table and its relations() must be re-exported here, or relational
// queries (db.query.books.findMany({ with: { ... } })) won't resolve.

// ./timestamps is deliberately not re-exported — it's a column helper, not a
// table, and this barrel is passed wholesale to drizzle() as the schema.
export * from "./enums";

export * from "./catalog/publisher";
export * from "./catalog/author";
export * from "./catalog/category";
export * from "./catalog/book";
export * from "./catalog/book-author";
export * from "./catalog/book-category";
export * from "./catalog/review";

export * from "./admin/admin-user";
export * from "./admin/admin-session";
export * from "./admin/audit-log";

export * from "./settings/shop-settings";

export * from "./marketing/coupon";

export * from "./shipping/delivery-region";

export * from "./orders/order";
export * from "./orders/order-item";
export * from "./orders/order-status-history";
export * from "./orders/payment";
export * from "./orders/payment-verification";
