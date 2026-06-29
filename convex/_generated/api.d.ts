/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as coupons from "../coupons.js";
import type * as dev from "../dev.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as kitchen from "../kitchen.js";
import type * as menu from "../menu.js";
import type * as orders from "../orders.js";
import type * as sessions from "../sessions.js";
import type * as stores from "../stores.js";
import type * as stripe from "../stripe.js";
import type * as surveys from "../surveys.js";
import type * as tables from "../tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  auth: typeof auth;
  coupons: typeof coupons;
  dev: typeof dev;
  emails: typeof emails;
  http: typeof http;
  kitchen: typeof kitchen;
  menu: typeof menu;
  orders: typeof orders;
  sessions: typeof sessions;
  stores: typeof stores;
  stripe: typeof stripe;
  surveys: typeof surveys;
  tables: typeof tables;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
