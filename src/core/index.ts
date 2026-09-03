/**
 * Public core API. Domain types, validators, errors, extraction contract,
 * registry, URL utilities, size policy, and source-Markdown serialization.
 * Private validation helpers stay internal (src/core/validation).
 * Application-layer features are NOT re-exported here (layering).
 */
export * from "./types";
export * from "./errors";
export * from "./url";
export * from "./extract";
export * from "./size-policy";
export * from "./serialize";
export * from "./workbench";
