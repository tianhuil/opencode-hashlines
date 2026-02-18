/**
 * Zod schemas for hashline tool validation.
 *
 * These schemas define the expected input format for hashread and hashedit tools.
 * 
 * **NOTE** not used but prserved for reference.
 */

import { z } from "zod";

/**
 * Schema for hashread tool.
 */
export const hashreadSchema = z.object({
  path: z.string().describe("File path relative to working directory"),
  start_line: z.number().optional().describe("First line (1-based)"),
  end_line: z.number().optional().describe("Last line (1-based, inclusive)"),
});

/**
 * Schema for a line reference in hashedit operations.
 */
const lineRefSchema = z.string().describe('Line reference "LINE:HASH"');

/**
 * Schema for single line replacement operation.
 */
const setLineSchema = z.object({
  set_line: z.object({
    anchor: lineRefSchema,
    new_text: z.string().describe('Replacement content (\\n-separated) — "" for delete'),
  }),
});

/**
 * Schema for multi-line range replacement operation.
 */
const replaceLinesSchema = z.object({
  replace_lines: z.object({
    start_anchor: lineRefSchema,
    end_anchor: lineRefSchema,
    new_text: z.string().describe('Replacement content (\\n-separated) — "" for delete'),
  }),
});

/**
 * Schema for insert after operation.
 */
const insertAfterSchema = z.object({
  insert_after: z.object({
    anchor: lineRefSchema,
    text: z.string().describe("Content to insert (\\n-separated); must be non-empty"),
  }),
});

/**
 * Schema for fuzzy substring replace operation.
 */
const replaceSchema = z.object({
  replace: z.object({
    old_text: z.string().describe("Text to find (fuzzy whitespace matching enabled)"),
    new_text: z.string().describe("Replacement text"),
    all: z.boolean().optional().describe("Replace all occurrences (default: unique match required)"),
  }),
});

/**
 * Union of all edit operation schemas.
 */
export const hashlineEditItemSchema = z.union([
  setLineSchema,
  replaceLinesSchema,
  insertAfterSchema,
  replaceSchema,
]);

/**
 * Schema for hashedit tool.
 */
export const hasheditSchema = z.object({
  path: z.string().describe("File path"),
  operations: z.array(hashlineEditItemSchema).describe("Edit operations to apply"),
});
