# Hashlines Plugin for OpenCode

A plugin for OpenCode that provides hash-anchored file reading and editing to prevent corruption from stale line references.

## Overview

The hashlines plugin implements a line-addressed edit format using content hashes called **hashlines**. Each line is identified by a `LINE:HASH` reference where:
- `LINE` is the 1-indexed line number
- `HASH` is a 2-character hex hash derived from the line content

The hashline system provides stable anchors that detect file changes before edits are applied, preventing corruption from stale references.

## Installation

Add the plugin to your `opencode.json` config file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@tianhuil/opencode-hashlines"],
  "agent": {
    "build": {
      "tools": { "edit": false },
      "prompt": "Always use `hashread` to read files and `hashedit` to edit them. Never use `edit` or `str_replace`. The hashread output format is `N:hh|line` — pass those hashes back to hashedit as anchors."
    }
  }
}
```

OpenCode will automatically install the plugin at startup. The key configuration change is setting `"tools": { "edit": false }` which disables OpenCode's built-in edit tool, forcing it to use the hash-anchored editing provided by this plugin.


Restart OpenCode to load the new plugin configuration.

### Why disable the built-in edit tool?

OpenCode's default `edit` tool uses simple line number references that can become stale when files change. This plugin replaces it with `hashread` and `hashedit`, which use content hashes to verify file integrity before applying edits, preventing corruption from outdated line references.

## Development

### Project Structure

All plugin code lives in the `src/` directory:

```
src/
├── index.ts              # Package entry point (exports)
├── hashline-plugin.ts    # Main plugin entry point
└── lib/
    ├── hashline.ts       # Core hashline functions
    └── types.ts          # TypeScript types
```

### Local Testing with Symlink

For local development, the `.opencode/plugins/hashline-plugin.ts` is a symlink to `../src/hashline-plugin.ts`. This allows you to:

1. Edit code in `src/`
2. Changes are immediately available to OpenCode without rebuilding
3. Build only needed when publishing to npm

The symlink is created automatically. If it breaks, recreate it:

```bash
ln -s ../src/hashline-plugin.ts .opencode/plugins/hashline-plugin.ts
```

### Building

```bash
# Install dependencies
bun install

# Build the package (outputs to dist/)
bun run build

# Type checking
bun run typecheck
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
      new_text: "combined = True"
    },
    {
      op: "insert_after",
      line: 10,
      hash: "f6",
      new_text: "# new comment"
    }
  ]
})
```

## Operations

Three edit operations are supported:

1. **set_line** - Replace a single line
2. **replace_lines** - Replace a contiguous range (use empty `new_content` for deletion)
3. **insert_after** - Add new content after an anchor line

## References

- [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/) - Background on hashlines
- [oh-my-pi](https://github.com/can1357/oh-my-pi) - Original implementation
- [OpenCode Plugins](https://opencode.ai/docs/plugins/) - Plugin documentation

## License

MIT
