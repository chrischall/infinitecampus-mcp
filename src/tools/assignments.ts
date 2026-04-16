import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

interface RawAssignment {
  assignmentName: string;
  courseName: string;
  sectionID: number;
  dueDate?: string;
  assignedDate?: string;
  scoreModifiedDate?: string;
  missing: boolean;
  late: boolean;
  turnedIn: boolean;
  dropped: boolean;
  score: string | null;
  scorePoints: string | null;
  scorePercentage: number | null;
  totalPoints: number;
  comments: string | null;
  feedback: string | null;
  // ...other fields preserved by passthrough
  [key: string]: unknown;
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  courseId: z.string().describe('sectionID (optional, from ic_get_schedule). The endpoint supports server-side filtering by sectionID only.').optional(),
  since: z.string().describe('YYYY-MM-DD; filters dueDate >= since (client-side)').optional(),
  until: z.string().describe('YYYY-MM-DD; filters dueDate <= until (client-side)').optional(),
  missingOnly: z.boolean().describe('Only return assignments flagged missing by the teacher').optional(),
});

export function registerAssignmentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_assignments', {
    description:
      "List a student's assignments. The IC endpoint returns the full term history (~hundreds of items); date and missing filters are applied client-side. For a single course, pass courseId (the sectionID from ic_get_schedule).",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    // Only sectionID is accepted server-side; startDate/endDate are ignored by the IC endpoint.
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.courseId) params.set('sectionID', args.courseId);

    const raw = await client.request<RawAssignment[]>(
      args.district, `/campus/api/portal/assignment/listView?${params}`,
    );

    let data = raw;
    if (args.since) {
      const since = args.since;
      data = data.filter((a) => typeof a.dueDate === 'string' && a.dueDate >= since);
    }
    if (args.until) {
      const until = args.until;
      // Inclusive upper bound: compare YYYY-MM-DD prefix of dueDate
      data = data.filter((a) => typeof a.dueDate === 'string' && a.dueDate.substring(0, 10) <= until);
    }
    if (args.missingOnly) {
      data = data.filter((a) => a.missing);
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
