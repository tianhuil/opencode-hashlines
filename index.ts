/**
 * Hashline Plugin
 *
 * A plugin for OpenCode that provides hash-anchored file reading and editing.
 */

export { HashlinePlugin } from "./src/hashline-plugin.js";

// Export core hashline functions for direct use
export {
  computeLineHash,
  formatHashLines,
  parseLineRef,
  applyHashlineEdits,
  detectLineEnding,
  normalizeToLF,
  stripBom
} from "./src/lib/hashline.js";

export type { HashlineEdit, HashlineEditSpec, ParsedEdit, HashMismatch, LineRef } from "./src/lib/types.js";
