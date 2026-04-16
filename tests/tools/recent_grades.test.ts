import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerRecentGradesTools } from '../../src/tools/recent_grades.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(returnValue: unknown) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerRecentGradesTools(server, client);
  return client;
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const RAW_GRADE = {
  assignmentName: 'Unit 3 Quiz',
  courseName: 'Algebra 1',
  sectionID: 12345,
  dueDate: '2026-04-10',
  scoreModifiedDate: '2026-04-12T14:30:00',
  score: '85',
  scorePoints: '85',
  scorePercentage: 85,
  totalPoints: 100,
  missing: false,
  late: false,
  turnedIn: true,
  feedback: 'Good work',
  comments: null,
  // extra fields to ensure they're stripped
  _id: 'abc',
  _model: 'assignment',
  _hashCode: 999,
  internalField: 'drop me',
};

describe('ic_list_recent_grades', () => {
  it('calls /campus/api/portal/assignment/recentlyScored with modifiedDate and personID', async () => {
    const client = setup([RAW_GRADE]);
    await handlers.get('ic_list_recent_grades')!({
      district: 'anoka', studentId: '12345', since: '2026-04-01',
    });
    const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain('/campus/api/portal/assignment/recentlyScored');
    expect(url).toContain('personID=12345');
    expect(url).toContain('modifiedDate=');
    expect(decodeURIComponent(url)).toContain('2026-04-01T00:00:00');
  });

  it('trims response to useful subset', async () => {
    setup([RAW_GRADE]);
    const result = await handlers.get('ic_list_recent_grades')!({
      district: 'anoka', studentId: '12345', since: '2026-04-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      assignmentName: 'Unit 3 Quiz',
      courseName: 'Algebra 1',
      sectionID: 12345,
      dueDate: '2026-04-10',
      scoreModifiedDate: '2026-04-12T14:30:00',
      score: '85',
      scorePoints: '85',
      scorePercentage: 85,
      totalPoints: 100,
      missing: false,
      late: false,
      turnedIn: true,
      feedback: 'Good work',
      comments: null,
    });
    expect(data[0]).not.toHaveProperty('_id');
    expect(data[0]).not.toHaveProperty('_model');
    expect(data[0]).not.toHaveProperty('internalField');
  });

  it('omits undefined fields from output', async () => {
    setup([{ assignmentName: 'Quiz', courseName: 'Math' }]);
    const result = await handlers.get('ic_list_recent_grades')!({
      district: 'anoka', studentId: '12345', since: '2026-04-01',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data[0]).toEqual({ assignmentName: 'Quiz', courseName: 'Math' });
  });

  it('handles null response', async () => {
    setup(null);
    const result = await handlers.get('ic_list_recent_grades')!({
      district: 'anoka', studentId: '12345', since: '2026-04-01',
    });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  describe('default since (14 days ago)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));
    });

    it('uses 14 days ago when since is not provided', async () => {
      const client = setup([]);
      await handlers.get('ic_list_recent_grades')!({ district: 'anoka', studentId: '12345' });
      const url = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(decodeURIComponent(url)).toContain('2026-04-02T00:00:00');
    });
  });
});
