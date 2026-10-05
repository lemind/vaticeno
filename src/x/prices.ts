// X API pay-per-use list prices (USD), from docs.x.com/x-api/getting-started/pricing, read 2026-10-05.
// UNRECONCILED: never checked against an invoice. Billing is per resource returned, not per request:
// a timeline page of 5 posts costs 5 reads.
export const X_POST_READ_USD = 0.005;
export const X_POST_CREATE_USD = 0.015;
// X publishes no repost price. Billed as a post until the dry run measures it (spec 002 SC-002).
// REVISIT: compare the first month's invoice with the recorded `feed_post` rows.
export const X_REPOST_USD = X_POST_CREATE_USD;
export const X_USER_READ_USD = 0.01;
