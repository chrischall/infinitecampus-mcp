import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, featureDisabled } from './_shared.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
});

export function registerFoodServiceTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_food_service', {
    description: "List a student's lunch balance and recent food-service transactions. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/resources/portal/foodService?${params}`);
      return textContent(data);
    } catch (e) {
      if (is404(e)) return featureDisabled('foodService', args.district, { balance: null, transactions: [] });
      throw e;
    }
  });
}
