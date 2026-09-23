import { McpServer } from '@modelcontextprotocol/server';
import { viewArg, viewResponse } from '../view.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const argsSchema = z.object({
  district: z.string().describe('District name from ic_list_districts'),
  studentId: z.string().describe('Student personID from ic_list_students'),
});
// No date/term arguments: the roster endpoint honours only personID, and no
// captured payload documents which fields carry the term window, so a
// client-side filter would be guesswork. Advertising `date`/`termFilter` while
// ignoring them let the model present the all-terms roster as the answer for
// the date or term it asked about (fleet-audit#143).

export function registerScheduleTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_get_schedule', {
    description: "Get a student's class roster: every course with its section placements, across every term of the current enrollment. Not filtered by date or term — each placement carries its own term, so narrow the result yourself.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ ...argsSchema.shape, view: viewArg() }),
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const params = new URLSearchParams({ personID: args.studentId });
    const data = await client.request(args.district, `/campus/resources/portal/roster?${params}`);
    return viewResponse((rawArgs as { view?: string }).view, data);
  });
}
