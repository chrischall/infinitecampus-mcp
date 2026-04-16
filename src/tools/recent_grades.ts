import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent } from './_shared.js';

interface RawRecentGrade {
  assignmentName?: string;
  courseName?: string;
  sectionID?: number;
  dueDate?: string;
  scoreModifiedDate?: string;
  score?: string | null;
  scorePoints?: string | null;
  scorePercentage?: number | null;
  totalPoints?: number;
  missing?: boolean;
  late?: boolean;
  turnedIn?: boolean;
  feedback?: string | null;
  comments?: string | null;
  [key: string]: unknown;
}

interface TrimmedRecentGrade {
  assignmentName?: string;
  courseName?: string;
  sectionID?: number;
  dueDate?: string;
  scoreModifiedDate?: string;
  score?: string | null;
  scorePoints?: string | null;
  scorePercentage?: number | null;
  totalPoints?: number;
  missing?: boolean;
  late?: boolean;
  turnedIn?: boolean;
  feedback?: string | null;
  comments?: string | null;
  [key: string]: unknown;
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().describe('YYYY-MM-DD; defaults to 14 days ago. Passed to the endpoint as an ISO timestamp (modifiedDate filter).').optional(),
});

const KEYS: Array<keyof TrimmedRecentGrade> = [
  'assignmentName', 'courseName', 'sectionID', 'dueDate', 'scoreModifiedDate',
  'score', 'scorePoints', 'scorePercentage', 'totalPoints',
  'missing', 'late', 'turnedIn', 'feedback', 'comments',
];

function defaultSinceDate(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().substring(0, 10);
}

export function registerRecentGradesTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_recent_grades', {
    description: "List recently-graded assignments for a student. Server-side filtered by scoreModifiedDate. Pass since=YYYY-MM-DD to set the cutoff; defaults to 14 days ago.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const sinceDate = args.since ?? defaultSinceDate(new Date());
    const modifiedDate = `${sinceDate}T00:00:00`;

    const raw = await client.request<RawRecentGrade[]>(
      args.district,
      `/campus/api/portal/assignment/recentlyScored?modifiedDate=${encodeURIComponent(modifiedDate)}&personID=${encodeURIComponent(args.studentId)}`,
    );

    const trimmed: TrimmedRecentGrade[] = (raw ?? []).map((g) => {
      const out: TrimmedRecentGrade = {};
      for (const key of KEYS) {
        const v = g[key];
        if (v !== undefined) out[key] = v;
      }
      return out;
    });
    return textContent(trimmed);
  });
}
