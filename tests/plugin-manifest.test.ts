// Invariant: .claude-plugin/plugin.json declares its MCP config under
// `mcpServers`, the key Claude Code reads. `mcp` is not a manifest field —
// `claude plugin validate` reports "Unknown field 'mcp'" and Claude Code
// ignores it at load time. It only appeared to work here because
// ./.mcp.json is the default location anyway; sibling repos that copied
// the `mcp` key with a non-default path shipped broken plugin installs.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
) as Record<string, unknown>;

describe('.claude-plugin/plugin.json', () => {
  it('declares the MCP config under mcpServers, not the ignored mcp key', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(plugin).toHaveProperty('mcpServers');
  });

  it('points mcpServers at a file that exists', () => {
    const ref = plugin.mcpServers;
    expect(typeof ref).toBe('string');
    expect(existsSync(join(ROOT, ref as string))).toBe(true);
  });
});
