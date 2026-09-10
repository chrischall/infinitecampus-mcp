import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// The tool surface must not follow the environment.
//
// This server is hosted with `perUserChild` + `authFields`, so mcp-host spawns
// a PRINCIPAL-LESS child — for prewarm, auto-update, restart and every
// admin-portal tool listing — with none of the per-user config set. That
// child's list is what the portal publishes as the connector's surface, and it
// advertised ONE tool for a connector that has twenty.
//
// Only a spawn of the real bundle can catch this: index.ts is a top-level-await
// script whose branch is taken before anything is importable.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'bundle.js');

beforeAll(() => {
  if (!existsSync(BUNDLE)) execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
}, 180_000);

function listTools(env: Record<string, string>): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'ic-surface-'));
  copyFileSync(BUNDLE, join(dir, 'bundle.js'));
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(dir, 'bundle.js')], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
      reject(new Error(`timed out; stderr:\n${err}`));
    }, 30_000);
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.stdout.on('data', (d) => {
      out += d.toString();
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: { id?: number; result?: { tools?: { name: string }[] } };
        try {
          msg = JSON.parse(t);
        } catch {
          continue;
        }
        if (msg.id === 1 && msg.result) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          rmSync(dir, { recursive: true, force: true });
          resolve((msg.result.tools ?? []).map((x) => x.name));
          return;
        }
      }
    });
    child.stdin.write(
      '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"surface-test","version":"1"}}}\n',
    );
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  });
}

/** Enough to satisfy config.ts; no network is touched by a tools/list. */
const CONFIGURED = {
  IC_BASE_URL: 'https://example.infinitecampus.org',
  IC_DISTRICT: 'demo',
  IC_USERNAME: 'u',
  IC_PASSWORD: 'p',
};
const UNCONFIGURED = { IC_BASE_URL: '', IC_DISTRICT: '', IC_USERNAME: '', IC_PASSWORD: '' };

describe('tool surface', () => {
  it('is identical configured and unconfigured', async () => {
    const [configured, unconfigured] = await Promise.all([
      listTools(CONFIGURED),
      listTools(UNCONFIGURED),
    ]);
    expect(configured.length).toBeGreaterThan(10);
    expect([...unconfigured].sort()).toEqual([...configured].sort());
  }, 90_000);

  it('still offers the healthcheck when unconfigured', async () => {
    // The property the old behaviour was protecting, kept: a server that can
    // explain itself beats one that cannot.
    expect(await listTools(UNCONFIGURED)).toContain('ic_healthcheck');
  }, 60_000);
});
