/**
 * TaskSpec JSON serialization — application layer.
 *
 * Deterministic: the spec object is already key-ordered by the builder;
 * JSON.stringify preserves insertion order, so two builds from the same cart
 * produce byte-identical output.
 */
import type { TaskSpec } from "../../core";

/** Pretty-printed JSON with a trailing newline (git/CLI friendly). */
export function serializeTaskSpecJson(spec: TaskSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** Compact single-line JSON (e.g. clipboard-friendly payloads). */
export function serializeTaskSpecJsonCompact(spec: TaskSpec): string {
  return JSON.stringify(spec);
}
