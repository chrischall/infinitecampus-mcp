import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().describe('YYYY-MM-DD').optional(),
  until: z.string().describe('YYYY-MM-DD').optional(),
});

export function registerAttendanceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_attendance', {
    description: "List a student's absences and tardies in a date range.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/resources/portal/attendance?${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC 404 ')) {
        const warn = { warning: 'FeatureDisabled', feature: 'attendance', district: args.district, data: [] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
