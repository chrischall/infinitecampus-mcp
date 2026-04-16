import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const listArgs = z.object({
  district: z.string(),
  limit: z.number().int().positive().describe('Number of prism notifications to retrieve (default 20). Does not affect inbox or announcements.').optional(),
});

const countArgs = z.object({
  district: z.string(),
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

export function registerMessageTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_messages', {
    description:
      "List all parent-visible messages from three IC sources combined: (1) prism notifications (assignment alerts, grade postings, attendance alerts), (2) Messenger 2.0 inbox (teacher messages, district announcements with newMessage/actionRequired flags), and (3) portal userNotice announcements. Each section has its own count and items; if any source errors, that section contains an error field and the others still return normally. The `limit` arg caps the prism notifications only (the high-volume source).",
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
    description: 'Get unread notification/message count.',
    annotations: { readOnlyHint: true },
    inputSchema: countArgs.shape,
  }, async (rawArgs) => {
    const args = countArgs.parse(rawArgs);
    const data = await client.request(
      args.district,
      '/campus/prism?x=notifications.NotificationUser-countUnviewed',
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
