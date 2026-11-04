/**
 * The `_meta.mint` context-group hint every tool in this server carries.
 *
 * mcp-host's gateway reads it (core `mintHintSchema`) to place a tool in a
 * context group — "school" here — and to know which tool answers which kind of
 * ask. All fields are optional, and the gateway drops any field that does not
 * match, so this type exists to make a mistyped hint a COMPILE error here
 * rather than a hint that silently stops grouping there. `tests/mint-hints.test.ts`
 * holds the same contract as a strict zod schema over the advertised list.
 *
 * - `subject`: the argument that takes the person the ask is about.
 * - `when`: the argument names for the start and end of a date range.
 * - `aliases`: at most 8, each at most 40 characters, lowercase.
 */
export interface MintHint {
  domain?: 'school' | 'home' | 'work' | 'family' | 'health' | 'money' | 'travel' | 'food';
  intent?: 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}
