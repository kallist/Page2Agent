/**
 * Application layer — orchestration-level features (packaging, delivery in
 * later stages). Depends on Core and on pure normalized-source semantics
 * exported by source adapters; never on Extension runtime.
 */
export * from "./package";
