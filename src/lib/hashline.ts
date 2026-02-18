/**
 * Core hashline implementation.
 *
 * Provides line-addressed editing with hash-verified anchors to prevent
 * edits from corrupting files when content has changed.
 */

import type { LineRef, HashlineEdit, HashlineEditSpec, ParsedEdit, HashMismatch } from "./types.js";

const HASH_LEN = 2;
const RADIX = 16;
const HASH_MOD = RADIX ** HASH_LEN;

// Pre-computed dictionary for fast hash lookups
const DICT = Array.from({ length: HASH_MOD }, (_, i) =>
  i.toString(RADIX).padStart(HASH_LEN, "0")
);

/**
 * Compute a short hex hash of a single line.
 *
 * Uses Bun's xxHash32 on a whitespace-normalized line, truncated to HASH_LEN
 * hex characters. The idx parameter is accepted for compatibility but is
 * not currently mixed into the hash.
 */
export function computeLineHash(idx: number, line: string): string {
  if (line.endsWith("\r")) {
    line = line.slice(0, -1);
  }
  line = line.replace(/\s+/g, ""); // Normalize whitespace
  void idx; // Not used, kept for compatibility
  return DICT[Bun.hash.xxHash32(line) % HASH_MOD]! ?? "00";
}

/**
 * Format file content with hashline prefixes for display.
 *
 * Each line becomes `LINENUM:HASH|CONTENT` where LINENUM is 1-indexed.
 *
 * @example
 * formatHashLines("function hi() {\n return;\n}")
 * // "1:HH|function hi() {\n2:HH| return;\n3:HH|}"
 */
export function formatHashLines(content: string, startLine = 1): string {
  const lines = content.split("\n");
  return lines
    .map((line, i) => {
      const num = startLine + i;
      const hash = computeLineHash(num, line);
      return `${num}:${hash}|${line}`;
    })
    .join("\n");
}

/**
 * Pattern matching hashline display format: `LINE:HASH|CONTENT`
 */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+:[0-9a-zA-Z]{1,16}\|/;

/**
 * Parse a line reference string into line number and hash.
 *
 * Accepts formats like "42:a3", "  42:a3|content", ">> 42:a3", etc.
 */
export function parseLineRef(ref: string): { line: number; hash: string } {
  const cleaned = ref
    .replace(/\|.*$/, "") // Strip content after |
    .replace(/ {2}.*$/, "") // Strip markdown code block content
    .replace(/^>+\s*/, "") // Strip quote markers
    .trim();
  const normalized = cleaned.replace(/\s*:\s*/, ":"); // Normalize spacing around :

  // Strict format: LINE:HASH
  const strictMatch = normalized.match(/^(\d+):([0-9a-zA-Z]{1,16})$/);
  if (strictMatch) {
    return { line: parseInt(strictMatch[1]!, 10), hash: strictMatch[2]! };
  }

  // Fallback: extract line number if hash format is invalid
  const looseMatch = normalized.match(/^(\d+):/);
  if (looseMatch) {
    return { line: parseInt(looseMatch[1]!, 10), hash: "" };
  }

  throw new Error(`Invalid line reference: ${ref}`);
}

/**
 * Get the line number for an edit operation.
 */
function getLineForEdit(spec: HashlineEditSpec): number {
  switch (spec.kind) {
    case "single":
      return spec.ref.line;
    case "range":
      return spec.start.line;
    case "insertAfter":
      return spec.after.line;
  }
}

/**
 * Parse a single edit operation.
 */
function parseHashlineEdit(edit: HashlineEdit): { spec: HashlineEditSpec } {
  if (edit.set_line) {
    const { anchor, new_text } = edit.set_line;
    const ref = parseLineRef(anchor);
    return { spec: { kind: "single", ref, dst: new_text } };
  }
  if (edit.replace_lines) {
    const { start_anchor, end_anchor, new_text } = edit.replace_lines;
    const start = parseLineRef(start_anchor);
    const end = parseLineRef(end_anchor);
    return { spec: { kind: "range", start, end, dst: new_text } };
  }
  if (edit.insert_after) {
    const { anchor, text } = edit.insert_after;
    const after = parseLineRef(anchor);
    return { spec: { kind: "insertAfter", after, dst: text } };
  }
  throw new Error(`Invalid edit operation: ${JSON.stringify(edit)}`);
}

/**
 * Apply hashline edits to content.
 *
 * Returns the edited content along with metadata about what changed.
 */
export function applyHashlineEdits(
  content: string,
  edits: HashlineEdit[],
): {
  content: string;
  firstChangedLine: number | undefined;
  warnings?: string[];
  noopEdits?: Array<{ editIndex: number; loc: string; currentContent: string }>;
} {
  const fileLines = content.split("\n");
  const warnings: string[] = [];
  const noopEdits: Array<{ editIndex: number; loc: string; currentContent: string }> = [];
  let firstChangedLine: number | undefined = undefined;

  // Parse edits and sort by line number (bottom-to-top for application)
  const parsedEdits = edits
    .map((edit, i) => ({ edit: parseHashlineEdit(edit), index: i }))
    .sort((a, b) => {
      const aLine = getLineForEdit(a.edit.spec);
      const bLine = getLineForEdit(b.edit.spec);
      return bLine - aLine; // Bottom-to-top
    });

  for (const { edit, index } of parsedEdits) {
    switch (edit.spec.kind) {
      case "single": {
        const { ref, dst } = edit.spec;
        const actualLine = fileLines[ref.line - 1]!;
        const actualHash = computeLineHash(ref.line, actualLine);

        if (actualHash !== ref.hash) {
          warnings.push(
            `Hash mismatch at line ${ref.line}: expected ${ref.hash}, got ${actualHash}`
          );
          continue;
        }

        if (actualLine === dst) {
          noopEdits.push({
            editIndex: index,
            loc: `${ref.line}:${ref.hash}`,
            currentContent: actualLine,
          });
          continue;
        }

        fileLines[ref.line - 1] = dst;
        firstChangedLine ??= ref.line;
        break;
      }

      case "range": {
        const { start, end, dst } = edit.spec;

        // Validate start hash
        const startLine = fileLines[start.line - 1]!;
        const startHash = computeLineHash(start.line, startLine);
        if (startHash !== start.hash) {
          warnings.push(
            `Hash mismatch at line ${start.line}: expected ${start.hash}, got ${startHash}`
          );
          continue;
        }

        // Validate end hash
        const endLine = fileLines[end.line - 1]!;
        const endHash = computeLineHash(end.line, endLine);
        if (endHash !== end.hash) {
          warnings.push(
            `Hash mismatch at line ${end.line}: expected ${end.hash}, got ${endHash}`
          );
          continue;
        }

        const dstLines = dst === "" ? [] : dst.split("\n");
        fileLines.splice(
          start.line - 1,
          end.line - start.line + 1,
          ...dstLines
        );
        firstChangedLine ??= start.line;
        break;
      }

      case "insertAfter": {
        const { after, dst } = edit.spec;
        const actualLine = fileLines[after.line - 1]!;
        const actualHash = computeLineHash(after.line, actualLine);

        if (actualHash !== after.hash) {
          warnings.push(
            `Hash mismatch at line ${after.line}: expected ${after.hash}, got ${actualHash}`
          );
          continue;
        }

        const dstLines = dst.split("\n");
        fileLines.splice(after.line, 0, ...dstLines);
        firstChangedLine ??= after.line + 1;
        break;
      }
    }
  }

  return {
    content: fileLines.join("\n"),
    firstChangedLine,
    warnings: warnings.length > 0 ? warnings : undefined,
    noopEdits: noopEdits.length > 0 ? noopEdits : undefined,
  };
}

/**
 * Detect the line ending style of content.
 */
export function detectLineEnding(content: string): "\n" | "\r\n" {
  const crlf = content.match(/\r\n/g);
  const lf = content.match(/(?<!\r)\n/g);

  if (!crlf && !lf) return "\n";
  if (!crlf) return "\n";
  if (!lf) return "\r\n";
  return crlf.length > lf.length ? "\r\n" : "\n";
}

/**
 * Normalize content to LF line endings.
 */
export function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Strip BOM from content.
 */
export function stripBom(content: string): { bom?: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: "\ufeff", text: content.slice(1) };
  }
  return { text: content };
}
