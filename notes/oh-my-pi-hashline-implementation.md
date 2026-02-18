# Hashline Implementation in Oh-My-Pi

**Date:** 2026-02-18
**Source:** https://github.com/can1357/oh-my-pi
**Topic:** Hashline edit implementation and prompts

---

## Executive Summary

Oh-My-Pi implements a line-addressed edit format using content hashes called **hashlines**. Each line is identified by a `LINE:HASH` reference where:
- `LINE` is the 1-indexed line number
- `HASH` is a 2-character hex hash derived from the line content

The hashline system provides stable anchors that detect file changes before edits are applied, preventing corruption from stale references.

**Key Findings:**
- Hash computed using xxHash32 on whitespace-normalized lines
- Uses 2-character hex hash (0-9, a-f) for a total of 256 possible values
- Four edit operations: `set_line`, `replace_lines`, `insert_after`, `replace`
- Model instructions emphasize copying anchors verbatim and preserving formatting

---

## Detailed Findings

### High-Level Architecture

The hashline implementation is spread across multiple modules in the `packages/coding-agent/src/` directory:

```
packages/coding-agent/src/
├── patch/
│   ├── hashline.ts          # Core hashline algorithms (format, parse, compute, apply)
│   ├── index.ts             # Edit tool with hashline mode
│   └── types.ts            # HashMismatch error class and types
├── tools/
│   ├── read.ts              # Read tool that outputs hashline format
│   └── index.ts            # Tool registry
├── utils/
│   └── file-display-mode.ts  # Determines when to use hashline output
├── config/
│   └── prompt-templates.ts   # Handlebars helper for {{hashline}}
└── prompts/
    └── tools/
        └── hashline.md      # Model instruction template
```

### Natural Abstraction Boundary

**Core hashline module** (`patch/hashline.ts`):
- `computeLineHash()` - Calculate hash for a line
- `formatHashLines()` - Format content with `LINE:HASH|` prefix
- `parseLineRef()` - Parse `LINE:HASH` references
- `applyHashlineEdits()` - Apply edits with validation
- `streamHashLinesFrom*()` - Streaming formatters for large files

**Edit tool module** (`patch/index.ts`):
- `EditTool` class with dynamic mode (replace/patch/hashline)
- Mode selection based on `edit.mode` setting or per-model variant
- Hashline schema definitions for the four operation types
- LSP integration for diagnostics and formatting

**Read tool module** (`tools/read.ts`):
- `ReadTool` class with hashline output option
- Uses `resolveFileDisplayMode()` to determine formatting
- Calls `prependHashLines()` when hashline mode is enabled

---

## Code Snippets and Examples

### 1. Hash Computation

**File:** `packages/coding-agent/src/patch/hashline.ts`

```typescript
const HASH_LEN = 2;
const RADIX = 16;
const HASH_MOD = RADIX ** HASH_LEN;

// Pre-computed dictionary for fast hash lookups
const DICT = Array.from({ length: HASH_MOD }, (_, i) =>
  i.toString(RADIX).padStart(HASH_LEN, "0")
);

/**
 * Compute a short base36 hash of a single line.
 *
 * Uses xxHash32 on a whitespace-normalized line, truncated to HASH_LEN
 * hex characters. The `idx` parameter is accepted for compatibility but is
 * not currently mixed into the hash.
 */
export function computeLineHash(idx: number, line: string): string {
  if (line.endsWith("\r")) {
    line = line.slice(0, -1);
  }
  line = line.replace(/\s+/g, "");  // Normalize whitespace
  void idx;  // Not used, kept for compatibility
  return DICT[Bun.hash.xxHash32(line) % HASH_MOD];
}
```

**Key Points:**
- Whitespace is normalized before hashing (spaces/tabs don't affect hash)
- Uses Bun's built-in xxHash32 for performance
- 2-character hex hash provides 256 unique values (collision rate ~0.4%)
- Dictionary lookup for O(1) hash-to-string conversion

### 2. Format Output for Display

**File:** `packages/coding-agent/src/patch/hashline.ts`

```typescript
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
```

### 3. Parse Line References

**File:** `packages/coding-agent/src/patch/hashline.ts`

```typescript
/**
 * Pattern matching hashline display format: `LINE:HASH|CONTENT`
 */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+:[0-9a-zA-Z]{1,16}\|/;

export function parseLineRef(ref: string): { line: number; hash: string } {
  const cleaned = ref
    .replace(/\|.*$/, "")        // Strip content after |
    .replace(/ {2}.*$/, "")      // Strip markdown code block content
    .replace(/^>+\s*/, "")       // Strip quote markers
    .trim();
  const normalized = cleaned.replace(/\s*:\s*/, ":"); // Normalize spacing around :

  // Strict format: LINE:HASH
  const strictMatch = normalized.match(/^(\d+):([0-9a-zA-Z]{1,16})$/);
  if (strictMatch) {
    return { line: parseInt(strictMatch[1], 10), hash: strictMatch[2] };
  }

  // Fallback: extract line number if hash format is invalid
  const looseMatch = normalized.match(/^(\d+):/);
  if (looseMatch) {
    return { line: parseInt(looseMatch[1], 10), hash: "" };
  }

  throw new Error(`Invalid line reference: ${ref}`);
}
```

### 4. Apply Hashline Edits

**File:** `packages/coding-agent/src/patch/hashline.ts` (simplified)

```typescript
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
  const noopEdits: typeof noopEdits = [];
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
        const { ref, dst } = edit;
        const actualLine = fileLines[ref.line - 1];
        const actualHash = computeLineHash(ref.line, actualLine);

        if (actualHash !== ref.hash) {
          warnings.push(
            `Hash mismatch at line ${ref.line}: ` +
            `expected ${ref.hash}, got ${actualHash}`
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
        const { start, end, dst } = edit;
        // Validate start and end hashes
        // ... validation logic ...

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
        const { after, dst } = edit;
        const actualLine = fileLines[after.line - 1];
        const actualHash = computeLineHash(after.line, actualLine);

        if (actualHash !== after.hash) {
          warnings.push(
            `Hash mismatch at line ${after.line}: ` +
            `expected ${after.hash}, got ${actualHash}`
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
```

### 5. Edit Tool Schemas

**File:** `packages/coding-agent/src/patch/index.ts`

```typescript
// Single line replacement
const hashlineSingleSchema = Type.Object({
  set_line: Type.Object({
    anchor: Type.String({
      description: 'Line reference "LINE:HASH"'
    }),
    new_text: Type.String({
      description: 'Replacement content (\\n-separated) — "" for delete'
    }),
  }),
});

// Multi-line range replacement
const hashlineRangeSchema = Type.Object({
  replace_lines: Type.Object({
    start_anchor: Type.String({
      description: 'Start line ref "LINE:HASH"'
    }),
    end_anchor: Type.String({
      description: 'End line ref "LINE:HASH"'
    }),
    new_text: Type.String({
      description: 'Replacement content (\\n-separated) — "" for delete'
    }),
  }),
});

// Insert after anchor line
const hashlineInsertAfterSchema = Type.Object({
  insert_after: Type.Object({
    anchor: Type.String({
      description: 'Insert after this line "LINE:HASH"'
    }),
    text: Type.String({
      description: "Content to insert (\\n-separated); must be non-empty"
    }),
  }),
});

// Fuzzy substring replace (fallback when anchors unavailable)
const hashlineReplaceSchema = Type.Object({
  replace: Type.Object({
    old_text: Type.String({
      description: "Text to find (fuzzy whitespace matching enabled)"
    }),
    new_text: Type.String({
      description: "Replacement text"
    }),
    all: Type.Optional(Type.Boolean({
      description: "Replace all occurrences (default: unique match required)"
    })),
  }),
});

// Union of all operation types
const hashlineEditItemSchema = Type.Union([
  hashlineSingleSchema,
  hashlineRangeSchema,
  hashlineInsertAfterSchema,
  hashlineReplaceSchema,
]);

// Full edit schema
const hashlineEditSchema = Type.Object({
  path: Type.String({
    description: "File path (relative or absolute)"
  }),
  edits: Type.Array(hashlineEditItemSchema, {
    description: "Array of edit operations"
  }),
});
```

### 6. Read Tool with Hashline Output

**File:** `packages/coding-agent/src/tools/read.ts` (excerpt)

```typescript
import { computeLineHash } from "../patch/hashline";

export class ReadTool implements AgentTool<typeof readSchema, ReadToolDetails> {
  readonly name = "read";
  readonly label = "Read";

  async execute(
    toolCallId: string,
    params: ReadParams,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback,
    context?: AgentToolContext,
  ): Promise<AgentToolResult<ReadToolDetails>> {
    const displayMode = resolveFileDisplayMode(this.session);

    // Helper to prepend hashlines
    const prependHashLines = (text: string, startNum: number): string => {
      const textLines = text.split("\n");
      return textLines
        .map((line, i) =>
          `${startNum + i}:${computeLineHash(startNum + i, line)}|${line}`
        )
        .join("\n");
    };

    // ... file reading logic ...

    if (displayMode.hashLines) {
      // Format with hashlines
      text = prependHashLines(text, startLine ?? 1);
    } else if (displayMode.lineNumbers) {
      // Format with plain line numbers
      text = prependLineNumbers(text, startLine ?? 1);
    }

    return toolResult({
      path,
      text,
      // ... other metadata ...
    });
  }
}
```

### 7. File Display Mode Resolution

**File:** `packages/coding-agent/src/utils/file-display-mode.ts`

```typescript
export function resolveFileDisplayMode(
  session: FileDisplayModeSession
): FileDisplayMode {
  const { settings } = session;
  const hasEditTool = session.hasEditTool ?? true;

  const hashLines =
    hasEditTool &&
    (settings.get("readHashLines") === true ||
      settings.get("edit.mode") === "hashline" ||
      Bun.env.PI_EDIT_VARIANT === "hashline");

  return {
    hashLines,
    lineNumbers: hashLines || settings.get("readLineNumbers") === true,
  };
}
```

### 8. Edit Tool Execution (Hashline Mode)

**File:** `packages/coding-agent/src/patch/index.ts` (excerpt)

```typescript
export class EditTool implements AgentTool<TInput> {
  readonly name = "edit";
  readonly label = "Edit";

  // Dynamic mode based on settings
  get mode(): EditMode {
    if (this.#editMode) return this.#editMode;
    const activeModel = this.session.getActiveModelString?.();
    const editVariant =
      this.session.settings.getEditVariantForModel(activeModel) ??
      normalizeEditMode(this.session.settings.get("edit.mode"));
    return editVariant ?? DEFAULT_EDIT_MODE;
  }

  async execute(
    _toolCallId: string,
    params: ReplaceParams | PatchParams | HashlineParams,
    signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback,
    context?: AgentToolContext,
  ): Promise<AgentToolResult<EditToolDetails>> {
    // ─────────────────────────────────────────────────────────────────
    // Hashline mode execution
    // ─────────────────────────────────────────────────────────────────
    if (this.mode === "hashline") {
      const { path, edits } = params as HashlineParams;

      // Validate edit operation types
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i] as Record<string, unknown>;

        if (
          ("old_text" in edit || "new_text" in edit) &&
          !("replace" in edit)
        ) {
          throw new Error(
            `edits[${i}] contains 'old_text'/'new_text' at top level ` +
            `(replace mode). Use {replace: {old_text, new_text}} for hashline ` +
            `content replace, or {set_line}, {replace_lines}, {insert_after}.`
          );
        }

        if ("diff" in edit) {
          throw new Error(
            `edits[${i}] contains 'diff' field from patch mode. ` +
            `Hashline edits use: {set_line}, {replace_lines}, ` +
            `{insert_after}, or {replace}.`
          );
        }

        if (
          !("set_line" in edit) &&
          !("replace_lines" in edit) &&
          !("insert_after" in edit) &&
          !("replace" in edit)
        ) {
          throw new Error(
            `edits[${i}] must contain exactly one of: 'set_line', ` +
            `'replace_lines', 'insert_after', or 'replace'. ` +
            `Got keys: [${Object.keys(edit).join(", ")}].`
          );
        }
      }

      // Separate anchor-based edits from content-replace edits
      const anchorEdits = edits.filter(
        (e): e is HashlineEdit =>
          "set_line" in e || "replace_lines" in e || "insert_after" in e
      );
      const replaceEdits = edits.filter(
        (e): e is { replace: { old_text: string; new_text: string; all?: boolean } } =>
          "replace" in e
      );

      const absolutePath = resolvePlanPath(this.session, path);
      const file = Bun.file(absolutePath);
      if (!(await file.exists())) {
        throw new Error(`File not found: ${path}`);
      }

      const rawContent = await file.text();
      const { bom, text: content } = stripBom(rawContent);
      const originalEnding = detectLineEnding(content);
      const originalNormalized = normalizeToLF(content);
      let normalizedContent = originalNormalized;

      // Apply anchor-based edits first
      const anchorResult = applyHashlineEdits(normalizedContent, anchorEdits);
      normalizedContent = anchorResult.content;

      // Apply content-replace edits (fuzzy matching)
      for (const r of replaceEdits) {
        const rep = replaceText(normalizedContent, r.replace.old_text, r.replace.new_text, {
          fuzzy: this.#allowFuzzy,
          all: r.replace.all ?? false,
          threshold: this.#fuzzyThreshold,
        });
        normalizedContent = rep.content;
      }

      // Write file
      await this.#writethrough(absolutePath, normalizedContent, signal);

      return toolResult({
        path,
        firstChangedLine: anchorResult.firstChangedLine,
        warnings: anchorResult.warnings,
        noopEdits: anchorResult.noopEdits,
      });
    }

    // ... other modes (replace, patch) ...
  }
}
```

### 9. Handlebars Helper for Template Examples

**File:** `packages/coding-agent/src/config/prompt-templates.ts`

```typescript
import { computeLineHash } from "../patch/hashline";

handlebars.registerHelper(
  "hashline",
  (lineNum: unknown, content: unknown): string => {
    const num = typeof lineNum === "number"
      ? lineNum
      : Number.parseInt(String(lineNum), 10);
    const str = typeof content === "string"
      ? content
      : String(content ?? "");
    return `${num}:${computeLineHash(num, str)}`;
  }
);
```

**Usage in prompts:**
```
{{hashline 5 "const x = 1"}}
// Outputs: "5:a3"
```

### 10. Model Instruction Template

**File:** `packages/coding-agent/src/prompts/tools/hashline.md`

```markdown
# Edit (Hash Anchored)

Line-addressed edits using hash-verified line references. Read files in hashline
mode, collect exact `LINE:HASH` references, and submit edits that change
only the targeted token or expression.

**CRITICAL: Copy `LINE:HASH` refs verbatim from read output. Use only the
anchor prefix (e.g., `{{hashline 42 "const x = 1"}}`), never the trailing
source text after `|`.**

## Operations

Four edit variants are available:

- **`set_line`**: Replace a single line
- **`replace_lines`**: Replace a contiguous range (use for deletions with `new_text: ""`)
- **`insert_after`**: Add new content after an anchor line
- **`replace`**: Substring-style fuzzy match (when line refs are unavailable)

## Workflow

1. Read the target file (`read`) to obtain `LINE:HASH` references
2. Collect the exact `LINE:HASH` refs for lines you will change
3. Direction-lock each mutation: identify the exact current token/expression → intended replacement
4. Submit one `edit` call containing all operations for that file
5. If another edit is needed on the same file: re-read first, then edit (hashes change after every edit)
6. Respond with tool calls only — no prose

## Examples

```json
{
  "path": "src/utils.ts",
  "edits": [
    {
      "set_line": {
        "anchor": "2: a3",
        "new_text": "  x = 99"
      }
    },
    {
      "replace_lines": {
        "start_anchor": "5: b2",
        "end_anchor": "8: c1",
        "new_text": "  combined = True"
      }
    },
    {
      "replace_lines": {
        "start_anchor": "5: d4",
        "end_anchor": "6: e5",
        "new_text": ""
      }
    },
    {
      "insert_after": {
        "anchor": "3: f6",
        "text": "  # new comment"
      }
    }
  ]
}
```

## Best Practices

1. **Scope each operation minimally.** One logical change site per operation. Use
   separate `set_line` ops for non-adjacent lines instead of a wide
   `replace_lines` that spans unchanged code.

2. **Preserve original formatting exactly.** Copy each line's whitespace, braces,
   semicolons, trailing commas, and style — then change only the targeted
   token/expression. Keep `import { foo }` as-is; keep indentation and line breaks
   as-is.

3. **Use `insert_after` for additions.** When adding a field, argument, or import
   near existing lines, prefer `insert_after` over replacing a neighboring line.

4. **Ensure `new_text` differs from current content.** Identical content is rejected
   as a no-op.

5. **Edit only requested lines.** Leave unrelated code untouched.

6. **Lock mutation direction.** Replace the exact currently-present token with the
   intended target. For swaps between two locations, use two `set_line` ops in one
   call.

## Error Handling

### Hash mismatch (`>>>` error)
→ Copy the updated `LINE:HASH` refs from error output verbatim and retry with the same
   intended mutation.
→ Re-read only if you need lines not shown in the error.
→ If mismatch repeats after applying updated refs, stop and re-read the relevant region.

### No-op error ("identical content")
→ Stop. Re-read the file — you are targeting the wrong line or your replacement is
   not different.
→ After 2 consecutive no-op errors on the same line, re-read the entire
   function/block.

## Verification Checklist

Before submitting, verify:

- [ ] Payload shape: `{"path": string, "edits": [operation, ...]}` with non-empty `edits` array
- [ ] Each operation has exactly one variant key: `set_line` | `replace_lines` | `insert_after` | `replace`
- [ ] Each anchor is copied exactly from the `LINE:HASH` prefix (no spaces, no trailing source text)
- [ ] `new_text`/`text` contains plain replacement lines only — no `LINE:HASH` prefixes, no diff `+` markers
- [ ] Each replacement differs from the current line content
- [ ] Each operation targets one logical change site with minimal scope
- [ ] Formatting of replaced lines matches the original exactly, except for the targeted change

**REMINDER: Copy `LINE:HASH` refs verbatim. Anchors are `LINE:HASH` only —
never `LINE:HASH|content`. Preserve exact formatting. Change only the targeted
token.**
```

---

## Files to Include for OpenCode Plugin

If pulling out the hashline implementation for an OpenCode plugin, include these files:

### Core Hashline Module (Required)
1. **`packages/coding-agent/src/patch/hashline.ts`**
   - Complete hashline implementation
   - All core functions: `computeLineHash`, `formatHashLines`, `parseLineRef`, `applyHashlineEdits`
   - Streaming functions for large file support

### Type Definitions (Required)
2. **`packages/coding-agent/src/patch/types.ts`**
   - `HashMismatch` interface
   - `HashlineMismatchError` class
   - `HashlineEdit` type (union of all operation types)

### Edit Tool Implementation (Required)
3. **`packages/coding-agent/src/patch/index.ts`**
   - `EditTool` class (can extract just the hashline mode logic)
   - Schema definitions: `hashlineSingleSchema`, `hashlineRangeSchema`, `hashlineInsertAfterSchema`, `hashlineReplaceSchema`
   - Hashline execution logic from `execute()` method

### Read Tool Implementation (Required)
4. **`packages/coding-agent/src/tools/read.ts`**
   - `ReadTool` class with hashline formatting
   - `prependHashLines()` helper function

### Display Mode Logic (Required)
5. **`packages/coding-agent/src/utils/file-display-mode.ts`**
   - `resolveFileDisplayMode()` function
   - `FileDisplayMode` interface

### Prompt Template (Optional but Recommended)
6. **`packages/coding-agent/src/prompts/tools/hashline.md`**
   - Complete model instruction template
   - Can be adapted for OpenCode tool descriptions

### Handlebars Helper (Optional)
7. **`packages/coding-agent/src/config/prompt-templates.ts`**
   - `hashline` helper registration
   - Only needed if using Handlebars templates

### Natural Abstraction Boundary

**Minimal Implementation Set:**
- `patch/hashline.ts` - Core hashline algorithms
- `patch/types.ts` - Type definitions
- `patch/index.ts` - Edit tool schemas and execution (hashline mode only)
- `tools/read.ts` - Read tool with hashline formatting

**Dependencies:**
- Bun's `Bun.hash.xxHash32()` (can replace with any xxHash32 implementation)
- TypeBox for schemas (optional, can replace with plain TypeScript types)
- LSP integration (optional, can omit if not needed)

---

## References

- https://github.com/can1357/oh-my-pi - Source repository
- https://blog.can.ac/2026/02/12/the-harness-problem/ - Hashline motivation
- Related: `/Volumes/Workspace/hashlines/notes/DESIGN.md` - Hashline plugin design for OpenCode

