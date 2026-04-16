import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

describe('ic_list_documents', () => {
  it('returns document metadata array', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockResolvedValue([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '12345' });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: 'd1', type: 'reportCard', date: '2026-03-15', downloadUrl: '/x.pdf' },
    ]);
  });

  it('returns FeatureDisabled on 404', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockRejectedValue(new Error('IC 404 Not Found for /campus/resources/portal/documents?personID=123'));
    setup(client);
    const result = await handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '123' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toEqual({ warning: 'FeatureDisabled', feature: 'documents', district: 'anoka', data: [] });
  });

  it('rethrows non-404 errors', async () => {
    const client = new ICClient(account);
    vi.spyOn(client, 'request').mockRejectedValue(new Error('IC 500 Internal Server Error'));
    setup(client);
    await expect(handlers.get('ic_list_documents')!({ district: 'anoka', studentId: '123' })).rejects.toThrow('IC 500');
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
