/**
 * Content script for Proof of Commitment extension.
 *
 * Runs on every page. Lightweight — only observes, doesn't modify DOM.
 *
 * Future responsibilities:
 * - Detect order confirmation pages
 * - Detect booking confirmation pages
 * - Trigger zkTLS proof generation for verified purchases
 *
 * For now: does nothing. Placeholder for v0.2.
 */

// Intentionally minimal. The background script handles time tracking.
// This script will be used when we need page-level signals
// (e.g., detecting "Order confirmed" text on checkout pages).

console.log("[Proof of Commitment] Content script loaded");
