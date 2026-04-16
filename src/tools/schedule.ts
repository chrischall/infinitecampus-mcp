import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const argsSchema = z.object({
  district: z.string().describe('District name from ic_list_districts'),
  studentId: z.string().describe('Student personID from ic_list_students'),
  date: z.string().describe('YYYY-MM-DD; defaults to today').optional(),
  termFilter: z.string().describe('Term name or ID; optional').optional(),
});

export function registerScheduleTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_get_schedule', {
    description: "Get a student's class schedule for a given date (default: today).",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({ personID: args.studentId, date });
    if (args.termFilter) params.set('term', args.termFilter);
    const data = await client.request(args.district, `/campus/api/portal/parents/schedule?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
