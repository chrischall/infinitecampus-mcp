import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, featureDisabled } from './_shared.js';

type FeeAssignment = Record<string, unknown>;

interface FeesResponse {
  warning?: 'PartialSuccess';
  totalSurplus: number | null;
  feeAssignments: FeeAssignment[];
  issues?: string[];
}

const argsSchema = z.object({
  district: z.string(),
  studentId: z.string().describe('Student personID from ic_list_students'),
});

export function registerFeeTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_fees', {
    description:
      "List a student's fee assignments (charges owed) and running balance/surplus. Combines two endpoints: fee assignments and totalSurplus. Returns FeatureDisabled only if both endpoints 404; if only one works, returns that side with warning: 'PartialSuccess' and an issues[] explaining which endpoint failed.",
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
      return featureDisabled('fees', args.district, { totalSurplus: null, feeAssignments: [] });
    }

    const issues: string[] = [];
    if (!assignments.ok) issues.push('feeAssignments endpoint returned 404 (module may be disabled for this district)');
    if (!surplus.ok) issues.push('totalSurplus endpoint returned 404 (module may be disabled for this district)');

    const response: FeesResponse = {
      ...(issues.length > 0 ? { warning: 'PartialSuccess' as const } : {}),
      totalSurplus: surplus.ok ? surplus.value : null,
      feeAssignments: assignments.ok ? assignments.value : [],
      ...(issues.length > 0 ? { issues } : {}),
    };

    return textContent(response);
  });
}
