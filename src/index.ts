/**
 * Hashline Plugin
 *
 * A plugin for OpenCode that provides hash-anchored file reading and editing.
 */

export { HashlinePlugin } from "./hashline-plugin.js";

// Export core hashline functions for direct use
export {
  computeLineHash,
  formatHashLines,
  parseLineRef,
  applyHashlineEdits,
  detectLineEnding,
  normalizeToLF,
  stripBom
} from "./lib/hashline.js";

export type { HashlineEdit, HashlineEditSpec, ParsedEdit, HashMismatch, LineRef } from "./lib/types.js";
