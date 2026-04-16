import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  since: z.string().optional(),
  until: z.string().optional(),
});

export function registerBehaviorTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_behavior', {
    description: "List a student's behavior events / referrals. Returns FeatureDisabled if the district has the behavior module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.since) params.set('startDate', args.since);
    if (args.until) params.set('endDate', args.until);
    try {
      const data = await client.request(args.district, `/campus/api/portal/parents/behavior?${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && /\b404\b/.test(e.message)) {
        const warn = { warning: 'FeatureDisabled', feature: 'behavior', district: args.district, data: [] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
