# Hashlines Plugin for OpenCode

A plugin for OpenCode that provides hash-anchored file reading and editing to prevent corruption from stale line references.

## Overview

The hashlines plugin implements a line-addressed edit format using content hashes called **hashlines**. Each line is identified by a `LINE:HASH` reference where:
- `LINE` is the 1-indexed line number
- `HASH` is a 2-character hex hash derived from the line content

The hashline system provides stable anchors that detect file changes before edits are applied, preventing corruption from stale references.

## Installation

```bash
bun install
```

## Usage

The plugin provides two tools:

### hashread
Read a file with hash-anchored line references. Each line is returned as `N:hh|content` where `hh` is a 2-char hash.

```typescript
await hashread({
  path: "src/example.ts",
  start_line: 1,    // optional
  end_line: 50,     // optional
})
```

### hashedit
Edit a file using line+hash anchors from hashread. Operations run bottom-to-top automatically.

```typescript
await hashedit({
  path: "src/example.ts",
  operations: [
    {
      op: "set_line",
      line: 42,
      hash: "a3",
      new_text: "const x = 99"
    },
    {
      op: "replace_lines",
      start_line: 5,
      start_hash: "b2",
      end_line: 8,
      end_hash: "c1",
      new_content: "combined = True"
    },
    {
      op: "insert_after",
      line: 10,
      hash: "f6",
      new_content: "# new comment"
    }
  ]
})
```

## Operations

Four edit operations are supported:

1. **set_line** - Replace a single line
2. **replace_lines** - Replace a contiguous range (use empty `new_content` for deletion)
3. **insert_after** - Add new content after an anchor line
4. **replace** - Fuzzy substring match (when line refs are unavailable)

## Implementation

The plugin is structured with minimal tool wrappers around a core library:

```
lib/
├── hashline.ts    # Core hashline algorithms
├── types.ts       # Type definitions
└── schema.ts      # Zod schemas for validation

.opencode/plugins/
└── hashline.ts    # Plugin with tool wrappers
```

### Key Functions

- `computeLineHash(idx, line)` - Calculate hash for a line
- `formatHashLines(content, startLine)` - Format content with `LINE:HASH|` prefix
- `parseLineRef(ref)` - Parse `LINE:HASH` references
- `applyHashlineEdits(content, edits)` - Apply edits with validation

## Hash Algorithm

The plugin uses a DJB2 hash on whitespace-normalized lines, truncated to 2 hex characters (256 possible values, ~0.4% collision rate). Whitespace normalization ensures that spacing differences don't cause hash mismatches.

## Error Handling

- **Hash mismatch**: If the line content has changed since reading, the hash won't match. Re-read the file and retry with the new hashes.
- **No-op error**: Identical content is rejected as a no-op. Verify you're targeting the correct line.

## Configuration

The `opencode.json` file disables the built-in edit tool and sets the system prompt to instruct the model to use hashread and hashedit:

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

## Plugin Hook

The plugin includes a `tool.execute.after` hook that intercepts the built-in `read` tool and rewrites its output to include hashes. This serves as a safety net if the model reaches for `read` anyway.

## References

- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) - Background on hashlines
- [oh-my-pi](https://github.com/can1357/oh-my-pi) - Original implementation
- [OpenCode Plugins](https://opencode.ai/docs/plugins/) - Plugin documentation

## License

This project is private.
