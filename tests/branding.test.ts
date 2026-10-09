// The browser-extension fallback ships as "ContextMint Bridge". Every place a
// USER reads about it must use that name — a stale "fetchproxy" beside the
// renamed text reads as two different things to install. Env var NAMES
// (IC_DISABLE_FETCHPROXY) and npm package names are identifiers, not copy,
// and are deliberately left alone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('ContextMint Bridge naming in user-facing config copy', () => {
  it('manifest.json credential fields name ContextMint Bridge, not fetchproxy', () => {
    const cfg = (JSON.parse(read('manifest.json')) as {
      user_config: Record<string, { title: string; description: string }>;
    }).user_config;
    for (const key of ['ic_username', 'ic_password']) {
      const text = `${cfg[key].title} ${cfg[key].description}`;
      expect(text, key).toMatch(/ContextMint Bridge/);
      expect(text, key).not.toMatch(/fetchproxy/i);
    }
  });

  it('server.json IC_DISABLE_FETCHPROXY description names ContextMint Bridge', () => {
    const server = JSON.parse(read('server.json')) as {
      packages: { environmentVariables?: { name: string; description: string }[] }[];
    };
    const vars = server.packages.flatMap((p) => p.environmentVariables ?? []);
    const v = vars.find((e) => e.name === 'IC_DISABLE_FETCHPROXY');
    expect(v).toBeDefined();
    expect(v!.description).toMatch(/ContextMint Bridge/);
    expect(v!.description).not.toMatch(/fetchproxy/i);
  });

  it('mint.yaml IC_DISABLE_FETCHPROXY help names ContextMint Bridge', () => {
    const yaml = read('mint.yaml');
    const m = yaml.match(/- name: IC_DISABLE_FETCHPROXY\n(?:[ \t]+.*\n)*?[ \t]+help: >-\n((?:[ \t]{6,}.*\n)+)/);
    expect(m).not.toBeNull();
    const help = m![1].replace(/\s+/g, ' ');
    expect(help).toMatch(/ContextMint Bridge/);
    expect(help).not.toMatch(/fetchproxy/i);
  });

  it("README's fallback section heading names ContextMint Bridge", () => {
    const readme = read('README.md');
    expect(readme).toMatch(/\*\*ContextMint Bridge fallback \(no password needed\)\.\*\*/);
    expect(readme).not.toMatch(/\*\*fetchproxy fallback/i);
  });

  it('the startup banner (user-visible stderr) names ContextMint Bridge', () => {
    // index.ts is a top-level-await script whose bridge path needs a live
    // browser to reach, so the banner copy is checked at the source.
    const src = read('src/index.ts');
    expect(src).toMatch(/\[via ContextMint Bridge\]/);
    expect(src).not.toMatch(/\[via fetchproxy\]/i);
  });
});

// npm and the MCP registry publish package.json's description, and users and
// client policies read it to judge what the server can change. No tool sends a
// message or uploads a document — the only side effect is ic_download_document
// writing a file locally — so the description must not claim a write surface
// (chrischall/fleet-audit#513).
describe('package description states the real write surface', () => {
  it('does not claim message/document write support', () => {
    const { description } = JSON.parse(read('package.json')) as { description: string };
    expect(description).not.toMatch(/\bwrite\b/i);
    expect(description).toMatch(/read-only/i);
    expect(description).toMatch(/download/i);
  });
});
