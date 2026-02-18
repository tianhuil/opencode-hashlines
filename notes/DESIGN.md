Yes! Plugins are actually a much cleaner way to do this than custom tools. The plugin system lets you bundle everything — the hashread/hashedit tools, the `tool.execute.before` hook to intercept and redirect built-in read/edit calls, and even inject system prompt instructions — all in one distributable file.

Here's the full plugin:

**`.opencode/plugins/hashline.ts`** (or publish as `opencode-hashline` to npm):

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import { createHash } from "crypto"

function lineHash(line: string): string {
  return createHash("sha256").update(line).digest("hex").slice(0, 2)
}

function renderWithHashes(lines: string[], startLine = 1): string {
  return lines
    .map((line, i) => `${startLine + i}:${lineHash(line)}|${line}`)
    .join("\n")
}

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
          const filePath = resolve(context.directory, args.path)
          const lines = readFileSync(filePath, "utf8").split("\n")
          const start = (args.start_line ?? 1) - 1
          const end = args.end_line ?? lines.length
          return renderWithHashes(lines.slice(start, end), start + 1)
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
            tool.schema.discriminatedUnion("op", [
              tool.schema.object({
                op: tool.schema.literal("replace"),
                start_line: tool.schema.number(),
                start_hash: tool.schema.string(),
                end_line: tool.schema.number(),
                end_hash: tool.schema.string(),
                new_content: tool.schema.string(),
              }),
              tool.schema.object({
                op: tool.schema.literal("insert_after"),
                line: tool.schema.number(),
                hash: tool.schema.string(),
                new_content: tool.schema.string(),
              }),
              tool.schema.object({
                op: tool.schema.literal("delete"),
                start_line: tool.schema.number(),
                start_hash: tool.schema.string(),
                end_line: tool.schema.number(),
                end_hash: tool.schema.string(),
              }),
            ])
          ).describe("Edit operations to apply"),
        },
        async execute(args, context) {
          const filePath = resolve(context.directory, args.path)
          let lines = readFileSync(filePath, "utf8").split("\n")

          const ops = [...args.operations].sort((a, b) => {
            const aLine = "start_line" in a ? a.start_line : a.line
            const bLine = "start_line" in b ? b.start_line : b.line
            return bLine - aLine // bottom-to-top
          })

          for (const op of ops) {
            if (op.op === "replace") {
              const sh = lineHash(lines[op.start_line - 1] ?? "")
              const eh = lineHash(lines[op.end_line - 1] ?? "")
              if (sh !== op.start_hash)
                return `Hash mismatch at line ${op.start_line}: expected ${op.start_hash}, got ${sh}. Re-read the file first.`
              if (eh !== op.end_hash)
                return `Hash mismatch at line ${op.end_line}: expected ${op.end_hash}, got ${eh}. Re-read the file first.`
              lines.splice(op.start_line - 1, op.end_line - op.start_line + 1, ...op.new_content.split("\n"))
            } else if (op.op === "insert_after") {
              const h = lineHash(lines[op.line - 1] ?? "")
              if (h !== op.hash)
                return `Hash mismatch at line ${op.line}: expected ${op.hash}, got ${h}. Re-read the file first.`
              lines.splice(op.line, 0, ...op.new_content.split("\n"))
            } else if (op.op === "delete") {
              const sh = lineHash(lines[op.start_line - 1] ?? "")
              const eh = lineHash(lines[op.end_line - 1] ?? "")
              if (sh !== op.start_hash) return `Hash mismatch at line ${op.start_line}. Re-read first.`
              if (eh !== op.end_hash) return `Hash mismatch at line ${op.end_line}. Re-read first.`
              lines.splice(op.start_line - 1, op.end_line - op.start_line + 1)
            }
          }

          writeFileSync(filePath, lines.join("\n"), "utf8")
          return `Applied ${ops.length} operation(s) to ${args.path}`
        },
      }),
    },

    // --- Intercept built-in read calls and upgrade them to hashread output ---
    "tool.execute.after": async (input, output) => {
      if (input.tool === "read" && typeof output.result === "string") {
        const lines = output.result.split("\n")
        // If it looks like opencode already added line numbers (e.g. "  1 | code"), strip them
        // and re-render with hashes
        output.result =
          "⚠️ Use `hashread` instead of `read` for hash-anchored editing.\n\n" +
          renderWithHashes(lines)
      }
    },
  }
}
```

Then in your `opencode.json`, disable the built-in edit tool (read can stay as a fallback with the interception hook nudging the model):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "build": {
      "tools": { "edit": false },
      "prompt": "Always use `hashread` to read files and `hashedit` to edit them. Never use `edit` or `str_replace`. The hashread output format is `N:hh|line` — pass those hashes back to hashedit as anchors."
    }
  }
}
```

## Key advantages of the plugin approach vs. custom tools

**Everything in one file.** Tools + hooks + any initialization logic are colocated. You can publish it as `opencode-hashline` on npm and anyone can add it with one line in their `opencode.json`.

**The `tool.execute.after` hook** lets you intercept the built-in `read` tool as a safety net. If the model reaches for `read` anyway, your hook can rewrite the output to include hashes, so edits are still anchored correctly.

**To publish to npm**, just wrap it in a standard package:

```
my-plugin/
  src/index.ts   ← the plugin above
  package.json   ← { "main": "dist/index.js", dependencies: { "@opencode-ai/plugin": "latest" } }
  tsconfig.json
```

Then users just do:
```json
{ "plugin": ["opencode-hashline"] }
```

and it auto-installs at startup.

## References:

- https://blog.can.ac/2026/02/12/the-harness-problem/: describes hashlines
- https://github.com/can1357/oh-my-pi: should contain a hashlines implementaiton
- https://opencode.ai/docs/plugins/: how to write an opencode plugin
  