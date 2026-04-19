import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, toArray } from './_shared.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
});

interface TeacherContact {
  sectionID?: number;
  courseName?: string;
  courseNumber?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  title?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface CounselorContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  displayName?: string;
  [key: string]: unknown;
}

// Fields we drop from teacher/counselor contact records (internal IDs, model markers)
const DROP_KEYS = new Set([
  '_id', '_model', '_hashCode', 'mTime', 'action', 'personID', 'studentPersonID',
  'isKentucky', 'pairID', 'pairedEvent',
]);

function trimRecord<T extends Record<string, unknown>>(raw: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function registerTeacherTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_teachers', {
    description: "List a student's teachers (per enrolled section) and assigned counselor(s). Combines two endpoints (section/contacts and studentCounselor/byUser). Response field shapes may vary slightly by district — core fields (firstName, lastName, email) are consistent; additional fields are passed through.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const personID = encodeURIComponent(args.studentId);

    const teachersPromise = client.request<TeacherContact | TeacherContact[] | null>(
      args.district,
      `/campus/resources/portal/section/contacts?personID=${personID}`,
    ).catch((e) => {
      if (is404(e)) return null;
      throw e;
    });

    const counselorsPromise = client.request<CounselorContact | CounselorContact[] | null>(
      args.district,
      `/campus/resources/portal/studentCounselor/byUser?personID=${personID}`,
    ).catch((e) => {
      if (is404(e)) return null;
      throw e;
    });

    const [teachersRaw, counselorsRaw] = await Promise.all([teachersPromise, counselorsPromise]);

    const teachers = toArray(teachersRaw).map((t) => trimRecord(t));
    const counselors = toArray(counselorsRaw).map((c) => trimRecord(c));

    return textContent({ counselors, teachers });
  });
}
