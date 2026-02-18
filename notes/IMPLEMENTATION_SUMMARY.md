# Hashlines Plugin Implementation Summary

**Date:** 2026-02-18
**Status:** Complete

## Overview

Implemented the hashlines plugin for OpenCode based on the design in `notes/DESIGN.md`. The plugin provides hash-anchored file reading and editing to prevent corruption from stale line references.

## Project Structure

```
hashlines/
├── lib/
│   ├── hashline.ts    # Core hashline algorithms (implementation from oh-my-pi)
│   ├── types.ts       # Type definitions
│   └── schema.ts      # Zod schemas for validation
├── .opencode/
│   └── plugins/
│       └── hashline.ts  # Plugin with minimal tool wrappers
├── index.ts           # Main entry point
├── opencode.json      # OpenCode configuration
├── package.json       # Dependencies
└── README.md          # Documentation
```

## Implementation Details

### Core Library (`lib/hashline.ts`)

Copied from oh-my-pi (kept original implementation):

1. **Hash Algorithm**: Uses Bun's native `xxHash32` for high performance
   - Kept original Bun hash implementation since this is a Bun project
   - The oh-my-pi note said this "can be replaced" but not "should be replaced"
   - Native xxHash32 is significantly faster than JavaScript alternatives
2. **Line Normalization**: Whitespace normalization before hashing (spaces/tabs don't affect hash)
3. **Edit Operations**: Supports four operation types:
   - `set_line` - Replace single line
   - `replace_lines` - Replace contiguous range
   - `insert_after` - Insert after anchor line
   - `replace` - Fuzzy substring match (fallback)

### Tool Wrappers (`.opencode/plugins/hashline.ts`)

Minimal wrappers around the core library:

1. **hashread** - Read file with hash-anchored format
   - Accepts `path`, `start_line`, `end_line`
   - Returns content with `LINE:HASH|` prefixes
   - Validates file exists before reading

2. **hashedit** - Edit file with hash validation
   - Accepts `path` and `operations` array
   - Converts tool format to hashline format internally
   - Applies edits bottom-to-top automatically
   - Returns success message or hash mismatch warnings

3. **tool.execute.after hook** - Intercept built-in `read` tool
   - Strips existing line numbers if present
   - Re-formats with hashline prefixes
   - Adds warning to use hashread instead

### Configuration (`opencode.json`)

- Disables built-in `edit` tool
- Sets system prompt to instruct model to use hashread/hashedit

## Key Features

1. **Stable Anchors**: Hashes detect file changes before edits are applied
2. **Performance**: Uses Bun's native `xxHash32` for fast hash computation
3. **Error Handling**: Clear error messages for hash mismatches
4. **Backward Compatibility**: Hook intercepts built-in read as fallback

## Dependencies

- `@opencode-ai/plugin` - OpenCode plugin framework
- `zod` - Schema validation
- `@types/bun` - TypeScript types for Bun (dev)

## Build Status

✅ Plugin builds successfully
✅ Core hashline functions tested
✅ Type checking passes

## Usage Example

```typescript
// Read file with hash anchors
const content = await hashread({ path: "src/example.ts" });
// Returns: "1:a3|const x = 1\n2:b4|const y = 2\n..."

// Edit with hash validation
await hashedit({
  path: "src/example.ts",
  operations: [
    {
      op: "set_line",
      line: 1,
      hash: "a3",
      new_text: "const x = 99"
    }
  ]
});
```

## Next Steps

1. **Testing**: Add comprehensive test suite
2. **Publishing**: Prepare for npm publication as `opencode-hashline`
3. **Documentation**: Create user guide for OpenCode users
4. **Integration**: Test with OpenCode agent in real-world scenarios

## References

- Design: `notes/DESIGN.md`
- Original Implementation: `notes/oh-my-pi-hashline-implementation.md`
- Blog Post: https://blog.can.ac/2026/02/12/the-harness-problem/
- Source: https://github.com/can1357/oh-my-pi
