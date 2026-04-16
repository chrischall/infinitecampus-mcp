import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string(),
  termId: z.string().optional(),
});

export function registerGradeTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_grades', {
    description: "List a student's term grades and in-progress course grades.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    if (args.termId) params.set('termID', args.termId);
    const data = await client.request(args.district, `/campus/resources/portal/grades?${params}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });
}
