import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerFeaturesTools } from '../../src/tools/features.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

const STUDENT = {
  personID: 481,
  firstName: 'Alex',
  enrollments: [
    { enrollmentID: 426960, calendarID: 5592, structureID: 3917, schoolName: 'Springfield High School' },
    { enrollmentID: 426961, calendarID: 5593, structureID: 3918, schoolName: 'Other School' },
  ],
};

function setup(client: ICClient) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerFeaturesTools(server, client);
}
afterEach(() => vi.restoreAllMocks());

describe('ic_get_features', () => {
  it('returns one entry per enrollment with the features map', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue([STUDENT] as never);
    const getFeatures = vi.spyOn(client, 'getFeatures').mockImplementation(async (_d, structureID) => {
      return structureID === 3917 ? { attendance: true, behavior: false } : { attendance: false };
    });
    setup(client);
    const result = await handlers.get('ic_get_features')!({ district: 'anoka', studentId: '481' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual([
      { enrollmentID: 426960, structureID: 3917, schoolName: 'Springfield High School', features: { attendance: true, behavior: false } },
      { enrollmentID: 426961, structureID: 3918, schoolName: 'Other School', features: { attendance: false } },
    ]);
    expect(getFeatures).toHaveBeenCalledTimes(2);
  });

  it('returns StudentNotFound for unknown studentId', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue([STUDENT] as never);
    setup(client);
    const result = await handlers.get('ic_get_features')!({ district: 'anoka', studentId: '99999' });
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('returns empty array when student has no enrollments', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue([{ ...STUDENT, enrollments: [] }] as never);
    const getFeatures = vi.spyOn(client, 'getFeatures');
    setup(client);
    const result = await handlers.get('ic_get_features')!({ district: 'anoka', studentId: '481' });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(getFeatures).not.toHaveBeenCalled();
  });

  it('handles student with missing enrollments field', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue([{ ...STUDENT, enrollments: undefined }] as never);
    setup(client);
    const result = await handlers.get('ic_get_features')!({ district: 'anoka', studentId: '481' });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
