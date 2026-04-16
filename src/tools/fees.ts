import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

type FeeAssignment = Record<string, unknown>;

interface FeesResponse {
  totalSurplus: number | null;
  feeAssignments: FeeAssignment[];
  notes?: string[];
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
});

function is404(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('IC 404 ');
}

export function registerFeeTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_fees', {
    description:
      "List a student's fee assignments (charges owed) and running balance/surplus. Combines two endpoints: fee assignments and totalSurplus. Returns FeatureDisabled only if both endpoints 404; if only one works, returns that with a note.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const personIDEnc = encodeURIComponent(args.studentId);

    const assignmentsPromise = client.request<FeeAssignment[]>(
      args.district,
      `/campus/api/portal/fees/feeAssignments?personID=${personIDEnc}`,
    ).then((v) => ({ ok: true as const, value: v })).catch((e) => {
      if (is404(e)) return { ok: false as const, status: 404 };
      throw e;
    });

    const surplusPromise = client.request<number>(
      args.district,
      `/campus/api/portal/fees/feeTransactionDetail/totalSurplus/-1?personID=${personIDEnc}`,
    ).then((v) => ({ ok: true as const, value: v })).catch((e) => {
      if (is404(e)) return { ok: false as const, status: 404 };
      throw e;
    });

    const [assignments, surplus] = await Promise.all([assignmentsPromise, surplusPromise]);

    // Both endpoints 404 → FeatureDisabled
    if (!assignments.ok && !surplus.ok) {
      const warn = {
        warning: 'FeatureDisabled',
        feature: 'fees',
        district: args.district,
        data: { totalSurplus: null, feeAssignments: [] },
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
    }

    const response: FeesResponse = {
      totalSurplus: surplus.ok ? surplus.value : null,
      feeAssignments: assignments.ok ? assignments.value : [],
    };

    const notes: string[] = [];
    if (!assignments.ok) notes.push('feeAssignments endpoint returned 404 (module may be disabled for this district)');
    if (!surplus.ok) notes.push('totalSurplus endpoint returned 404 (module may be disabled for this district)');
    if (notes.length > 0) response.notes = notes;

    return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
  });
}
