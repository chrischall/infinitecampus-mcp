import {
  UNTRUSTED_CONTENT_RULE,
  minifiedResult,
  resolveView,
  stripMediaUrls,
  untrustedEnvelope,
  viewParam,
  type View,
} from '@chrischall/mcp-utils';
import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * **What compact does here, and what it deliberately does NOT do.**
 *
 * The read tools in this server hand back Infinite Campus's payload close to
 * verbatim, and the repo holds no verified record of what those payloads
 * contain — no captured fixture, no documented field list. So nothing here can
 * honestly say which of Infinite Campus's fields matter and which are noise.
 *
 * Compact therefore does the one projection that needs no such knowledge: it
 * strips image and avatar URLs. That is SUBTRACTIVE, so it cannot lose a field
 * nobody knew about — the failure an invented field list would risk, where a
 * record comes back with holes in it and reads like a verified answer.
 *
 * When a real payload can be captured, a field projection belongs here beside
 * this one and will save considerably more. Until then this is the honest
 * ceiling, and this docblock says so rather than implying a shape was checked.
 */
export const IC_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact strips image/avatar URLs from the response; "full" returns Infinite Campus\'s payload untouched. ' +
  'No field projection: this server has no verified record of which Infinite Campus fields matter, and inventing ' +
  'one would risk dropping a field a caller needs.';

/** The `view` parameter every read tool in this server takes. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(IC_VIEWS, { note: NOTE });

/**
 * Answer in the requested rung.
 *
 * Only ever called from a READ tool. A write's response is a receipt — an id,
 * a status — with nothing to strip and everything to keep.
 */
export function viewResponse(view: string | undefined, data: unknown): ReturnType<typeof minifiedResult> {
  const rung: View = resolveView(view, IC_VIEWS);
  return minifiedResult(rung === 'compact' ? stripMediaUrls(data) : data);
}

// ---------------------------------------------------------------------------
// The fleet brief-view contract (`view: "brief"`).
//
// One line per item, at most 120 characters, `title — <ISO date | no date> —
// <status>`. A line starting with `-- ` is a NOTE, not an item (`-- none`,
// `-- N of M shown`, `-- error: …`); a host composing a group answer
// (mcp-host's intent tools) drops notes from the item count and strips one
// leading backslash from every item line after the note check.

const BRIEF_MAX = 120;
/** The shortest a title is cut to before the date and status give way too. */
const TITLE_FLOOR = 24;

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(n - 1, 0))}…` : s);

/**
 * A brief line, `title — date — status`, cut to at most 120 characters as a
 * WHOLE, title first: the title shortens until the line fits, and only once it
 * is at its floor does the tail give way. A title starting with `-- ` or `\`
 * is escaped with one leading `\`, so third-party text can never read as a
 * note.
 */
export function briefLine(rawTitle: string, date: string, status: string): string {
  const title = rawTitle.startsWith('-- ') || rawTitle.startsWith('\\') ? `\\${rawTitle}` : rawTitle;
  const tail = ` — ${date} — ${status}`;
  if (title.length + tail.length <= BRIEF_MAX) return `${title}${tail}`;
  const shown = cut(title, Math.max(BRIEF_MAX - tail.length, Math.min(title.length, TITLE_FLOOR)));
  return cut(`${shown}${tail}`, BRIEF_MAX);
}

/** The brief answer when nothing matched: a note, never an item. */
export const BRIEF_NONE = '-- none';

/**
 * Answer a `view: "brief"` read whose lines carry third-party text: the lines
 * as the untrusted-data envelope's `data` array —
 * `{ untrusted_content: true, note, data: string[] }`, minified — so the marker
 * precedes the text wherever the result is read.
 */
export function untrustedBriefResponse(lines: string[], whoWrote: string): CallToolResult {
  const payload = untrustedEnvelope(lines, { note: `${whoWrote} ${UNTRUSTED_CONTENT_RULE}` });
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
