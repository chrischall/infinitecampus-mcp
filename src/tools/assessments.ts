import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

interface RawEnrollment {
  enrollmentID: number;
  calendarID: number;
  structureID: number;
  calendarName: string;
}

interface RawStudent {
  personID: number;
  firstName: string;
  lastName: string;
  enrollments: RawEnrollment[];
}

// Test item shapes vary by district and test type — we pass them through unchanged.
type AnyTest = Record<string, unknown>;

interface RawAssessmentResponse {
  personID?: number;
  assessmentHTML?: string | null;
  stateTests?: AnyTest[] | null;
  nationalTests?: AnyTest[] | null;
  districtTests?: { tests?: AnyTest[] | null; typeTests?: AnyTest[] | null } | null;
}

interface AssessmentsByEnrollment {
  enrollmentID: number;
  calendarID: number;
  calendarName: string;
  stateTests: AnyTest[];
  nationalTests: AnyTest[];
  districtTests: { tests: AnyTest[]; typeTests: AnyTest[] };
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
});

export function registerAssessmentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_assessments', {
    description:
      "List a student's standardized test scores (state, national, district tests). Auto-resolves calendarID from each of the student's enrollments and returns one entry per enrollment. The shape of individual test records varies by district and test type — fields are passed through unchanged.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const students = await client.request<RawStudent[]>(args.district, '/campus/api/portal/students');
    const student = students.find((s) => String(s.personID) === args.studentId);
    if (!student) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StudentNotFound', studentId: args.studentId }, null, 2) }] };
    }

    const personIDEnc = encodeURIComponent(args.studentId);
    const result: AssessmentsByEnrollment[] = [];
    let feature404 = false;

    for (const enr of student.enrollments ?? []) {
      try {
        const raw = await client.request<RawAssessmentResponse>(
          args.district,
          `/campus/resources/prism/portal/assessments?personID=${personIDEnc}&calendarID=${enr.calendarID}`,
        );
        result.push({
          enrollmentID: enr.enrollmentID,
          calendarID: enr.calendarID,
          calendarName: enr.calendarName,
          stateTests: raw.stateTests ?? [],
          nationalTests: raw.nationalTests ?? [],
          districtTests: {
            tests: raw.districtTests?.tests ?? [],
            typeTests: raw.districtTests?.typeTests ?? [],
          },
        });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('IC 404 ')) {
          feature404 = true;
          continue;
        }
        throw e;
      }
    }

    // If every enrollment 404'd (and at least one was tried), treat as FeatureDisabled.
    // feature404 can only be set inside the enrollment loop, so we know enrollments was non-empty.
    if (feature404 && result.length === 0) {
      const warn = { warning: 'FeatureDisabled', feature: 'assessments', district: args.district, data: [] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });
}
