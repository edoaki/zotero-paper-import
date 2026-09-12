import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, delimiter } from 'node:path';
import { detectCLI, runProcess } from './ai';
import type { Provider, Settings } from './core';

export interface ModelOption { value: string; label: string }
export function defaultModels(provider: Provider): ModelOption[] {
  const auto = { value: '', label: provider === 'codex' ? '自動（Codexの標準モデル）' : '自動（CLIの既定モデル）' };
  if (provider === 'claude') return [auto, { value: 'sonnet', label: 'Sonnet（標準）' }, { value: 'opus', label: 'Opus（高性能）' }, { value: 'haiku', label: 'Haiku（高速）' }];
  return [auto];
}
export function codexOptions(rows: unknown[]): ModelOption[] {
  return rows.flatMap((value): ModelOption[] => {
    const row = value as Record<string, unknown>;
    if (!row || row.hidden || typeof row.model !== 'string' || !row.model.trim()) return [];
    if (Array.isArray(row.inputModalities) && !row.inputModalities.includes('text')) return [];
    const name = typeof row.displayName === 'string' ? row.displayName : row.model;
    return [{ value: row.model, label: name + (row.isDefault ? '（標準）' : '') }];
  });
}
export function openCodeOptions(text: string): ModelOption[] {
  return [...new Set(text.split(/\r?\n/).map(s => s.trim()).filter(s => /^[\w.-]+\/[\w./:@+-]+$/.test(s)))].map(value => ({ value, label: value }));
}
export function antigravityOptions(text: string): ModelOption[] {
  const models = new Map<string, ModelOption>();
  for (const line of text.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z0-9]+(?:[._-][a-z0-9]+)+)\s+(.+)$/);
    if (match) models.set(match[1], { value: match[1], label: match[2].trim() });
  }
  if (!models.size) throw new Error('Antigravity CLIのモデル一覧を取得できませんでした。ターミナルでagyを開いてログインしてください。');
  return [...models.values()];
}
export async function listCodexModels(executable: string, signal?: AbortSignal): Promise<ModelOption[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('キャンセルしました')); return; }
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: tmpdir(), shell: false, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, PATH: [dirname(executable), process.env.PATH || '', '/usr/bin', '/bin'].join(delimiter) },
    });
    let buffer = '', done = false, bytes = 0;
    let id = 2; const rows: unknown[] = [], cursors = new Set<string>();
    const stop = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* exited */ } };
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); stop();
      if (error) reject(error); else resolve(codexOptions(rows));
    };
    const abort = () => finish(new Error('キャンセルしました'));
    const timer = setTimeout(() => finish(new Error('モデル一覧を取得できませんでした。Codexのログイン状態を確認してください。')), 20000);
    const send = (data: unknown) => child.stdin.write(JSON.stringify(data) + '\n');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.on('error', () => { /* handled by exit */ });
    child.stderr.on('data', () => { /* no raw logs or credentials */ });
    child.on('error', () => finish(new Error('Codexを起動できませんでした。実行ファイルを確認してください。')));
    child.on('close', () => { if (!done) finish(new Error('モデル一覧の取得中にCodexが終了しました。')); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length; if (bytes > 4_000_000) { finish(new Error('モデル一覧の応答が大きすぎます。')); return; }
      buffer += String(chunk);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1 && !done) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message: { id?: number; error?: unknown; result?: { data?: unknown[]; nextCursor?: string } };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) { finish(new Error('このCodexではモデル一覧を取得できません。CLIを更新してください。')); return; }
          send({ method: 'initialized' });
          send({ id, method: 'model/list', params: { limit: 100, includeHidden: false } });
        } else if (message.id === id) {
          if (message.error || !Array.isArray(message.result?.data)) { finish(new Error('Codexのモデル一覧を読み取れませんでした。')); return; }
          rows.push(...message.result!.data!);
          const cursor = message.result!.nextCursor;
          if (cursor && !cursors.has(cursor) && rows.length < 1000) {
            cursors.add(cursor); id++;
            send({ id, method: 'model/list', params: { limit: 100, includeHidden: false, cursor } });
          } else finish();
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'zotero_paper_import', version: '0.1.2' } } });
  });
}
export async function discoverModels(settings: Settings, signal?: AbortSignal): Promise<ModelOption[]> {
  const base = defaultModels(settings.provider);
  if (settings.provider === 'claude') return base;
  const executable = await detectCLI(settings.provider, settings.cliPath);
  const models = settings.provider === 'codex' ? await listCodexModels(executable, signal) : (settings.provider === 'antigravity' ? antigravityOptions : openCodeOptions)(await runProcess(executable, ['models'], '', tmpdir(), 20000, signal));
  return [...base, ...models];
}
