import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, findStudent, studentNotFound } from './_shared.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
});

interface FeaturesByEnrollment {
  enrollmentID: number;
  structureID: number;
  schoolName?: string;
  features: Record<string, boolean>;
}

export function registerFeaturesTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_get_features', {
    description:
      "List the district's displayOptions feature-flag allow-list for each of a student's enrollments. Each enrollment's `features` object is a map of ~90 flag names (attendance, behavior, assessment, documents, grades, schedule, etc.) to booleans. A `false` value means the district has that feature disabled for this enrollment; `true` or missing means it's available. Used internally by other tools to short-circuit disabled features, but exposed here so the LLM can answer capability questions directly.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const result: FeaturesByEnrollment[] = [];
    for (const enr of student.enrollments ?? []) {
      const features = await client.getFeatures(args.district, enr.structureID, args.studentId);
      result.push({
        enrollmentID: enr.enrollmentID,
        structureID: enr.structureID,
        schoolName: enr.schoolName,
        features,
      });
    }
    return textContent(result);
  });
}
