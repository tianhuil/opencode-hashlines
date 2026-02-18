# Oh-My-Pi Hashline Implementation Comparison

**Date:** 2026-02-18
**Topic:** Comparison of oh-my-pi hashline implementation with current OpenCode plugin
**Related:** [DESIGN.md](./DESIGN.md), [oh-my-pi-hashline-implementation.md](./oh-my-pi-hashline-implementation.md)

---

## Executive Summary

This report compares the oh-my-pi hashline implementation with the current OpenCode plugin implementation. The OpenCode plugin uses a **simplified core implementation** that is **functionally complete** for its use case, while oh-my-pi includes many **advanced features** for robust production use.

**Key Findings:**
- Core hashline functions (computeLineHash, formatHashLines, parseLineRef, applyHashlineEdits) are **identical or nearly identical**
- OpenCode plugin uses **Zod schemas** instead of TypeBox for validation
- OpenCode plugin uses **simplified operation format** (`op` + separate params) vs oh-my-pi's nested format
- Many advanced features in oh-my-pi are **not required** for the OpenCode plugin's simpler use case
- Missing features are primarily: **streaming, merge heuristics, hash relocation, LSP integration, and diff generation**

---

## Detailed Findings

### 1. Core Hashline Functions (lib/hashline.ts)

#### ✅ Identical Implementation

**File:** `lib/hashline.ts` vs `packages/coding-agent/src/patch/hashline.ts`

| Function | Status | Notes |
|-----------|--------|-------|
| `computeLineHash(idx, line)` | ✅ Identical | Same algorithm using xxHash32 with whitespace normalization |
| `formatHashLines(content, startLine)` | ✅ Identical | Same format: `LINE:HASH\|content` |
| `parseLineRef(ref)` | ✅ Identical | Same parsing logic with strict/loose matching |
| `applyHashlineEdits(content, edits)` | ⚠️ Simplified | Core logic present, missing advanced features |

#### Implementation Details - computeLineHash

**Both implementations are identical:**

```typescript
const HASH_LEN = 2;
const RADIX = 16;
const HASH_MOD = RADIX ** HASH_LEN;

const DICT = Array.from({ length: HASH_MOD }, (_, i) =>
  i.toString(RADIX).padStart(HASH_LEN, "0")
);

export function computeLineHash(idx: number, line: string): string {
  if (line.endsWith("\r")) {
    line = line.slice(0, -1);
  }
  line = line.replace(/\s+/g, ""); // Normalize whitespace
  void idx; // Not used, kept for compatibility
  return DICT[Bun.hash.xxHash32(line) % HASH_MOD];
}
```

#### Implementation Details - applyHashlineEdits

**Core logic is identical, but oh-my-pi has significant additions:**

**OpenCode Plugin (simplified):**
- Parses edits, sorts bottom-to-top
- Validates hashes
- Applies edits to file lines
- Returns warnings and no-op edits

**oh-my-pi (advanced):**
- All of the above PLUS:
  - Hash relocation (finds moved lines automatically)
  - Duplicate edit deduplication
  - Merge heuristics (handles model mistakes)
  - Advanced error formatting with context
  - Warning generation for excessive changes

---

### 2. Type Definitions (lib/types.ts)

#### ✅ Core Types Match

| Type | OpenCode Plugin | oh-my-pi | Status |
|------|----------------|-----------|--------|
| `LineRef` | `{ line, hash }` | `{ line, hash }` | ✅ Identical |
| `HashMismatch` | `{ line, expected, actual }` | `{ line, expected, actual }` | ✅ Identical |
| `HashlineEditSpec` | Union of parsed types | Internal-only | ✅ Compatible |
| `ParsedEdit` | `{ edit, index }` | Internal variable | ✅ Compatible |
| `HashlineEdit` | Schema-based | TypeBox-derived | ⚠️ Different format |
| `HashlineMismatchError` | Simple class | Advanced class | ⚠️ Simplified |

**Difference in HashlineEdit format:**

**OpenCode Plugin (schema.ts):**
```typescript
export interface HashlineEdit {
  set_line?: { anchor: string; new_text: string };
  replace_lines?: { start_anchor: string; end_anchor: string; new_text: string };
  insert_after?: { anchor: string; text: string };
  replace?: { old_text: string; new_text: string; all?: boolean };
}
```

**oh-my-pi (derived from TypeBox schema):**
```typescript
export type HashlineEdit = Static<typeof hashlineEditItemSchema>;
// Same structure but derived from runtime TypeBox schema
```

---

### 3. Schema Definitions (lib/schema.ts)

#### ⚠️ Different Validation Library and Format

| Aspect | OpenCode Plugin | oh-my-pi | Impact |
|--------|----------------|-----------|--------|
| Validation library | Zod | TypeBox | ✅ Both work, Zod is simpler |
| Anchor format | `{ line, hash }` (flattened) | `anchor: "LINE:HASH"` (string) | ⚠️ Different input format |
| Replacement field | `new_text` | `new_text` | ✅ Identical |
| Insert field | `new_content` | `text` | ⚠️ Different field name |

**OpenCode Plugin schema (Zod):**
```typescript
const setLineSchema = z.object({
  op: { const: "set_line" },
  line: { type: "number" },
  hash: { type: "string" },
  new_text: { type: "string" },
});
```

**oh-my-pi schema (TypeBox):**
```typescript
const hashlineSingleSchema = Type.Object({
  set_line: Type.Object({
    anchor: Type.String({ description: 'Line reference "LINE:HASH"' }),
    new_text: Type.String({ description: 'Replacement content (\\n-separated) — "" for delete' }),
  }),
});
```

**Note:** The OpenCode plugin uses a **flattened format** for the tool schema to make it more explicit for the model:
- `{ op: "set_line", line: 42, hash: "a3", new_text: "..." }`
- vs oh-my-pi: `{ set_line: { anchor: "42:a3", new_text: "..." } }`

---

### 4. Tool Implementation (.opencode/plugins/hashline.ts)

#### ✅ Core Functionality Matches

**Both implementations provide:**
1. `hashread` tool - reads file with hashline prefixes
2. `hashedit` tool - applies hashline edits
3. Hook to intercept built-in `read` and upgrade output

#### Differences

| Feature | OpenCode Plugin | oh-my-pi | Required? |
|---------|----------------|-----------|-----------|
| Edit modes | Single (hashline) | Three (replace, patch, hashline) | ❌ No |
| LSP integration | None | Full support | ❌ No |
| Diagnostics | None | Rich diagnostics | ❌ No |
| File system abstraction | Node.js fs | Pluggable FS | ❌ No |
| Error formatting | Simple | Advanced with context | ❌ No |
| Warnings | Basic | Advanced | ❌ No |

**Note:** The OpenCode plugin's flattened tool format is **not required** - it's a design choice for clarity. The plugin could use oh-my-pi's nested format if preferred.

---

## Features in oh-my-pi NOT Present in OpenCode Plugin

### 1. Streaming Functions (NOT Required for OpenCode)

```typescript
// For large files where you want incremental output
export async function* streamHashLinesFromUtf8(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string>

export async function* streamHashLinesFromLines(
  lines: Iterable<string> | AsyncIterable<string>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string>
```

**Use case:** Processing very large files without loading entire content into memory.

**Required for OpenCode?** ❌ No - the plugin reads entire files, which is fine for typical source files.

---

### 2. Merge Heuristics (NOT Required for OpenCode)

oh-my-pi includes sophisticated heuristics to handle model mistakes:

- `equalsIgnoringWhitespace(a, b)` - Compare ignoring whitespace differences
- `stripAllWhitespace(s)` - Remove all whitespace for comparison
- `stripTrailingContinuationTokens(s)` - Handle model merging continuation lines
- `stripMergeOperatorChars(s)` - Handle operator changes while merging
- `leadingWhitespace(s)` - Extract indentation
- `restoreLeadingIndent(template, line)` - Preserve original indentation
- `normalizeConfusableHyphens(s)` - Handle Unicode hyphen variants
- `restoreIndentForPairedReplacement(old, new)` - Fix indentation in replacements
- `restoreOldWrappedLines(old, new)` - Undo line reflowing
- `stripInsertAnchorEchoAfter(anchor, dst)` - Remove echoed anchor lines
- `stripRangeBoundaryEcho(file, start, end, dst)` - Remove echoed boundary lines
- `stripNewLinePrefixes(lines)` - Remove hashline/diff prefixes from model output
- `maybeExpandSingleLine(line, dst)` - Handle multi-line merges

**Use case:** Robustly handle cases where models accidentally:
- Merge adjacent lines
- Copy hashline prefixes into replacement content
- Change only whitespace
- Echo surrounding lines

**Required for OpenCode?** ❌ No - the plugin relies on the model to provide clean input. These are defensive programming for production use.

---

### 3. Hash Relocation (NOT Required for OpenCode)

```typescript
// If a line moved, automatically find its new location by hash
function validateOrRelocateRef(ref: { line: number; hash: string }): {
  ok: true; relocated: boolean
} | { ok: false }
```

**Use case:** When file content changed since the model last read it, automatically find moved lines instead of failing.

**Required for OpenCode?** ❌ No - the plugin expects the model to re-read files if hashes mismatch, which is the documented workflow.

---

### 4. Advanced Error Handling (NOT Required for OpenCode)

**HashlineMismatchError class with context:**

```typescript
export class HashlineMismatchError extends Error {
  readonly remaps: ReadonlyMap<string, string>;
  constructor(
    public readonly mismatches: HashMismatch[],
    public readonly fileLines: string[],
  )
  static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string
}
```

**Features:**
- Shows context lines around mismatched lines
- Marks changed lines with `>>>`
- Displays correct hashes for all mismatched lines at once
- Provides remapping dictionary for quick fixes

**Use case:** Help model quickly correct all stale references in one retry.

**Required for OpenCode?** ❌ No - the plugin returns simple warning messages. The workflow expects re-reading the file.

---

### 5. Duplicate Edit Deduplication (NOT Required for OpenCode)

```typescript
// Remove duplicate edits targeting same line(s) with same content
const seenEditKeys = new Map<string, number>();
const dedupIndices = new Set<number>();
// ... deduplication logic ...
```

**Use case:** When model accidentally submits the same edit multiple times.

**Required for OpenCode?** ❌ No - this is an edge case optimization.

---

### 6. Warning Generation (NOT Required for OpenCode)

```typescript
let diffLineCount = Math.abs(fileLines.length - originalFileLines.length);
// ... count changed lines ...
if (diffLineCount > edits.length * 4) {
  warnings.push(
    `Edit changed ${diffLineCount} lines across ${edits.length} operations — verify no unintended reformatting.`
  );
}
```

**Use case:** Detect when edits cause excessive unintended changes (e.g., model accidentally reformatted entire function).

**Required for OpenCode?** ❌ No - but this could be a nice-to-have addition.

---

### 7. Diff Generation (PARTIALLY Required - Hashline Diff IS Present)

**Important:** There IS a hashline-specific diff function in oh-my-pi:

```typescript
/**
 * Compute the diff for a hashline operation without applying it.
 * Used for preview rendering in the TUI before hashline-mode edits execute.
 */
export async function computeHashlineDiff(
  input: { path: string; edits: HashlineEdit[] },
  cwd: string,
): Promise<DiffResult | DiffError>
```

**How it works:**
1. Takes hashline edit operations as input
2. Reads the original file content
3. Applies `applyHashlineEdits()` to get the new content
4. Calls `generateDiffString(old, new)` to produce a **standard unified diff**

**The diff output format is NOT hashline format:**
- Uses standard unified diff with `+`, `-`, and ` ` prefixes
- Line numbers are shown (e.g., `  42|content`)
- NO hashline prefixes like `42:a3|content`

**Standard diff functions (not hashline-specific):**

```typescript
export function generateDiffString(oldContent: string, newContent: string): DiffResult
export function generateUnifiedDiffString(oldContent: string, newContent: string): DiffResult
```

**Use cases:**
- `computeHashlineDiff` - Preview hashline edits before applying (TUI use)
- `generateDiffString` - Show final changes to user (all edit modes)
- `generateUnifiedDiffString` - Git-style diff without file headers

**Required for OpenCode?** ⚠️ Partially
- `computeHashlineDiff` - Could be useful for preview/validation
- `generateDiffString` - Not strictly required (OpenCode handles output display)

**Implementation complexity:** The diff functions use the `diff` npm library to generate standard unified diffs. The hashline-specific version is just a wrapper that applies edits first, then diffs the results.

---

### 8. LSP Integration (NOT Required for OpenCode)

```typescript
class LspFileSystem implements FileSystem {
  // ... LSP writethrough for diagnostics and formatting ...
}

const diagnostics = await this.#writethrough(absolutePath, finalContent, ...);
```

**Use case:** Get language server diagnostics (errors, warnings) and auto-format after edits.

**Required for OpenCode?** ❌ No - OpenCode has its own tooling ecosystem.

---

### 9. File System Abstraction (NOT Required for OpenCode)

```typescript
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary?(path: string): Promise<Uint8Array>;
  write(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
```

**Use case:** Support testing with mock file systems and LSP integration.

**Required for OpenCode?** ❌ No - the plugin uses Node.js built-in `fs` module directly.

---

### 10. Fuzzy Matching (NOT Required for OpenCode)

```typescript
export function replaceText(
  content: string,
  searchText: string,
  replaceText: string,
  options: { fuzzy?: boolean; all?: boolean; threshold?: number }
): { content: string; count: number }
```

**Use case:** `replace` operation as fallback when line references unavailable.

**Required for OpenCode?** ❌ No - the plugin doesn't implement the `replace` operation (only `set_line`, `replace_lines`, `insert_after`).

---

## What IS Required to Adapt from oh-my-pi

### ✅ Nothing - The Implementation is Already Adapted

The OpenCode plugin has already extracted the minimal required functions from oh-my-pi:

**Core implementation is present:**
- ✅ `computeLineHash` - Identical
- ✅ `formatHashLines` - Identical
- ✅ `parseLineRef` - Identical
- ✅ `applyHashlineEdits` - Core logic present (simplified but functional)
- ✅ `detectLineEnding` - Present in lib/hashline.ts
- ✅ `normalizeToLF` - Present in lib/hashline.ts
- ✅ `stripBom` - Present in lib/hashline.ts
- ✅ Type definitions for core operations - Present in lib/types.ts
- ✅ Zod schemas for validation - Present in lib/schema.ts (TypeBox replacement)
- ✅ Tool wrappers for hashread and hashedit - Present in .opencode/plugins/hashline.ts

**The differences are intentional simplifications:**
1. Flattened tool schema format (design choice for clarity)
2. Use of Zod instead of TypeBox (simpler dependency)
3. No streaming (not needed for typical file sizes)
4. No merge heuristics (rely on model to provide clean input)
5. No hash relocation (expect model to re-read on mismatch)
6. No LSP integration (outside OpenCode plugin scope)

---

## Recommended Improvements (Optional)

If you want to make the plugin more robust, consider adding:

### 1. Warning for Excessive Changes

**Add to lib/hashline.ts `applyHashlineEdits` function:**

```typescript
// After applying all edits:
const warnings: string[] = [];
let diffLineCount = Math.abs(fileLines.length - originalFileLines.length);
for (let i = 0; i < Math.min(fileLines.length, originalFileLines.length); i++) {
  if (fileLines[i] !== originalFileLines[i]) diffLineCount++;
}
if (diffLineCount > edits.length * 4) {
  warnings.push(
    `Edit changed ${diffLineCount} lines across ${edits.length} operations — verify no unintended reformatting.`
  );
}
```

**Impact:** Helps catch accidental large-scale reformatting by the model.

**Effort:** Low (5-10 lines of code).

---

### 2. Better Error Formatting

**Enhance HashlineMismatchError to show context:**

```typescript
export class HashlineMismatchError extends Error {
  constructor(public readonly mismatches: HashMismatch[]) {
    const message = HashlineMismatchError.formatMessage(mismatches);
    super(message);
    this.name = "HashlineMismatchError";
  }

  static formatMessage(mismatches: HashMismatch[]): string {
    const lines: string[] = [];
    lines.push(`${mismatches.length} line(s) have changed since last read.`);

    for (const m of mismatches) {
      lines.push(
        `  Line ${m.line}: expected ${m.expected}, got ${m.actual}`
      );
    }

    return lines.join("\n");
  }
}
```

**Impact:** Makes hash mismatch errors more informative.

**Effort:** Low (10-15 lines of code).

---

### 3. Strip Hashline Prefixes from Model Output

**Add helper to strip accidental hashline prefixes:**

```typescript
const HASHLINE_PREFIX_RE = /^\s*\d+:[0-9a-f]{2}\|/;

function stripHashlinePrefixes(lines: string[]): string[] {
  // Only strip if majority of lines have prefixes
  const prefixCount = lines.filter(l => HASHLINE_PREFIX_RE.test(l)).length;
  if (prefixCount < lines.length * 0.5) return lines;

  return lines.map(l => l.replace(HASHLINE_PREFIX_RE, ""));
}
```

**Impact:** Prevents corruption when model copies hashline prefixes into replacement.

**Effort:** Low (5-10 lines of code).

---

## Conclusion

### Summary

The OpenCode plugin's implementation is a **well-designed simplification** of oh-my-pi's hashline system:

**✅ What's working:**
- All core hashline algorithms are correctly implemented
- Type definitions are complete
- Schema validation works (Zod vs TypeBox is a valid choice)
- Tool wrappers provide clean interface for the model
- Flattened schema format is clearer for models to use

**⚠️ What's missing (by design):**
- Streaming for very large files
- Merge heuristics to handle model mistakes
- Hash relocation for automatic recovery
- Advanced error formatting
- Duplicate edit deduplication
- LSP integration (outside plugin scope)
- Fuzzy matching fallback (not used)

**❌ What's NOT required:**
- Nothing - the implementation is complete for its intended use case

### Recommendation

**No changes required.** The current implementation is production-ready for the OpenCode plugin's use case.

If you want to enhance robustness, consider adding:
1. Warning for excessive changes (5-10 lines)
2. Better error formatting (10-15 lines)
3. Strip hashline prefixes (5-10 lines)

These are **optional improvements**, not requirements.

---

## Clarification: Diff Generation and Hashlines

**Question:** Does diff generation use hashlines in oh-my-pi?

**Answer:** Partially - there IS a `computeHashlineDiff` function that accepts hashline edits as input.

### How Hashline Diff Works

```typescript
/**
 * Compute the diff for a hashline operation without applying it.
 * Used for preview rendering in the TUI before hashline-mode edits execute.
 */
export async function computeHashlineDiff(
  input: { path: string; edits: HashlineEdit[] },
  cwd: string,
): Promise<DiffResult | DiffError> {
  // 1. Read the original file
  // 2. Apply hashline edits using applyHashlineEdits()
  // 3. Generate standard unified diff between old and new content
  return generateDiffString(normalizedContent, result.content);
}
```

### Key Points

1. **Input format:** Uses hashline edit operations (`set_line`, `replace_lines`, `insert_after`)

2. **Output format:** Standard unified diff with `+`, `-`, and ` ` prefixes - NOT hashline format

   Example diff output:
   ```
   -  42|old content
   +  42|new content
   ```

3. **Not hashline format:** The diff does NOT use `42:a3|old content` format - it uses standard line numbers

4. **Purpose:** Preview functionality for TUI before applying edits

### Standard Diff Functions

The other diff functions are mode-agnostic and don't use hashlines:

```typescript
export function generateDiffString(oldContent: string, newContent: string): DiffResult
export function generateUnifiedDiffString(oldContent: string, newContent: string): DiffResult
```

These generate standard unified diffs for any edit mode (replace, patch, or hashline).

### Required for OpenCode?

- `computeHashlineDiff` - ⚠️ Could be useful for preview/validation but not required
- `generateDiffString` - ❌ Not required (OpenCode handles output display)

**Implementation note:** If you want diff preview, the `computeHashlineDiff` function is straightforward to implement:
- Read file
- Apply `applyHashlineEdits()` (already have this)
- Call a standard diff library like `diff` npm package

---

## References

- **oh-my-pi repository:** https://github.com/can1357/oh-my-pi
- **oh-my-pi hashline.ts:** https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/patch/hashline.ts
- **oh-my-pi patch/index.ts:** https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/patch/index.ts
- **Current implementation:** `lib/hashline.ts`, `lib/types.ts`, `lib/schema.ts`, `.opencode/plugins/hashline.ts`
- **Background:** [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/)
- **Related:** [DESIGN.md](./DESIGN.md), [oh-my-pi-hashline-implementation.md](./oh-my-pi-hashline-implementation.md)
