import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const listArgs = z.object({
  district: z.string(),
  limit: z.number().int().positive().describe('Number of prism notifications to retrieve (default 20). Does not affect inbox or announcements.').optional(),
});

const getArgs = z.object({
  district: z.string(),
  messageUrl: z.string().describe("The `url` field from an inbox item returned by ic_list_messages (e.g. 'portal/messageView.xsl?x=...&messageID=...'). Accepts relative or /campus/-prefixed paths."),
});

// ---- Shapes (passthrough / loose) ----

interface PrismNotification {
  notificationID?: number | string;
  creationTimestamp?: string;
  read?: boolean;
  notificationText?: string;
  notificationTypeText?: string;
  displayedDate?: string;
  [key: string]: unknown;
}

interface PrismNotificationsResponse {
  status?: string;
  data?: {
    NotificationList?: {
      Notification?: PrismNotification[];
    };
  };
}

interface InboxMessage {
  messageID?: number | string;
  date?: string;
  name?: string;
  sender?: string;
  messageType?: string;
  courseName?: string;
  studentName?: string;
  newMessage?: boolean;
  actionRequired?: boolean;
  dueDate?: string;
  url?: string;
  [key: string]: unknown;
}

const NOTIFICATION_KEEP = [
  'notificationID', 'creationTimestamp', 'read',
  'notificationText', 'notificationTypeText', 'displayedDate',
] as const;

const INBOX_KEEP = [
  'messageID', 'date', 'name', 'sender', 'messageType',
  'courseName', 'studentName', 'newMessage', 'actionRequired',
  'dueDate', 'url',
] as const;

function pick<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out as Partial<T>;
}

/**
 * Normalize a message URL (from ic_list_messages' inbox `url` field) to an
 * absolute path starting with `/campus/`. Accepts:
 *   - `portal/messageView.xsl?...` (relative, what IC actually returns)
 *   - `/campus/portal/messageView.xsl?...` (already absolute)
 *   - `messageView.xsl?...` (bare, also possible)
 */
export function normalizeMessageUrl(input: string): string {
  if (input.startsWith('/campus/')) return input;
  if (input.startsWith('/')) return `/campus${input}`;
  return `/campus/${input}`;
}

/**
 * Parse an IC messageView.xsl HTML response into a structured record.
 * The HTML has:
 *   <title>Message -- <subject></title>
 *   body with "Message: <subject>", "Date: MM/DD/YYYY", then the message body.
 * Dependency-free: no DOM parser, just regex + tag stripping.
 */
export function parseMessageHtml(
  html: string,
  url: string,
): { subject: string; date: string | null; body: string; url: string } {
  // Extract <title>
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  let subject = titleMatch ? titleMatch[1].trim() : '';
  subject = subject.replace(/^Message\s*--\s*/i, '');

  // Strip <script> and <style> blocks first
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode a few common entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Extract "Date: MM/DD/YYYY" if present
  const dateMatch = text.match(/Date:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const date = dateMatch ? dateMatch[1] : null;

  let body = text;
  if (dateMatch) {
    const idx = text.indexOf(dateMatch[0]);
    body = text.substring(idx + dateMatch[0].length).trim();
  }

  return { subject, date, body, url };
}

export function registerMessageTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_messages', {
    description:
      "List all parent-visible messages from three IC sources combined: (1) prism notifications (assignment alerts, grade postings, attendance alerts), (2) Messenger 2.0 inbox (teacher messages, district announcements with newMessage/actionRequired flags), and (3) portal userNotice announcements. Each section has its own count and items; if any source errors, that section contains an error field and the others still return normally. The `limit` arg caps the prism notifications only (the high-volume source). Note: listing inbox messages does not mark them as read in normal portal behavior, but some district configurations may update read-tracking; use ic_get_message for the full HTML body.",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const limit = args.limit ?? 20;

    const prismPromise = client.request<PrismNotificationsResponse>(
      args.district,
      `/campus/prism?x=notifications.Notification-retrieve&limitCount=${limit}`,
    ).then((raw) => {
      const items = raw?.data?.NotificationList?.Notification ?? [];
      const trimmed = items.map((n) => pick(n, NOTIFICATION_KEEP));
      return { count: trimmed.length, items: trimmed };
    }).catch((e) => {
      return { count: 0, items: [], error: e instanceof Error ? e.message : String(e) };
    });

    const inboxPromise = client.request<InboxMessage[] | null>(
      args.district,
      '/campus/api/portal/process-message',
    ).then((raw) => {
      const items = (raw ?? []).map((m) => pick(m, INBOX_KEEP));
      return { count: items.length, items };
    }).catch((e) => {
      return { count: 0, items: [], error: e instanceof Error ? e.message : String(e) };
    });

    const noticePromise = client.request<unknown[] | null>(
      args.district,
      '/campus/resources/portal/userNotice',
    ).then((raw) => {
      const items = raw ?? [];
      return { count: items.length, items };
    }).catch((e) => {
      return { count: 0, items: [], error: e instanceof Error ? e.message : String(e) };
    });

    const [notifications, inbox, announcements] = await Promise.all([prismPromise, inboxPromise, noticePromise]);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ notifications, inbox, announcements }, null, 2),
      }],
    };
  });

  server.registerTool('ic_get_message', {
    description: "Fetch the HTML body of an inbox message and return it parsed into { subject, date, body, url }. Takes a `messageUrl` which is the `url` field from an item returned by ic_list_messages' inbox section (e.g. 'portal/messageView.xsl?x=messenger.MessengerEngine-getMessageRecipientView&messageID=...'). Relative and /campus/-prefixed URLs are both accepted. Note: fetching the HTML body may mark the message as read on some district configurations; probe against an empty inbox could not confirm the side effect.",
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const path = normalizeMessageUrl(args.messageUrl);
    const html = await client.request<string>(args.district, path, { responseType: 'text' });
    const parsed = parseMessageHtml(html ?? '', path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(parsed, null, 2) }] };
  });
}
