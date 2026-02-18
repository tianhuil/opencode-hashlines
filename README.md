# Hashlines Plugin for OpenCode

A plugin for OpenCode that provides hash-anchored file reading and editing to prevent corruption from stale line references.

## Overview

The hashlines plugin implements a line-addressed edit format using content hashes called **hashlines**. Each line is identified by a `LINE:HASH` reference where:
- `LINE` is the 1-indexed line number
- `HASH` is a 2-character hex hash derived from the line content

The hashline system provides stable anchors that detect file changes before edits are applied, preventing corruption from stale references.

## Installation

```bash
# Install dependencies
bun install

# The plugin is automatically loaded through OpenCode's plugin system
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

## References

- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) - Background on hashlines
- [oh-my-pi](https://github.com/can1357/oh-my-pi) - Original implementation
- [OpenCode Plugins](https://opencode.ai/docs/plugins/) - Plugin documentation
## License

This project is private.
