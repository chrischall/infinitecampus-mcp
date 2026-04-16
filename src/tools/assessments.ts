import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, findStudent, studentNotFound, featureDisabled, is404 } from './_shared.js';

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
  calendarName?: string;
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

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

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
        if (is404(e)) {
          feature404 = true;
          continue;
        }
        throw e;
      }
    }

    // If every enrollment 404'd (and at least one was tried), treat as FeatureDisabled.
    // feature404 can only be set inside the enrollment loop, so we know enrollments was non-empty.
    if (feature404 && result.length === 0) {
      return featureDisabled('assessments', args.district);
    }

    return textContent(result);
  });
}
