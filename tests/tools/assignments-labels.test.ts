// The flattened `student` label on ic_list_assignments, and its brief view.
//
// A label is "<student name> (<district>)", built once at start from every
// district x every student. It lets a caller (a context-group intent tool, or
// a voice ask) name a child without first resolving (district, studentId).
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { ICClient } from '../../src/client.js';
import { assignmentToolsRegistrar, buildStudentLabels, registerAssignmentTools } from '../../src/tools/assignments.js';

const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };

const STUDENTS: Record<string, unknown[]> = {
  anoka: [
    { personID: 111, firstName: 'Alex', lastName: 'Doe' },
    { personID: 222, firstName: 'Sam', lastName: 'Doe' },
  ],
  wayzata: [{ personID: 333, firstName: 'Riley', lastName: 'Roe' }],
};

const ASSIGNMENTS = [
  { assignmentName: 'HW1', courseName: 'Math', sectionID: 1, dueDate: '2026-01-15T04:59:00.000Z', missing: false },
  { assignmentName: 'Lab', courseName: 'Sci', sectionID: 2, dueDate: '2026-03-20T04:59:00.000Z', missing: true },
  { assignmentName: 'NoDate', courseName: 'Eng', sectionID: 3, missing: false },
];

function mockClient(opts: { studentsFail?: string; discoveryFail?: boolean; hang?: boolean } = {}) {
  const client = new ICClient(account);
  vi.spyOn(client, 'ensureDiscovery').mockImplementation(async () => {
    if (opts.discoveryFail) throw new Error('CUPS down');
  });
  vi.spyOn(client, 'listDistricts').mockReturnValue([
    { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', linked: false },
    { name: 'wayzata', baseUrl: 'https://wayzata.infinitecampus.org', linked: true },
  ]);
  vi.spyOn(client, 'request').mockImplementation(async (district: string, path: string) => {
    if (path === '/campus/api/portal/students') {
      if (opts.hang) return new Promise(() => {});
      if (opts.studentsFail === district) throw new Error('IC 500 boom');
      return STUDENTS[district] ?? [];
    }
    return ASSIGNMENTS;
  });
  return client;
}

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

function capture(client: ICClient, labels?: Awaited<ReturnType<typeof buildStudentLabels>>) {
  let handler: Handler | undefined;
  const server = {
    registerTool: (_n: string, _c: unknown, cb: unknown) => {
      handler = cb as Handler;
      return undefined as never;
    },
  } as unknown as McpServer;
  registerAssignmentTools(server, client, labels);
  return handler!;
}

afterEach(() => vi.restoreAllMocks());

describe('buildStudentLabels', () => {
  it('builds "<name> (<district>)" over every district x student', async () => {
    const labels = await buildStudentLabels(mockClient());
    expect(labels).not.toBeNull();
    expect([...labels!.keys()]).toEqual(['Alex Doe (anoka)', 'Sam Doe (anoka)', 'Riley Roe (wayzata)']);
    expect(labels!.get('Riley Roe (wayzata)')).toEqual({ district: 'wayzata', studentId: '333' });
  });

  it('answers null when any district fails, never a partial list', async () => {
    expect(await buildStudentLabels(mockClient({ studentsFail: 'wayzata' }))).toBeNull();
  });

  it('answers null when discovery fails', async () => {
    expect(await buildStudentLabels(mockClient({ discoveryFail: true }))).toBeNull();
  });

  it('answers null when the client throws synchronously (the unconfigured stand-in)', async () => {
    const client = new Proxy({} as ICClient, {
      get: (_t, p) => (p === 'then' || typeof p === 'symbol' ? undefined : () => { throw new Error('not configured'); }),
    });
    expect(await buildStudentLabels(client)).toBeNull();
  });

  it('answers null when the budget runs out', async () => {
    expect(await buildStudentLabels(mockClient({ hang: true }), 20)).toBeNull();
  });

  it('answers null when there are no students to name', async () => {
    const client = mockClient();
    vi.spyOn(client, 'listDistricts').mockReturnValue([]);
    expect(await buildStudentLabels(client)).toBeNull();
  });

  it('disambiguates two students with the same name in one district by id', async () => {
    const client = mockClient();
    vi.spyOn(client, 'listDistricts').mockReturnValue([{ name: 'anoka', baseUrl: 'x', linked: false }]);
    vi.mocked(client.request).mockResolvedValue([
      { personID: 1, firstName: 'Alex', lastName: 'Doe' },
      { personID: 2, firstName: 'Alex', lastName: 'Doe' },
      { personID: 3 },
    ]);
    const labels = await buildStudentLabels(client);
    expect([...labels!.keys()]).toEqual(['Alex Doe 1 (anoka)', 'Alex Doe 2 (anoka)', 'Student 3 (anoka)']);
  });
});

describe('ic_list_assignments student argument', () => {
  it('advertises the labels as an enum when they were built', async () => {
    const client = mockClient();
    const labels = await buildStudentLabels(client);
    const harness = await createTestHarness((server: McpServer) => registerAssignmentTools(server, client, labels));
    try {
      const { tools } = await harness.client.listTools();
      const props = tools[0].inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(props.student.enum).toEqual(['Alex Doe (anoka)', 'Sam Doe (anoka)', 'Riley Roe (wayzata)']);
      expect(tools[0].inputSchema.required ?? []).not.toContain('district');
      expect(tools[0].inputSchema.required ?? []).not.toContain('studentId');
    } finally {
      await harness.close();
    }
  });

  it('keeps the property, with no enum, when the labels failed', async () => {
    const client = mockClient({ studentsFail: 'anoka' });
    const harness = await createTestHarness(async (server: McpServer) =>
      registerAssignmentTools(server, client, await buildStudentLabels(client)),
    );
    try {
      const { tools } = await harness.client.listTools();
      const props = tools[0].inputSchema.properties as Record<string, Record<string, unknown>>;
      expect(props.student).toBeDefined();
      expect('enum' in props.student).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('maps a label to (district, studentId)', async () => {
    const client = mockClient();
    const handler = capture(client, await buildStudentLabels(client));
    await handler({ student: 'Riley Roe (wayzata)' });
    const call = vi.mocked(client.request).mock.calls.find(([, p]) => p.includes('listView'))!;
    expect(call[0]).toBe('wayzata');
    expect(call[1]).toContain('personID=333');
  });

  it('still accepts the two raw arguments', async () => {
    const client = mockClient();
    const handler = capture(client, await buildStudentLabels(client));
    await handler({ district: 'anoka', studentId: '222' });
    const call = vi.mocked(client.request).mock.calls.find(([, p]) => p.includes('listView'))!;
    expect(call[0]).toBe('anoka');
    expect(call[1]).toContain('personID=222');
  });

  it('resolves a label at call time when none were built at start', async () => {
    const client = mockClient();
    const handler = capture(client, null);
    await handler({ student: 'Sam Doe (anoka)' });
    const call = vi.mocked(client.request).mock.calls.find(([, p]) => p.includes('listView'))!;
    expect(call[0]).toBe('anoka');
    expect(call[1]).toContain('personID=222');
  });

  it('refuses a call naming neither form, clearly', async () => {
    const handler = capture(mockClient(), null);
    await expect(handler({})).rejects.toThrow(/student.*or both district and studentId/);
  });

  it('refuses half of the raw pair', async () => {
    const handler = capture(mockClient(), null);
    await expect(handler({ district: 'anoka' })).rejects.toThrow(/student.*or both district and studentId/);
  });

  it('refuses an unknown label, naming the known ones', async () => {
    const handler = capture(mockClient(), null);
    await expect(handler({ student: 'Nobody (anoka)' })).rejects.toThrow(/Alex Doe \(anoka\)/);
  });
});

describe('ic_list_assignments view: brief', () => {
  it('answers one line per assignment: name, due date (or "no date"), missing|ok', async () => {
    const handler = capture(mockClient(), null);
    const result = await handler({ district: 'anoka', studentId: '111', view: 'brief' });
    expect(result.content[0].text).toBe(
      [
        'HW1 — due 2026-01-15T04:59:00.000Z — ok',
        'Lab — due 2026-03-20T04:59:00.000Z — missing',
        'NoDate — due no date — ok',
      ].join('\n'),
    );
  });

  it('applies the filters before rendering', async () => {
    const handler = capture(mockClient(), null);
    const result = await handler({ district: 'anoka', studentId: '111', view: 'brief', missingOnly: true });
    expect(result.content[0].text).toBe('Lab — due 2026-03-20T04:59:00.000Z — missing');
  });

  it('says so when nothing matches', async () => {
    const handler = capture(mockClient(), null);
    const result = await handler({ district: 'anoka', studentId: '111', view: 'brief', since: '2030-01-01' });
    expect(result.content[0].text).toBe('No assignments.');
  });

  it('leaves the default view unchanged', async () => {
    const handler = capture(mockClient(), null);
    const result = await handler({ district: 'anoka', studentId: '111' });
    expect(JSON.parse(result.content[0].text)).toEqual(ASSIGNMENTS);
  });
});

describe('assignmentToolsRegistrar', () => {
  // runMcp calls every registrar once per served INSTANCE, and a client that
  // probes server/discover before initialize gets two. The roster must still
  // be read once per district, not once per instance.
  it('reads each roster once however many instances it registers on', async () => {
    const client = mockClient();
    const registrar = assignmentToolsRegistrar(buildStudentLabels(client));
    const first = await createTestHarness((server: McpServer) => registrar(server, client));
    const second = await createTestHarness((server: McpServer) => registrar(server, client));
    try {
      for (const harness of [first, second]) {
        const { tools } = await harness.client.listTools();
        const props = tools[0].inputSchema.properties as Record<string, { enum?: string[] }>;
        expect(props.student.enum).toEqual(['Alex Doe (anoka)', 'Sam Doe (anoka)', 'Riley Roe (wayzata)']);
      }
      const rosterCalls = vi.mocked(client.request).mock.calls.filter(([, path]) => path === '/campus/api/portal/students');
      expect(rosterCalls.map(([district]) => district)).toEqual(['anoka', 'wayzata']);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
