/**
 * Hashline Plugin for OpenCode
 *
 * Provides hash-anchored file reading and editing to prevent corruption
 * from stale line references when file content has changed.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";

// Import core hashline functions from lib
import { computeLineHash, formatHashLines, parseLineRef, applyHashlineEdits, detectLineEnding, normalizeToLF, stripBom } from "../../lib/hashline.js";
import type { HashlineEdit } from "../../lib/types.js";

export const HashlinePlugin: Plugin = async (ctx) => {
  return {
    // --- Custom tools the model uses ---
    tool: {
      hashread: tool({
        description:
          "Read a file. Returns lines tagged as `N:hh|content` where hh is a 2-char hash. " +
          "Pass these hashes to hashedit when editing — they serve as stable anchors. " +
          "Prefer this over the built-in read tool.",
        args: {
          path: tool.schema.string().describe("File path relative to working directory"),
          start_line: tool.schema.number().optional().describe("First line (1-based)"),
          end_line: tool.schema.number().optional().describe("Last line (1-based, inclusive)"),
        },
        async execute(args, context) {
          const filePath = resolve(context.directory, args.path);

          if (!existsSync(filePath)) {
            throw new Error(`File not found: ${args.path}`);
          }

          const content = readFileSync(filePath, "utf8");
          const { text } = stripBom(content);
          const lines = text.split("\n");

          const start = (args.start_line ?? 1) - 1;
          const end = args.end_line ?? lines.length;

          const selectedLines = lines.slice(start, end);
          return formatHashLines(selectedLines.join("\n"), start + 1);
        },
      }),

      hashedit: tool({
        description:
          "Edit a file using line+hash anchors from hashread. " +
          "Operations run bottom-to-top automatically. " +
          "Hash mismatches are rejected — re-read first if that happens. " +
          "Prefer this over the built-in edit tool.",
        args: {
          path: tool.schema.string().describe("File path"),
          operations: tool.schema.array(
            z.discriminatedUnion("op", [
              // set_line operation
              z.object({
                op: z.literal("set_line").describe("Single line replacement"),
                line: z.number().describe("Line number"),
                hash: z.string().describe("2-char hash of current content"),
                new_text: z.string().describe("New line content (empty to delete)"),
              }),
              // replace_lines operation
              z.object({
                op: z.literal("replace_lines").describe("Range replacement"),
                start_line: z.number().describe("Start line number"),
                start_hash: z.string().describe("Hash of start line"),
                end_line: z.number().describe("End line number"),
                end_hash: z.string().describe("Hash of end line"),
                new_content: z.string().describe("New content (empty to delete)"),
              }),
              // insert_after operation
              z.object({
                op: z.literal("insert_after").describe("Insert after line"),
                line: z.number().describe("Line number to insert after"),
                hash: z.string().describe("Hash of anchor line"),
                new_content: z.string().describe("Content to insert"),
              }),
            ])
          ).describe("Edit operations to apply"),
        },
        async execute(args, context) {
          const filePath = resolve(context.directory, args.path);

          if (!existsSync(filePath)) {
            throw new Error(`File not found: ${args.path}`);
          }

          const rawContent = readFileSync(filePath, "utf8");
          const { text: content } = stripBom(rawContent);
          const originalEnding = detectLineEnding(content);
          const normalizedContent = normalizeToLF(content);

          // Convert tool format to hashline format
          const edits: HashlineEdit[] = args.operations.map((op: any) => {
            if (op.op === "set_line") {
              return {
                set_line: {
                  anchor: `${op.line}:${op.hash}`,
                  new_text: op.new_text,
                },
              };
            } else if (op.op === "replace_lines") {
              return {
                replace_lines: {
                  start_anchor: `${op.start_line}:${op.start_hash}`,
                  end_anchor: `${op.end_line}:${op.end_hash}`,
                  new_text: op.new_content,
                },
              };
            } else if (op.op === "insert_after") {
              return {
                insert_after: {
                  anchor: `${op.line}:${op.hash}`,
                  text: op.new_content,
                },
              };
            }
            throw new Error(`Unknown operation type: ${op.op}`);
          });

          // Apply edits
          const result = applyHashlineEdits(normalizedContent, edits);

          if (result.warnings && result.warnings.length > 0) {
            return result.warnings.join("\n");
          }

          // Write file, preserving original line ending
          const outputContent = originalEnding === "\r\n"
            ? result.content.replace(/\n/g, "\r\n")
            : result.content;

          writeFileSync(filePath, outputContent, "utf8");

          const details: string[] = [`Applied ${args.operations.length} operation(s) to ${args.path}`];
          if (result.firstChangedLine !== undefined) {
            details.push(`First changed line: ${result.firstChangedLine}`);
          }
          if (result.noopEdits && result.noopEdits.length > 0) {
            details.push(`\nNote: ${result.noopEdits.length} no-op edits skipped (content identical)`);
          }

          return details.join("\n");
        },
      }),
    },

    // --- Intercept built-in read calls and upgrade them to hashread output ---
    "tool.execute.after": async (input, output) => {
      if (input.tool === "read" && typeof output.output === "string") {
        const lines = output.output.split("\n");

        // If it looks like opencode already added line numbers (e.g. "  1 | code"), strip them
        // and re-render with hashes
        const hasLineNumbers = lines.some(line => /^\s*\d+\s*\|/.test(line));

        let textToFormat = output.output;
        if (hasLineNumbers) {
          textToFormat = lines.map(line => line.replace(/^\s*\d+\s*\|/, "")).join("\n");
        }

        output.output =
          "⚠️ Use `hashread` instead of `read` for hash-anchored editing.\n\n" +
          formatHashLines(textToFormat);
      }
    },
  };
};
