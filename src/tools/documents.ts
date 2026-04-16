import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';

const listArgs = z.object({
  district: z.string(),
  studentId: z.string(),
});

const downloadArgs = z.object({
  district: z.string(),
  documentId: z.string().describe('The downloadUrl from ic_list_documents'),
  destinationPath: z.string().describe('Absolute path where the PDF should be written'),
  overwrite: z.boolean().optional(),
});

export function registerDocumentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_documents', {
    description: "List a student's available documents (report cards, transcripts, etc.). Returns metadata only — use ic_download_document to fetch the file. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    try {
      const data = await client.request(args.district, `/campus/resources/portal/documents?personID=${encodeURIComponent(args.studentId)}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC 404 ')) {
        const warn = { warning: 'FeatureDisabled', feature: 'documents', district: args.district, data: [] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });

  server.registerTool('ic_download_document', {
    description: "Download a student's document (PDF) to disk. documentId is the downloadUrl returned by ic_list_documents. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { destructiveHint: true },
    inputSchema: downloadArgs.shape,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    try {
      const meta = await client.download(args.district, args.documentId, args.destinationPath, {
        overwrite: args.overwrite ?? false,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(meta, null, 2) }] };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC download 404')) {
        const warn = { warning: 'FeatureDisabled', feature: 'documents', district: args.district };
        return { content: [{ type: 'text' as const, text: JSON.stringify(warn, null, 2) }] };
      }
      throw e;
    }
  });
}
