import { access, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32, join } from 'node:path';
import type { Provider } from './core';
import { CLI_COMMANDS } from './cli-guide';

export interface CLIEnvironment { platform: string; home: string; env: NodeJS.ProcessEnv; nodeVersions?: string[] }
export function cliCandidates(provider: Provider, configured: string, context: CLIEnvironment): string[] {
  const windows = context.platform === 'win32', path = windows ? win32 : posix;
  const command = CLI_COMMANDS[provider], executable = command + (windows ? '.exe' : '');
  const clean = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');
  if (configured.trim()) {
    const selected = clean(configured).replace(/^~(?=[/\\])/, context.home);
    // Windows shell launchers cannot be spawned directly without a shell.
    return windows && /\.(?:cmd|bat|ps1)$/i.test(selected) ? [selected.replace(/\.(?:cmd|bat|ps1)$/i, '.exe')] : [selected];
  }
  const env = context.env;
  const dirs = (env.PATH || env.Path || '').split(windows ? ';' : ':').map(clean).filter(Boolean);
  dirs.push(...['.local/bin', '.npm-global/bin', '.bun/bin', '.opencode/bin', '.codex/bin'].map(p => path.join(context.home, p)));
  if (windows) {
    const local = env.LOCALAPPDATA || path.join(context.home, 'AppData', 'Local');
    dirs.push(path.join(local, 'agy', 'bin'), path.join(local, 'OpenAI', 'Codex', 'bin'), path.join(local, 'Microsoft', 'WinGet', 'Links'));
    const scoop = env.SCOOP || path.join(context.home, 'scoop');
    dirs.push(path.join(scoop, 'shims'), path.join(scoop, 'apps', command, 'current'), path.join(scoop, 'apps', command, 'current', 'bin'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin');
    for (const version of context.nodeVersions || []) dirs.push(path.join(context.home, '.nvm/versions/node', version, 'bin'));
  }
  return [...new Set(dirs.map(p => path.join(p, executable)))];
}
export async function detectCLI(provider: Provider, configured = ''): Promise<string> {
  let nodeVersions: string[] = [];
  if (!configured && process.platform !== 'win32') {
    try { nodeVersions = (await readdir(join(homedir(), '.nvm/versions/node'))).sort().reverse(); } catch { /* optional */ }
  }
  for (const file of cliCandidates(provider, configured, { platform: process.platform, home: homedir(), env: process.env, nodeVersions })) {
    try { await access(file, constants.X_OK); if ((await stat(file)).isFile()) return file; } catch { /* next */ }
  }
  throw new Error(`${CLI_COMMANDS[provider]}が見つかりません。設定に表示されるインストール手順に沿って導入し、「再検出」を押してください。`);
}
