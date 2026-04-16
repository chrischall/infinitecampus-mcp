import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

interface RawAssignment {
  id: number;
  courseName: string;
  title: string;
  missing: boolean;
  scored: boolean;
  points: number | null;
  due?: string;
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  courseId: z.string().optional(),
  since: z.string().describe('YYYY-MM-DD').optional(),
  until: z.string().describe('YYYY-MM-DD').optional(),
  missingOnly: z.boolean().optional(),
});

export function registerAssignmentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_assignments', {
    description: "List a student's assignments. Filterable by course and date range; missingOnly returns only un-submitted past-due work.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.courseId) params.set('sectionID', args.courseId);
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    const raw = await client.request<RawAssignment[]>(
      args.district, `/campus/api/portal/assignment/listView?${params}`,
    );
    const data = args.missingOnly ? raw.filter((a) => a.missing) : raw;
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
