import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, featureDisabled, findStudent, studentNotFound, checkFeatureDisabled } from './_shared.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
});

const EMPTY_FOOD = { balance: null, transactions: [] };

export function registerFoodServiceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_food_service', {
    description: "List a student's lunch balance and recent food-service transactions. Returns FeatureDisabled if the district has the module turned off (detected via displayOptions or a 404 backstop).",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const disabled = await checkFeatureDisabled(
      client, args.district, args.studentId, student, 'foodService', 'foodService', EMPTY_FOOD,
    );
    if (disabled) return disabled;

    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/resources/portal/foodService?${params}`);
      return textContent(data);
    } catch (e) {
      if (is404(e)) return featureDisabled('foodService', args.district, EMPTY_FOOD);
      throw e;
    }
  });
}
