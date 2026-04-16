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

const sendArgs = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID; used to validate recipient IDs'),
  recipientIds: z.array(z.string()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
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
    const data = await client.request(args.district, `/campus/resources/portal/messages?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_get_message', {
    description: 'Get a single portal message by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const data = await client.request(args.district, `/campus/resources/portal/messages/${encodeURIComponent(args.messageId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_list_message_recipients', {
    description: "List people the parent can message about this student (teachers + counselors). IDs returned here are the only valid recipientIds for ic_send_message.",
    annotations: { readOnlyHint: true },
    inputSchema: recipientsArgs.shape,
  }, async (rawArgs) => {
    const args = recipientsArgs.parse(rawArgs);
    const data = await client.request(args.district, `/campus/resources/portal/messageRecipients?personID=${encodeURIComponent(args.studentId)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.registerTool('ic_send_message', {
    description: 'Send a portal message to a teacher/counselor about a student. recipientIds MUST come from ic_list_message_recipients for that student.',
    annotations: { destructiveHint: true },
    inputSchema: sendArgs.shape,
  }, async (rawArgs) => {
    const args = sendArgs.parse(rawArgs);
    const valid = await client.request<Array<{ recipientId: string }>>(
      args.district,
      `/campus/resources/portal/messageRecipients?personID=${encodeURIComponent(args.studentId)}`,
    );
    const validIds = valid.map((v) => v.recipientId);
    const invalidIds = args.recipientIds.filter((id) => !validIds.includes(id));
    if (invalidIds.length > 0) {
      const err = { error: 'InvalidRecipient', invalidIds, validIds };
      return { content: [{ type: 'text' as const, text: JSON.stringify(err, null, 2) }] };
    }

    const data = await client.request(args.district, '/campus/resources/portal/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientIds: args.recipientIds,
        subject: args.subject,
        body: args.body,
        personID: args.studentId,
      }),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
