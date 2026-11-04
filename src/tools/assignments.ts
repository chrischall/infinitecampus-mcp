import { McpServer } from '@modelcontextprotocol/server';
import { IC_VIEWS, viewResponse } from '../view.js';
import { z } from 'zod';
import { IsoDate, McpToolError, rawTextResult } from '@chrischall/mcp-utils';
import type { ToolRegistrar } from '@chrischall/mcp-utils';
import type { ICClient } from '../client.js';
import type { RawStudent } from './_shared.js';
import type { MintHint } from '../mint.js';

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

/** Where a student label points. */
export interface StudentRef {
  district: string;
  studentId: string;
}

/** Label → (district, studentId), in district then roster order. */
export type StudentLabels = Map<string, StudentRef>;

/**
 * How long the START-time label build may hold up registration. It runs before
 * the server answers `initialize`, so it is bounded; a miss costs only the
 * enum (the handler resolves a label at call time instead).
 */
export const STUDENT_LABELS_TIMEOUT_MS = 8_000;

function studentName(s: RawStudent): string {
  const name = [s.firstName, s.lastName].filter((p) => typeof p === 'string' && p.trim()).join(' ').trim();
  return name || `Student ${s.personID}`;
}

async function collectLabels(client: ICClient): Promise<StudentLabels | null> {
  await client.ensureDiscovery();
  const districts = client.listDistricts().map((d) => d.name);
  const rosters = await Promise.all(
    districts.map(async (district) => ({
      district,
      students: await client.request<RawStudent[]>(district, '/campus/api/portal/students'),
    })),
  );
  const labels: StudentLabels = new Map();
  for (const { district, students } of rosters) {
    if (!Array.isArray(students)) return null;
    const names = students.map(studentName);
    students.forEach((s, i) => {
      const name = names[i];
      const shared = names.filter((n) => n === name).length > 1;
      labels.set(`${shared ? `${name} ${s.personID}` : name} (${district})`, {
        district,
        studentId: String(s.personID),
      });
    });
  }
  return labels.size > 0 ? labels : null;
}

/**
 * Build the `"<student name> (<district>)"` labels from every district x every
 * student. ANY failure — discovery, one district's roster, the budget, an
 * unconfigured client — answers null, never a partial map: the labels become a
 * schema enum, and a partial enum would REFUSE the students it left out.
 */
export async function buildStudentLabels(
  client: ICClient,
  timeoutMs: number = STUDENT_LABELS_TIMEOUT_MS,
): Promise<StudentLabels | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    const work = (async () => collectLabels(client))().catch(() => null);
    return await Promise.race([work, budget]);
  } finally {
    clearTimeout(timer);
  }
}

const ASSIGNMENT_VIEWS = [...IC_VIEWS, 'brief'] as const;

const argsSchema = z.object({
  district: z.string().describe('District name from ic_list_districts. Give with studentId, or give student instead.').optional(),
  studentId: z.string().describe('personID from ic_list_students. Give with district, or give student instead.').optional(),
  courseId: z.string().describe('sectionID (optional, from ic_get_schedule). The endpoint supports server-side filtering by sectionID only.').optional(),
  since: IsoDate.describe('YYYY-MM-DD; filters dueDate >= since (client-side)').optional(),
  until: IsoDate.describe('YYYY-MM-DD; filters dueDate <= until (client-side)').optional(),
  missingOnly: z.boolean().describe('Only return assignments flagged missing by the teacher').optional(),
});

const STUDENT_DESCRIPTION =
  'The student as "<name> (<district>)" — an alternative to passing district and studentId.';

function studentArg(labels: StudentLabels | null | undefined) {
  const names = labels ? [...labels.keys()] : [];
  return names.length > 0
    ? z.enum(names as [string, ...string[]]).describe(STUDENT_DESCRIPTION).optional()
    : z.string().describe(STUDENT_DESCRIPTION).optional();
}

const viewArg = z
  .enum(ASSIGNMENT_VIEWS)
  .describe(
    'Response shape. "compact" (default) strips image/avatar URLs; "full" returns Infinite Campus\'s payload untouched; ' +
      '"brief" answers one text line per assignment: "<name> — due <dueDate or no date> — <missing|ok>".',
  )
  .optional();

function briefLine(a: RawAssignment): string {
  const due = typeof a.dueDate === 'string' && a.dueDate ? a.dueDate : 'no date';
  return `${a.assignmentName} — due ${due} — ${a.missing ? 'missing' : 'ok'}`;
}

/**
 * `labels` is built once at start (`buildStudentLabels`, from index.ts, via
 * `assignmentToolsRegistrar`); when
 * it is absent the `student` property is still advertised, without an enum,
 * and a label is resolved at call time.
 */
export function registerAssignmentTools(
  server: McpServer,
  client: ICClient,
  labels?: StudentLabels | null,
): void {
  async function resolveStudent(raw: Record<string, unknown>, args: z.infer<typeof argsSchema>): Promise<StudentRef> {
    const label = typeof raw.student === 'string' ? raw.student : undefined;
    if (label !== undefined) {
      const known = labels ?? (await buildStudentLabels(client));
      const ref = known?.get(label);
      if (ref) return ref;
      throw new McpToolError(
        known
          ? `Unknown student "${label}". Known students: ${[...known.keys()].join(', ')}.`
          : `Unknown student "${label}": the student list could not be read.`,
        { hint: 'Pass district (from ic_list_districts) and studentId (from ic_list_students) instead.' },
      );
    }
    if (args.district && args.studentId) return { district: args.district, studentId: args.studentId };
    throw new McpToolError('ic_list_assignments needs student, or both district and studentId.', {
      hint: 'Pass student as "<name> (<district>)", or district (from ic_list_districts) with studentId (from ic_list_students).',
    });
  }

  server.registerTool('ic_list_assignments', {
    description:
      "List a student's assignments (homework, tests and projects, with due dates and missing flags). Name the student with student (\"<name> (<district>)\") or with district + studentId. The IC endpoint returns the full term history (~hundreds of items); date and missing filters are applied client-side. For a single course, pass courseId (the sectionID from ic_get_schedule).",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ ...argsSchema.shape, student: studentArg(labels), view: viewArg }),
    _meta: {
      mint: {
        domain: 'school',
        intent: 'whats-due',
        canonical: true,
        subject: 'student',
        when: { start: 'since', end: 'until' },
        aliases: ['homework', 'assignments', 'due', 'missing', 'kids', 'school'],
      } satisfies MintHint,
    },
  }, async (rawArgs) => {
    const raw = rawArgs as Record<string, unknown>;
    const args = argsSchema.parse(rawArgs);
    const { district, studentId } = await resolveStudent(raw, args);
    // Only sectionID is accepted server-side; startDate/endDate are ignored by the IC endpoint.
    const params = new URLSearchParams({ personID: studentId });
    if (args.courseId) params.set('sectionID', args.courseId);

    const fetched = await client.request<RawAssignment[]>(
      district, `/campus/api/portal/assignment/listView?${params}`,
    );

    let data = fetched;
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

    const view = typeof raw.view === 'string' ? raw.view : undefined;
    if (view === 'brief') {
      return rawTextResult(data.length > 0 ? data.map(briefLine).join('\n') : 'No assignments.');
    }
    return viewResponse(view, data);
  });
}

/**
 * The registrar for index.ts's tool list. runMcp calls every registrar once per
 * served INSTANCE — a client that probes `server/discover` and then falls back
 * to `initialize` gets two — so the label build must not live inside it. The
 * caller starts `buildStudentLabels` ONCE, before runMcp, and every instance
 * awaits that same promise: one roster read per district per process.
 */
export function assignmentToolsRegistrar(
  labels: Promise<StudentLabels | null>,
): ToolRegistrar<ICClient> {
  return async (server, client) => registerAssignmentTools(server, client, await labels);
}
