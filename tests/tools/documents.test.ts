import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/server';
import { ICClient } from '../../src/client.js';
import { registerDocumentTools } from '../../src/tools/documents.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { name: 'anoka', baseUrl: 'https://anoka.infinitecampus.org', district: 'anoka', username: 'u', password: 'p' };
let handlers: Map<string, ToolHandler>;

function setup(client: ICClient) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  handlers = new Map();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler); return undefined as never;
  });
  registerDocumentTools(server, client);
}
afterEach(() => vi.restoreAllMocks());

const STUDENT = {
  personID: 12345,
  enrollments: [{ enrollmentID: 1, calendarID: 2, structureID: 3917 }],
};

function mockStudentAndReport(client: ICClient, reportResult: unknown | Error) {
  vi.spyOn(client, 'getFeatures').mockResolvedValue({ documents: true });
  vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
    if (path === '/campus/api/portal/students') return [STUDENT];
    if (reportResult instanceof Error) throw reportResult;
    return reportResult as never;
  });
}

describe('ic_list_documents', () => {
  it('calls /campus/resources/portal/report/all and trims response', async () => {
    const client = new ICClient(account);
    mockStudentAndReport(client, [
      {
        name: 'Student Schedule',
        type: 'studentSchedule',
        url: '/campus/schedule.pdf',
        moduleLabel: 'Schedule',
        endYear: 2026,
        structureID: 3917,
        _model: 'report',
      },
    ]);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(client.request).toHaveBeenCalledWith('anoka', '/campus/resources/portal/report/all?personID=12345');
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        name: 'Student Schedule',
        type: 'studentSchedule',
        url: '/campus/schedule.pdf',
        moduleLabel: 'Schedule',
        endYear: 2026,
      },
    ]);
  });

  it('omits fields that are not present on the raw doc', async () => {
    const client = new ICClient(account);
    mockStudentAndReport(client, [
      { name: 'X', url: '/x.pdf' }, // missing type/moduleLabel/endYear
      { type: 'reportCard' }, // missing name/url/moduleLabel/endYear
    ]);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { name: 'X', url: '/x.pdf' },
      { type: 'reportCard' },
    ]);
  });

  it('handles null response from endpoint', async () => {
    const client = new ICClient(account);
    mockStudentAndReport(client, null);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it('returns FeatureDisabled on 404 backstop', async () => {
    const client = new ICClient(account);
    mockStudentAndReport(client, new Error('IC 404 Not Found for /campus/resources/portal/report/all?personID=12345'));
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ warning: 'FeatureDisabled', feature: 'documents', district: 'anoka', data: [] });
  });

  it('short-circuits via displayOptions when documents flag is false', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'getFeatures').mockResolvedValue({ documents: false });
    vi.spyOn(client, 'request').mockImplementation(async (_d: string, path: string) => {
      if (path === '/campus/api/portal/students') return [STUDENT] as never;
      throw new Error('endpoint should not be called');
    });
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      warning: 'FeatureDisabled', feature: 'documents', district: 'anoka',
    });
    const urls = (client.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as string);
    expect(urls.some((u) => u.startsWith('/campus/resources/portal/report/all'))).toBe(false);
  });

  it('returns StudentNotFound when studentId not in list', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'getFeatures').mockResolvedValue({ documents: true });
    vi.spyOn(client, 'request').mockResolvedValue([STUDENT] as never);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '99999' });
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'StudentNotFound', studentId: '99999' });
  });

  it('rethrows non-404 errors', async () => {
    const client = new ICClient(account);
    mockStudentAndReport(client, new Error('IC 500 Internal Server Error'));
    setup(client);
    await expect(handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' })).rejects.toThrow('IC 500');
  });
});

describe('ic_download_document', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ic-doc-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('calls client.download with the document URL and destinationPath', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'download').mockResolvedValue({
      path: join(dir, 'r.pdf'), bytes: 100, contentType: 'application/pdf',
    });
    setup(client);

    const result = await handlers.get('ic_download_document')!({
      district: 'anoka',
      documentId: '/campus/x.pdf',
      destinationPath: join(dir, 'r.pdf'),
    });

    expect(client.download).toHaveBeenCalledWith('anoka', '/campus/x.pdf', join(dir, 'r.pdf'), { overwrite: false });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ bytes: 100, contentType: 'application/pdf' });
  });

  it('passes overwrite:true through', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'download').mockResolvedValue({
      path: 'p', bytes: 1, contentType: 'application/pdf',
    });
    setup(client);
    await handlers.get('ic_download_document')!({
      district: 'anoka', documentId: '/x', destinationPath: '/p', overwrite: true,
    });
    expect(client.download).toHaveBeenCalledWith('anoka', '/x', '/p', { overwrite: true });
  });

  it('returns FeatureDisabled on download 404', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'download').mockRejectedValue(new Error('IC download 404 for /campus/x.pdf'));
    setup(client);
    const result = await handlers.get('ic_download_document')!({
      district: 'anoka', documentId: '/campus/x.pdf', destinationPath: join(dir, 'r.pdf'),
    });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ warning: 'FeatureDisabled', feature: 'documents', district: 'anoka' });
  });

  it('rethrows non-404 download errors', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'download').mockRejectedValue(new Error('IC download 500 for /campus/x.pdf'));
    setup(client);
    await expect(handlers.get('ic_download_document')!({
      district: 'anoka', documentId: '/campus/x.pdf', destinationPath: join(dir, 'r.pdf'),
    })).rejects.toThrow('IC download 500');
  });
});

// ---------------------------------------------------------------------------
// Delivery: a hosted caller (claude.ai on mcp-host) shares no filesystem with
// this server, so a saved path is useless to it. Hosted → signed link; local →
// the confined disk write above, unchanged; inline:true → the bytes in the
// result when they fit.
// ---------------------------------------------------------------------------

const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const BLOB_BASE = 'https://host.example/b/reg_0123456789abcdef01234567';

type FullResult = { content: Array<{ type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } }> };

function fakeBlobStore() {
  process.env.MCP_BLOB_BASE_URL = BLOB_BASE;
  process.env.MCP_BLOB_SIGNING_KEY = 'a2V5';
  const puts: Array<{ url: string; type: string; bytes: Uint8Array }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    puts.push({ url, type: new Headers(init!.headers).get('content-type')!, bytes: new Uint8Array(init!.body as ArrayBuffer) });
    return new Response(null, { status: 201 });
  }));
  return puts;
}

function receipt(result: FullResult): Record<string, unknown> {
  const text = result.content.find((c) => c.type === 'text')!.text!;
  return JSON.parse(text);
}

describe('ic_download_document — delivery', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ic-deliver-')); });
  afterEach(async () => {
    delete process.env.MCP_BLOB_BASE_URL;
    delete process.env.MCP_BLOB_SIGNING_KEY;
    delete process.env.MCP_DATA_DIR;
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  function docClient(bytes: Uint8Array = PDF, extra: { fileName?: string } = {}) {
    const client = new ICClient(account);
    vi.spyOn(client, 'fetchDocument').mockResolvedValue({ bytes, contentType: 'application/pdf', ...extra });
    const download = vi.spyOn(client, 'download');
    setup(client);
    return { client, download };
  }
  const call = (args: Record<string, unknown>) =>
    handlers.get('ic_download_document')!({ district: 'anoka', documentId: '/campus/x.pdf', ...args }) as unknown as Promise<FullResult>;

  it('hosted: PUTs the document to the blob store and returns a signed link, never touching disk', async () => {
    const puts = fakeBlobStore();
    const { client, download } = docClient();
    const result = await call({ destinationPath: 'report.pdf' });

    expect(download).not.toHaveBeenCalled();
    expect(client.fetchDocument).toHaveBeenCalledWith('anoka', '/campus/x.pdf');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toMatch(new RegExp(`^${BLOB_BASE}/documents/[0-9a-f-]{36}/report\\.pdf\\?`));
    expect(puts[0].type).toBe('application/pdf');
    expect(Array.from(puts[0].bytes)).toEqual(Array.from(PDF));

    expect(result.content).toHaveLength(1);
    const r = receipt(result);
    expect(r).toMatchObject({
      via: 'link', fileName: 'report.pdf', bytes: PDF.length, contentType: 'application/pdf',
    });
    expect(String(r.downloadUrl)).toMatch(new RegExp(`^${BLOB_BASE}/documents/`));
    expect(typeof r.downloadExpiresAt).toBe('string');
    expect(r.path).toBeUndefined();
  });

  it('hosted: destinationPath needs no confinement — only its basename names the file', async () => {
    const puts = fakeBlobStore();
    docClient();
    const r = receipt(await call({ destinationPath: '/etc/elsewhere/card.pdf' }));
    expect(r.fileName).toBe('card.pdf');
    expect(puts[0].url).toContain('/card.pdf?');
  });

  it('hosted: without destinationPath, names the file from content-disposition, else a default', async () => {
    fakeBlobStore();
    docClient(PDF, { fileName: 'Progress Report.pdf' });
    expect(receipt(await call({})).fileName).toBe('Progress Report.pdf');

    vi.restoreAllMocks();
    fakeBlobStore();
    docClient();
    expect(receipt(await call({})).fileName).toBe('document.pdf');
  });

  it('hosted with no blob store: a small document comes back inline, with a note', async () => {
    process.env.MCP_DATA_DIR = dir;
    const { download } = docClient();
    const result = await call({});
    expect(download).not.toHaveBeenCalled();
    const block = result.content.find((c) => c.type === 'resource')!;
    expect(block.resource).toMatchObject({ mimeType: 'application/pdf', blob: Buffer.from(PDF).toString('base64') });
    const r = receipt(result);
    expect(r).toMatchObject({ via: 'resource', bytes: PDF.length });
    expect(String(r.note)).toMatch(/blob store/);
  });

  it('hosted with no blob store: an over-cap document is refused as too_large, not written to disk', async () => {
    process.env.MCP_DATA_DIR = dir;
    const { download } = docClient(new Uint8Array(10 * 1024 * 1024 + 1));
    await expect(call({})).rejects.toMatchObject({ kind: 'too_large' });
    expect(download).not.toHaveBeenCalled();
  });

  it('inline:true returns the bytes as an embedded resource, even with a blob store', async () => {
    const puts = fakeBlobStore();
    const { download } = docClient();
    const result = await call({ inline: true, destinationPath: 'r.pdf' });
    expect(puts).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: 'resource', resource: { mimeType: 'application/pdf', blob: Buffer.from(PDF).toString('base64') },
    });
    expect(receipt(result)).toMatchObject({ via: 'resource', fileName: 'r.pdf', bytes: PDF.length });
  });

  it('inline:true over the inline cap falls back to a link when hosted', async () => {
    const puts = fakeBlobStore();
    docClient(new Uint8Array(10 * 1024 * 1024 + 1));
    const r = receipt(await call({ inline: true }));
    expect(r.via).toBe('link');
    expect(puts).toHaveLength(1);
    expect(String(r.note)).toMatch(/too large to return inline/);
  });

  it('inline:true over the inline cap on a local install is refused as too_large', async () => {
    const { download } = docClient(new Uint8Array(10 * 1024 * 1024 + 1));
    await expect(call({ inline: true })).rejects.toMatchObject({ kind: 'too_large' });
    expect(download).not.toHaveBeenCalled();
  });

  it('local without inline still requires destinationPath, and fetches nothing without one', async () => {
    const { client, download } = docClient();
    await expect(call({})).rejects.toThrow(/destinationPath is required/);
    expect(download).not.toHaveBeenCalled();
    expect(client.fetchDocument).not.toHaveBeenCalled();
  });

  it('inline:false on a local install is the disk default', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'download').mockResolvedValue({ path: join(dir, 'r.pdf'), bytes: 3, contentType: 'application/pdf' });
    vi.spyOn(client, 'fetchDocument');
    setup(client);
    const r = receipt(await call({ inline: false, destinationPath: join(dir, 'r.pdf') }));
    expect(r).toEqual({ path: join(dir, 'r.pdf'), bytes: 3, contentType: 'application/pdf' });
    expect(client.fetchDocument).not.toHaveBeenCalled();
  });

  it('returns FeatureDisabled when a hosted fetch 404s', async () => {
    fakeBlobStore();
    const client = new ICClient(account);
    vi.spyOn(client, 'fetchDocument').mockRejectedValue(new Error('IC download 404 for /campus/x.pdf'));
    setup(client);
    expect(receipt(await call({}))).toEqual({ warning: 'FeatureDisabled', feature: 'documents', district: 'anoka' });
  });

  it('advertises inline and an optional destinationPath', async () => {
    const client = new ICClient(account);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, c: unknown) => {
      if (name === 'ic_download_document') schema = (c as { inputSchema: typeof schema }).inputSchema;
      return undefined as never;
    });
    registerDocumentTools(server, client);
    expect(schema!.safeParse({ district: 'a', documentId: '/x' }).success).toBe(true);
    expect(schema!.safeParse({ district: 'a', documentId: '/x', inline: true }).success).toBe(true);
    expect(schema!.safeParse({ district: 'a', documentId: '/x', inline: 'yes' }).success).toBe(false);
  });
});
