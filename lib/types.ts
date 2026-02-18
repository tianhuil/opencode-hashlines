/**
 * Type definitions for hashline operations and errors.
 */

/**
 * A line reference with hash verification.
 */
export interface LineRef {
  line: number;
  hash: string;
}

/**
 * Hash mismatch error details.
 */
export interface HashMismatch {
  line: number;
  expected: string;
  actual: string;
}

/**
 * Parsed edit operation types.
 */
export type HashlineEditSpec =
  | { kind: "single"; ref: LineRef; dst: string }
  | { kind: "range"; start: LineRef; end: LineRef; dst: string }
  | { kind: "insertAfter"; after: LineRef; dst: string };

/**
 * A parsed edit operation with its original index.
 */
export interface ParsedEdit {
  edit: { spec: HashlineEditSpec };
  index: number;
}

/**
 * Raw edit operation format (as submitted by the model).
 */
export interface HashlineEdit {
  set_line?: { anchor: string; new_text: string };
  replace_lines?: { start_anchor: string; end_anchor: string; new_text: string };
  insert_after?: { anchor: string; text: string };
  replace?: { old_text: string; new_text: string; all?: boolean };
}

/**
 * Error thrown when hash validation fails.
 */
export class HashlineMismatchError extends Error {
  constructor(public readonly mismatches: HashMismatch[]) {
    super(`Hash mismatch: ${mismatches.map(m => `line ${m.line}: expected ${m.expected}, got ${m.actual}`).join("; ")}`);
    this.name = "HashlineMismatchError";
  }
}
