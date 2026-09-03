/**
 * Application layer — orchestration-level features (packaging, workbench
 * TaskSpec construction, delivery). Depends on Core and on pure
 * normalized-source semantics exported by source adapters; never on the
 * Extension runtime.
 */
export * from "./package";
export * from "./workbench";
