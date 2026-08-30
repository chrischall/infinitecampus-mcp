import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import type { ICClient } from '../client.js';
import type { ResolvedAuth } from '../auth.js';
import type { Account } from '../config.js';

/**
 * Register `ic_healthcheck` — reports which auth path resolved and which
 * districts the account is actually LINKED to, then makes one authenticated
 * call.
 *
 * REGISTERED UNCONDITIONALLY. When `IC_BASE_URL`/`IC_DISTRICT` are missing,
 * `index.ts` registers zero tools and reports the reason on stderr only —
 * invisible to a hosted connector, so a misconfigured server looks like a
 * broken one.
 *
 * The district detail is the specific thing that cost real debugging time
 * here: a configured `IC_DISTRICT` the account is NOT linked to fails every
 * tool with an unrelated-looking error, while `ic_list_districts` quietly
 * shows `linked: false` next to a different district that works. Surfacing
 * "configured X, linked to Y" turns that into one glance.
 */
export function registerHealthcheckTools(
  server: McpServer,
  state: { account: Account | null; source: ResolvedAuth['source'] | undefined; configError: Error | null; client: ICClient | null },
): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'ic',
    hostLabel: 'your Infinite Campus portal',
    resolveCredential: async () => {
      if (!state.account || !state.client) {
        throw state.configError ?? new Error('Infinite Campus is not configured.');
      }
      const detail: Record<string, unknown> = {
        base_url: state.account.baseUrl,
        configured_district: state.account.district,
        auth_source: state.source ?? 'unknown',
      };
      try {
        // Discovery is what knows about LINKED districts, and it needs a live
        // session — so a failure here is not a credential answer. Report what
        // is known and let the probe below decide.
        await state.client.ensureDiscovery();
        const districts = state.client.listDistricts();
        detail.districts = districts.map((d) => ({ name: d.name, linked: d.linked }));
        const linked = districts.filter((d) => d.linked).map((d) => d.name);
        detail.configured_district_is_linked = districts.some(
          (d) => d.name === state.account!.district && d.linked,
        );
        if (linked.length > 0) detail.linked_districts = linked;
      } catch {
        detail.districts = 'unavailable (discovery needs a live session)';
      }
      return { source: state.source ?? 'env', detail };
    },
    // Probe the district the account is actually LINKED to when that differs
    // from the configured one — probing a district you are not enrolled in
    // fails for a reason that has nothing to do with your credentials.
    probeFn: () => {
      const districts = state.client!.listDistricts();
      const linked = districts.find((d) => d.linked);
      const district = linked?.name ?? state.account!.district;
      return state.client!.request(district, '/campus/api/portal/students');
    },
    hints: {
      credential_rejected:
        'Infinite Campus rejected the credentials. Check IC_USERNAME/IC_PASSWORD, or sign into your IC portal in the browser so the fetchproxy fallback can lift a session.',
    },
  });
}
