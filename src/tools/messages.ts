import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const listArgs = z.object({
  district: z.string(),
  limit: z.number().int().positive().describe('Number of notifications to retrieve (default 20)').optional(),
});

const countArgs = z.object({
  district: z.string(),
});

const getArgs = z.object({
  district: z.string(),
  messageId: z.string(),
});

export function registerMessageTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_messages', {
    description: 'List portal notifications (district announcements, teacher messages, system alerts). Uses the IC prism notification system.',
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const limit = args.limit ?? 20;
    const data = await client.request(
      args.district,
      `/campus/prism?x=notifications.Notification-retrieve&limitCount=${limit}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
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
