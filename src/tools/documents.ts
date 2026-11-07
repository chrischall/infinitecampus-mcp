import { McpServer } from '@modelcontextprotocol/server';
import { minifiedResult, McpToolError } from '@chrischall/mcp-utils';
import { blobStoreFromEnv, deliverFile, isHostedEnv, type DeliveredFile } from '@chrischall/mcp-utils/export';
import { basename } from 'node:path';
import { viewArg, viewResponse } from '../view.js';
import { z } from 'zod';
import type { ICClient } from '../client.js';
import { is404, featureDisabled, toArray, findStudent, studentNotFound, checkFeatureDisabled } from './_shared.js';
import type { MintHint } from '../mint.js';

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
  destinationPath: z.string().optional().describe(
    'Local install: where to write the PDF (required unless inline is true). Must be inside the download directory ' +
      '(IC_DOWNLOAD_DIR, default ~/Downloads); a relative path resolves against it. On a hosted server nothing is ' +
      'written to disk and only its file name is used, to name the download link.',
  ),
  overwrite: z.boolean().optional(),
  inline: z.boolean().optional().describe(
    'Return the document in the result as an embedded file (up to 10 MiB) instead of saving it or linking to it. ' +
      'Larger documents come back as a download link when hosted.',
  ),
});

/** Name used for a link / inline file when neither the caller nor IC names one. */
const DEFAULT_FILE_NAME = 'document.pdf';

export function registerDocumentTools(server: McpServer, client: ICClient): void {
  server.registerTool('ic_list_documents', {
    description: "List a student's available documents (report cards, transcripts, schedules). Returns metadata only — use ic_download_document to fetch the file. Returns FeatureDisabled if the district has the module turned off.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: { mint: { domain: 'school', intent: 'lookup' } satisfies MintHint },
    inputSchema: z.object({ ...listArgs.shape, view: viewArg() }),
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);

    const student = await findStudent(client, args.district, args.studentId);
    if (!student) return studentNotFound(args.studentId);

    const disabled = await checkFeatureDisabled(client, args.district, args.studentId, student, 'documents', 'documents');
    if (disabled) return disabled;

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
      return viewResponse((rawArgs as { view?: string }).view, trimmed);
    } catch (e) {
      if (is404(e)) return featureDisabled('documents', args.district);
      throw e;
    }
  });

  server.registerTool('ic_download_document', {
    description:
      "Download a student's document (PDF). documentId is the url field returned by ic_list_documents. " +
      'On a hosted server it returns a signed, expiring download link (give it only to the user) — nothing is written to the server disk. ' +
      'On a local install it writes to destinationPath inside the download directory (IC_DOWNLOAD_DIR, default ~/Downloads) and will not overwrite an existing file unless overwrite is true. ' +
      'inline:true returns the file in the result instead (up to 10 MiB). Returns FeatureDisabled if the district has the module turned off.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: { mint: { domain: 'school', intent: 'other' } satisfies MintHint },
    inputSchema: downloadArgs,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    const hosted = isHostedEnv();
    try {
      // Local install, no inline: the confined disk write, exactly as before.
      if (!hosted && !args.inline) {
        if (args.destinationPath === undefined) {
          throw new McpToolError(
            'destinationPath is required to save the document on this (local) server — or pass inline: true to get it in the result.',
            { kind: 'unknown' },
          );
        }
        const meta = await client.download(args.district, args.documentId, args.destinationPath, {
          overwrite: args.overwrite ?? false,
        });
        return minifiedResult(meta);
      }

      // Hosted (the caller shares no filesystem with this server), or inline
      // asked for: hand the bytes back through the shared delivery ladder.
      const doc = await client.fetchDocument(args.district, args.documentId);
      const fileName = (args.destinationPath !== undefined ? basename(args.destinationPath) : '') ||
        doc.fileName || DEFAULT_FILE_NAME;
      const delivered = await deliverFile({
        bytes: doc.bytes,
        fileName,
        mimeType: doc.contentType,
        prefer: args.inline ? 'inline' : 'link',
        store: blobStoreFromEnv() ?? null,
        keyPrefix: 'documents',
        // No disk route: hosted, the runner's disk is unreachable; locally,
        // inline was asked for, and destinationPath is the disk route.
      });
      return deliveredResult(delivered);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('IC download 404')) {
        return minifiedResult({ warning: 'FeatureDisabled', feature: 'documents', district: args.district });
      }
      throw e;
    }
  });
}

/**
 * The tool result for a document handed back by deliverFile: its inline
 * content blocks (none for a link), then a JSON receipt. `bytes`/`contentType`
 * keep the disk receipt's names (contentType normalized, no `;charset`); the link fields follow the fleet's
 * downloadUrl / downloadExpiresAt.
 */
function deliveredResult(d: DeliveredFile) {
  const receipt = minifiedResult({
    via: d.via,
    fileName: d.fileName,
    bytes: d.sizeBytes,
    contentType: d.mimeType,
    ...(d.url !== undefined ? { downloadUrl: d.url } : {}),
    ...(d.expiresAt !== undefined ? { downloadExpiresAt: d.expiresAt } : {}),
    ...(d.note !== undefined ? { note: d.note } : {}),
  });
  return { ...receipt, content: [...d.content, ...receipt.content] };
}
