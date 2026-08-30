import { describe, it, expect, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import type { ICClient } from '../src/client.js';

interface Result {
  ok: boolean;
  credential: { source: string | null; resolved: boolean; detail?: Record<string, unknown> };
  error?: { kind: string; message: string };
}

const ACCOUNT = { baseUrl: 'https://600.ncsis.gov', district: 'psu600cms', name: 'psu600cms' };

async function call(state: Parameters<typeof registerHealthcheckTools>[1]) {
  const h = await createTestHarness((server) => registerHealthcheckTools(server, state));
  const names = (await h.listTools()).map((t) => t.name);
  const res = await h.client.callTool({ name: 'ic_healthcheck', arguments: {} });
  await h.close?.();
  return { result: parseToolResult<Result>(res as never), names };
}

describe('ic_healthcheck', () => {
  it('exists and explains itself when IC is unconfigured', async () => {
    const { result, names } = await call({
      account: null,
      source: undefined,
      configError: new Error('Missing required env var(s): IC_BASE_URL, IC_DISTRICT.'),
      client: null,
    });
    expect(names).toContain('ic_healthcheck');
    expect(result.error?.kind).toBe('no_credential');
    expect(result.error?.message).toMatch(/IC_BASE_URL/);
  });

  // The failure that actually cost debugging time: a configured district the
  // account is NOT linked to fails every tool for a reason that looks nothing
  // like "wrong district".
  it('flags a configured district the account is not linked to', async () => {
    const client = {
      ensureDiscovery: vi.fn(async () => {}),
      listDistricts: () => [
        { name: 'psu600cms', baseUrl: 'https://600.ncsis.gov', linked: false },
        { name: 'Metrolina Regional Scholars Academy', baseUrl: 'https://60f.ncsis.gov', linked: true },
      ],
      request: vi.fn(async () => [{ personID: 1 }]),
    } as unknown as ICClient;

    const { result } = await call({ account: ACCOUNT as never, source: 'env', configError: null, client });
    expect(result.ok).toBe(true);
    expect(result.credential.detail).toMatchObject({
      configured_district: 'psu600cms',
      configured_district_is_linked: false,
      linked_districts: ['Metrolina Regional Scholars Academy'],
    });
  });

  it('probes the LINKED district, not the misconfigured one', async () => {
    const request = vi.fn(async () => [{ personID: 1 }]);
    const client = {
      ensureDiscovery: vi.fn(async () => {}),
      listDistricts: () => [
        { name: 'psu600cms', baseUrl: 'https://600.ncsis.gov', linked: false },
        { name: 'Metrolina Regional Scholars Academy', baseUrl: 'https://60f.ncsis.gov', linked: true },
      ],
      request,
    } as unknown as ICClient;

    await call({ account: ACCOUNT as never, source: 'env', configError: null, client });
    expect(request).toHaveBeenCalledWith('Metrolina Regional Scholars Academy', '/campus/api/portal/students');
  });

  // The `??` fallbacks: index.ts always sets configError when config fails and
  // always sets source when it succeeds, so these are defensive — but a
  // healthcheck that threw `undefined`, or named its source as `undefined`,
  // would fail at the one job it exists to do.
  it('answers when unconfigured with no stored error', async () => {
    const { result } = await call({ account: null, source: undefined, configError: null, client: null });
    expect(result.error?.kind).toBe('no_credential');
    expect(result.error?.message).toMatch(/not configured/i);
  });

  it('falls back to a named source when none was recorded', async () => {
    const client = {
      ensureDiscovery: vi.fn(async () => {}),
      listDistricts: () => [{ name: 'psu600cms', baseUrl: 'https://600.ncsis.gov', linked: true }],
      request: vi.fn(async () => []),
    } as unknown as ICClient;
    const { result } = await call({ account: ACCOUNT as never, source: undefined, configError: null, client });
    expect(result.credential.source).toBe('env');
    expect(result.credential.detail).toMatchObject({ auth_source: 'unknown' });
  });

  // No linked district at all: `linked_districts` must be omitted rather than
  // reported as an empty list, and the probe falls back to the configured one.
  it('omits linked_districts when nothing is linked, and probes the configured district', async () => {
    const request = vi.fn(async () => []);
    const client = {
      ensureDiscovery: vi.fn(async () => {}),
      listDistricts: () => [{ name: 'psu600cms', baseUrl: 'https://600.ncsis.gov', linked: false }],
      request,
    } as unknown as ICClient;
    const { result } = await call({ account: ACCOUNT as never, source: 'env', configError: null, client });
    expect(result.credential.detail).not.toHaveProperty('linked_districts');
    expect(request).toHaveBeenCalledWith('psu600cms', '/campus/api/portal/students');
  });

  it('still answers when discovery cannot run', async () => {
    const client = {
      ensureDiscovery: vi.fn(async () => {
        throw new Error('no live session');
      }),
      listDistricts: () => [],
      request: vi.fn(async () => []),
    } as unknown as ICClient;
    const { result } = await call({ account: ACCOUNT as never, source: 'fetchproxy', configError: null, client });
    expect(result.credential.detail).toMatchObject({ districts: 'unavailable (discovery needs a live session)' });
  });
});
