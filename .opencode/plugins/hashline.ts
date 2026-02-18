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
          path: { type: "string", description: "File path relative to working directory" },
          start_line: { type: "number", optional: true, description: "First line (1-based)" },
          end_line: { type: "number", optional: true, description: "Last line (1-based, inclusive)" },
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
          path: { type: "string", description: "File path" },
          operations: {
            type: "array",
            description: "Edit operations to apply",
            items: {
              type: "object",
              anyOf: [
                {
                  description: "Replace a single line",
                  properties: {
                    op: { const: "set_line", description: "Single line replacement" },
                    line: { type: "number", description: "Line number" },
                    hash: { type: "string", description: "2-char hash of current content" },
                    new_text: { type: "string", description: "New line content (empty to delete)" },
                  },
                  required: ["op", "line", "hash", "new_text"],
                },
                {
                  description: "Replace a range of lines",
                  properties: {
                    op: { const: "replace_lines", description: "Range replacement" },
                    start_line: { type: "number", description: "Start line number" },
                    start_hash: { type: "string", description: "Hash of start line" },
                    end_line: { type: "number", description: "End line number" },
                    end_hash: { type: "string", description: "Hash of end line" },
                    new_content: { type: "string", description: "New content (empty to delete)" },
                  },
                  required: ["op", "start_line", "start_hash", "end_line", "end_hash", "new_content"],
                },
                {
                  description: "Insert content after a line",
                  properties: {
                    op: { const: "insert_after", description: "Insert after line" },
                    line: { type: "number", description: "Line number to insert after" },
                    hash: { type: "string", description: "Hash of anchor line" },
                    new_content: { type: "string", description: "Content to insert" },
                  },
                  required: ["op", "line", "hash", "new_content"],
                },
              ],
            },
          },
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
      if (input.tool === "read" && typeof output.result === "string") {
        const lines = output.result.split("\n");

        // If it looks like opencode already added line numbers (e.g. "  1 | code"), strip them
        // and re-render with hashes
        const hasLineNumbers = lines.some(line => /^\s*\d+\s*\|/.test(line));

        let textToFormat = output.result;
        if (hasLineNumbers) {
          textToFormat = lines.map(line => line.replace(/^\s*\d+\s*\|/, "")).join("\n");
        }

        output.result =
          "⚠️ Use `hashread` instead of `read` for hash-anchored editing.\n\n" +
          formatHashLines(textToFormat);
      }
    },
  };
};
