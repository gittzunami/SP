/**
 * api.js — Backward-compatibility shim
 * =====================================
 * The API client has moved to core/api/client.js.
 * Existing page-level imports (../api) keep working via this re-export.
 *
 * New code should import from:
 *   import { apiFetch, resetAuthFailed } from "../core/api/client";
 */

export { apiFetch, resetAuthFailed } from "./core/api/client";
