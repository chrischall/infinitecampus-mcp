import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ICClient } from '../../src/client.js';
import { registerMessageTools } from '../../src/tools/messages.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(impl: (path: string) => Promise<unknown>) {
  const client = new ICClient(account);
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => impl(path));
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerMessageTools(server, client);
  return client;
}

afterEach(() => vi.restoreAllMocks());

const PRISM_ITEM = {
  notificationID: 123,
  creationTimestamp: '2026-04-10T10:00:00Z',
  read: false,
  notificationText: 'Grade posted',
  notificationTypeText: 'Grade',
  displayedDate: 'Apr 10',
  _extraIgnored: 'should be dropped',
};

const INBOX_ITEM = {
  messageID: 999,
  date: '2026-04-09',
  name: 'Weather Closure',
  sender: 'District Admin',
  messageType: 'announcement',
  courseName: null,
  studentName: 'Jordan Example',
  newMessage: true,
  actionRequired: false,
  dueDate: null,
  url: 'https://example/msg/999',
  // fields we drop
  personID: 481,
  sectionID: null,
  courseID: null,
  schoolID: 12,
  calendarID: 50,
  contextID: 'abc',
  studentID: 481,
  process: 'x',
  requestViewID: 'y',
  postedTimestamp: 'z',
};

describe('ic_list_messages', () => {
  it('calls all three endpoints and combines them', async () => {
    const client = setup((path) => {
      if (path.startsWith('/campus/prism')) {
        return Promise.resolve({ status: 'OK', data: { NotificationList: { Notification: [PRISM_ITEM] } } });
      }
      if (path === '/campus/api/portal/process-message') return Promise.resolve([INBOX_ITEM]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected: ' + path);
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);

    // three keys present
    expect(Object.keys(data).sort()).toEqual(['announcements', 'inbox', 'notifications']);

    // all three endpoints called
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.some((u) => u.includes('notifications.Notification-retrieve'))).toBe(true);
    expect(urls.some((u) => u === '/campus/api/portal/process-message')).toBe(true);
    expect(urls.some((u) => u === '/campus/resources/portal/userNotice')).toBe(true);
  });

  it('defaults prism limit to 20', async () => {
    const client = setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.find((u) => u.startsWith('/campus/prism'))!).toContain('limitCount=20');
  });

  it('passes custom limit through to prism URL only', async () => {
    const client = setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    await handlers.get('ic_list_messages')!({ district: 'anoka', limit: 50 });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.find((u) => u.startsWith('/campus/prism'))!).toContain('limitCount=50');
    // inbox/notice urls don't take limit
    expect(urls.find((u) => u === '/campus/api/portal/process-message')).toBeDefined();
  });

  it('trims prism notifications to the whitelisted fields', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [PRISM_ITEM] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications.count).toBe(1);
    expect(data.notifications.items[0]).toEqual({
      notificationID: 123,
      creationTimestamp: '2026-04-10T10:00:00Z',
      read: false,
      notificationText: 'Grade posted',
      notificationTypeText: 'Grade',
      displayedDate: 'Apr 10',
    });
    expect('_extraIgnored' in data.notifications.items[0]).toBe(false);
  });

  it('handles prism returning a single notification as a bare object (XML→JSON quirk)', async () => {
    // IC's prism serializer returns Notification as an object (not a 1-element array) when there's exactly one.
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: PRISM_ITEM } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications.error).toBeUndefined();
    expect(data.notifications.count).toBe(1);
    expect(data.notifications.items[0].notificationID).toBe(123);
  });

  it('handles prism returning no Notification field (empty data)', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: {} } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications.error).toBeUndefined();
    expect(data.notifications.count).toBe(0);
    expect(data.notifications.items).toEqual([]);
  });

  it('trims inbox messages to the whitelisted fields', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([INBOX_ITEM]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.inbox.count).toBe(1);
    const keys = Object.keys(data.inbox.items[0]).sort();
    expect(keys).toEqual([
      'actionRequired', 'courseName', 'date', 'dueDate', 'messageID', 'messageType',
      'name', 'newMessage', 'sender', 'studentName', 'url',
    ]);
    // dropped fields gone
    for (const k of ['personID', 'sectionID', 'courseID', 'schoolID', 'calendarID', 'contextID', 'studentID', 'process', 'requestViewID', 'postedTimestamp']) {
      expect(k in data.inbox.items[0]).toBe(false);
    }
  });

  it('omits whitelisted fields that are missing from the raw record', async () => {
    // A partial inbox item — only some of the INBOX_KEEP fields are present.
    const partial = { messageID: 7, name: 'Partial' };
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([partial]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.inbox.items[0]).toEqual({ messageID: 7, name: 'Partial' });
    // Absent fields stay absent (not set to undefined)
    expect('sender' in data.inbox.items[0]).toBe(false);
    expect('date' in data.inbox.items[0]).toBe(false);
  });

  it('passes announcements through unchanged', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([{ title: 'Welcome', body: 'text' }]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.announcements).toEqual({ count: 1, items: [{ title: 'Welcome', body: 'text' }] });
  });

  it('handles prism response missing data/NotificationList gracefully', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ status: 'OK' });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications).toEqual({ count: 0, items: [] });
  });

  it('handles null from process-message endpoint', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve(null);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve(null);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.inbox).toEqual({ count: 0, items: [] });
    expect(data.announcements).toEqual({ count: 0, items: [] });
  });

  it('when one endpoint errors, others still return and the errored section has an error field', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.reject(new Error('IC 500 boom'));
      if (path === '/campus/api/portal/process-message') return Promise.resolve([INBOX_ITEM]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications.count).toBe(0);
    expect(data.notifications.items).toEqual([]);
    expect(data.notifications.error).toContain('IC 500');
    expect(data.inbox.count).toBe(1);
    expect(data.announcements.count).toBe(0);
  });

  it('each section can error independently', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.reject(new Error('IC 404 Not Found'));
      if (path === '/campus/resources/portal/userNotice') return Promise.reject(new Error('IC 403 Forbidden'));
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.inbox.error).toContain('IC 404');
    expect(data.announcements.error).toContain('IC 403');
  });

  it('serializes non-Error throwables as strings in the error field', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.reject('weird non-error');
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.notifications.error).toBe('weird non-error');
  });

  it('serializes non-Error throwables in inbox section', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.reject('string thrown');
      if (path === '/campus/resources/portal/userNotice') return Promise.resolve([]);
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(data.inbox.error).toBe('string thrown');
  });

  it('serializes non-Error throwables in announcements section', async () => {
    setup((path) => {
      if (path.startsWith('/campus/prism')) return Promise.resolve({ data: { NotificationList: { Notification: [] } } });
      if (path === '/campus/api/portal/process-message') return Promise.resolve([]);
      if (path === '/campus/resources/portal/userNotice') return Promise.reject({ weird: 'obj' });
      throw new Error('unexpected');
    });
    const result = await handlers.get('ic_list_messages')!({ district: 'anoka' });
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.announcements.error).toBe('string');
  });
});

describe('ic_get_message', () => {
  const SAMPLE_HTML = [
    '<html>',
    '<head><title>Message -- Scholars Academy Closed 2/3/26</title></head>',
    '<body>',
    '<script>alert("ignored")</script>',
    '<style>body{color:red}</style>',
    '<p>Message: Scholars Academy Closed 2/3/26</p>',
    '<p>Date: 02/02/2026</p>',
    '<div>Dear Scholars &amp; Community,&nbsp;Due to weather, no school on 2/3.</div>',
    '</body></html>',
  ].join('');

  it('fetches HTML as text and returns parsed { subject, date, body, url }', async () => {
    const client = new ICClient(account);
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValue(SAMPLE_HTML);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_get_message')!({
      district: 'anoka',
      messageUrl: 'portal/messageView.xsl?x=messenger.MessengerEngine-getMessageRecipientView&messageID=100&messageRecipientID=200&processMessageID=300',
    });

    // The request should have been made with responseType=text
    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [, reqPath, reqOpts] = requestSpy.mock.calls[0];
    expect(reqPath).toBe('/campus/portal/messageView.xsl?x=messenger.MessengerEngine-getMessageRecipientView&messageID=100&messageRecipientID=200&processMessageID=300');
    expect(reqOpts).toEqual({ responseType: 'text' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.subject).toBe('Scholars Academy Closed 2/3/26');
    expect(parsed.date).toBe('02/02/2026');
    expect(parsed.body).toContain('Dear Scholars & Community');
    expect(parsed.body).toContain('no school on 2/3');
    expect(parsed.body).not.toContain('Date:');
    expect(parsed.body).not.toContain('alert(');
    expect(parsed.body).not.toContain('color:red');
    expect(parsed.url).toBe('/campus/portal/messageView.xsl?x=messenger.MessengerEngine-getMessageRecipientView&messageID=100&messageRecipientID=200&processMessageID=300');
  });

  it("passes through messageUrl that already starts with /campus/", async () => {
    const client = new ICClient(account);
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValue(SAMPLE_HTML);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    await handlers.get('ic_get_message')!({
      district: 'anoka',
      messageUrl: '/campus/portal/messageView.xsl?x=y',
    });
    expect(requestSpy.mock.calls[0][1]).toBe('/campus/portal/messageView.xsl?x=y');
  });

  it("prefixes a leading slash-only path (/foo) with /campus", async () => {
    const client = new ICClient(account);
    const requestSpy = vi.spyOn(client, 'request').mockResolvedValue(SAMPLE_HTML);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    await handlers.get('ic_get_message')!({
      district: 'anoka',
      messageUrl: '/portal/messageView.xsl?x=y',
    });
    expect(requestSpy.mock.calls[0][1]).toBe('/campus/portal/messageView.xsl?x=y');
  });

  it('handles title without "Message -- " prefix (uses title as-is)', async () => {
    const html = '<html><title>Raw Subject</title><body>Date: 01/02/2026 Body goes here</body></html>';
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue(html);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_get_message')!({ district: 'anoka', messageUrl: 'portal/messageView.xsl' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.subject).toBe('Raw Subject');
    expect(parsed.date).toBe('01/02/2026');
    expect(parsed.body).toBe('Body goes here');
  });

  it('handles body with no Date: line (full text becomes the body)', async () => {
    const html = '<html><title>Message -- NoDate</title><body>Just a note, no date line.</body></html>';
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue(html);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_get_message')!({ district: 'anoka', messageUrl: 'portal/messageView.xsl' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.subject).toBe('NoDate');
    expect(parsed.date).toBeNull();
    expect(parsed.body).toContain('Just a note, no date line.');
  });

  it('handles HTML with no <title> at all (empty subject)', async () => {
    const html = '<html><body>Date: 03/04/2026 Body.</body></html>';
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue(html);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_get_message')!({ district: 'anoka', messageUrl: 'portal/messageView.xsl' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.subject).toBe('');
    expect(parsed.date).toBe('03/04/2026');
    expect(parsed.body).toBe('Body.');
  });

  it('handles empty response body gracefully', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue(null);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    handlers = new Map();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
      handlers.set(name, cb as ToolHandler); return undefined as never;
    });
    registerMessageTools(server, client);

    const result = await handlers.get('ic_get_message')!({ district: 'anoka', messageUrl: 'portal/messageView.xsl' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ subject: '', date: null, body: '', url: '/campus/portal/messageView.xsl' });
  });
});
