import { McpServer } from '@modelcontextprotocol/server';
import { viewArg, viewResponse } from '../view.js';
import { z } from 'zod';
import { IsoDate, shiftIsoDate, todayIso } from '@chrischall/mcp-utils';
import type { ICClient } from '../client.js';

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
  since: IsoDate.describe('YYYY-MM-DD; defaults to 14 days ago. Passed to the endpoint as an ISO timestamp (modifiedDate filter).').optional(),
});

const KEYS: Array<keyof TrimmedRecentGrade> = [
  'assignmentName', 'courseName', 'sectionID', 'dueDate', 'scoreModifiedDate',
  'score', 'scorePoints', 'scorePercentage', 'totalPoints',
  'missing', 'late', 'turnedIn', 'feedback', 'comments',
];

// "Two weeks ago" is the parent's calendar day, not UTC's: todayIso() follows
// MCP_USER_TZ (set by the host) or the local zone, so a US evening on a UTC
// server does not move the cutoff a day later and drop boundary-day grades.
function defaultSinceDate(): string {
  return shiftIsoDate(todayIso(), -14);
}

export function registerRecentGradesTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_recent_grades', {
    description: "List recently-graded assignments for a student. Server-side filtered by scoreModifiedDate. Pass since=YYYY-MM-DD to set the cutoff; defaults to 14 days ago.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ ...argsSchema.shape, view: viewArg() }),
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const sinceDate = args.since ?? defaultSinceDate();
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
    return viewResponse((rawArgs as { view?: string }).view, trimmed);
  });
}
