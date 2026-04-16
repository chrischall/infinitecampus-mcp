import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { textContent, is404, featureDisabled, toArray } from './_shared.js';

interface RawDocument {
  name?: string;
  type?: string;
  url?: string;
  moduleLabel?: string;
  endYear?: number;
  [key: string]: unknown;
}

interface TrimmedDocument {
  name?: string;
  type?: string;
  url?: string;
  moduleLabel?: string;
  endYear?: number;
}

const listArgs = z.object({
  district: z.string(),
  studentId: z.string(),
});

const downloadArgs = z.object({
  district: z.string(),
  documentId: z.string().describe('The url field returned by ic_list_documents'),
  destinationPath: z.string().describe('Absolute path where the PDF should be written'),
  overwrite: z.boolean().optional(),
});

export function registerDocumentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_documents', {
    description: "List a student's available documents (report cards, transcripts, schedules). Returns metadata only — use ic_download_document to fetch the file. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    try {
      const raw = await client.request<RawDocument | RawDocument[] | null>(
        args.district,
        `/campus/resources/portal/report/all?personID=${encodeURIComponent(args.studentId)}`,
      );
      const trimmed: TrimmedDocument[] = toArray(raw).map((d) => {
        const out: TrimmedDocument = {};
        if (d.name !== undefined) out.name = d.name;
        if (d.type !== undefined) out.type = d.type;
        if (d.url !== undefined) out.url = d.url;
        if (d.moduleLabel !== undefined) out.moduleLabel = d.moduleLabel;
        if (d.endYear !== undefined) out.endYear = d.endYear;
        return out;
      });
      return textContent(trimmed);
    } catch (e) {
      if (is404(e)) return featureDisabled('documents', args.district);
      throw e;
    }
  });

  server.registerTool('ic_download_document', {
    description: "Download a student's document (PDF) to disk. documentId is the url field returned by ic_list_documents. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { destructiveHint: true },
    inputSchema: downloadArgs.shape,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    try {
      const meta = await client.download(args.district, args.documentId, args.destinationPath, {
        overwrite: args.overwrite ?? false,
      });
      return textContent(meta);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC download 404')) {
        return textContent({ warning: 'FeatureDisabled', feature: 'documents', district: args.district });
      }
      throw e;
    }
  });
}
