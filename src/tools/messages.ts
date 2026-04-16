import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const listArgs = z.object({
  district: z.string(),
  folder: z.enum(['inbox', 'sent']).optional(),
  page: z.number().int().positive().optional(),
  size: z.number().int().positive().optional(),
});

const getArgs = z.object({
  district: z.string(),
  messageId: z.string(),
});

const recipientsArgs = z.object({
  district: z.string(),
  studentId: z.string(),
});

export function registerMessageTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_messages', {
    description: 'List portal inbox or sent messages (district announcements, teacher notes).',
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const folder = args.folder ?? 'inbox';
    const params = new URLSearchParams({
      folder, page: String(args.page ?? 1), size: String(args.size ?? 50),
    });
    const data = await client.request(args.district, `/campus/api/portal/parents/messages?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_get_message', {
    description: 'Get a single portal message by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const data = await client.request(args.district, `/campus/api/portal/parents/messages/${encodeURIComponent(args.messageId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_list_message_recipients', {
    description: "List people the parent can message about this student (teachers + counselors). IDs returned here are the only valid recipientIds for ic_send_message.",
    annotations: { readOnlyHint: true },
    inputSchema: recipientsArgs.shape,
  }, async (rawArgs) => {
    const args = recipientsArgs.parse(rawArgs);
    const data = await client.request(args.district, `/campus/api/portal/parents/messageRecipients?personID=${encodeURIComponent(args.studentId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
