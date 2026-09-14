import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const UPDATE_REPO = 'edoaki/zotero-paper-import';
export const UPDATE_FILES = ['main.js', 'styles.css', 'manifest.json'] as const;
const API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const LIMIT = 25_000_000;
export type Download = (url: string) => Promise<Uint8Array>;
export interface UpdatePlan { version: string; files: Record<typeof UPDATE_FILES[number], Uint8Array> }
function version(value: unknown): number[] {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('更新版のバージョン形式を確認できません。');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('更新版のバージョンが不正です。');
  return parts;
}
export function newer(candidate: string, current: string): boolean {
  const a = version(candidate), b = version(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function json(bytes: Uint8Array): any {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('GitHubから受け取った更新情報を読み取れません。'); }
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function prepareUpdate(current: string, appVersion: string, download: Download): Promise<UpdatePlan | null> {
  const release = json(await download(API));
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') throw new Error('正式リリースを確認できません。');
  const next = release.tag_name.replace(/^v/, '');
  if (!newer(next, current)) return null;
  if (!Array.isArray(release.assets)) throw new Error('リリースに更新用ファイルがありません。');
  const files = {} as UpdatePlan['files'];
  for (const name of UPDATE_FILES) {
    const matches = release.assets.filter((asset: any) => asset?.name === name);
    if (matches.length !== 1) throw new Error(`リリースに更新用の ${name} がありません。`);
    const asset = matches[0];
    const expected = `https://github.com/${UPDATE_REPO}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
    if (asset.browser_download_url !== expected || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > LIMIT || !/^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '')) throw new Error(`更新用の ${name} の配布元・サイズ・検証情報を確認できません。`);
    const bytes = await download(expected);
    if (bytes.length !== asset.size || `sha256:${hash(bytes)}` !== asset.digest) throw new Error(`更新用の ${name} の検証に失敗しました。現在の版を保持します。`);
    files[name] = bytes;
  }
  const manifest = json(files['manifest.json']);
  if (manifest?.id !== 'zotero-paper-import' || manifest.version !== next) throw new Error('更新用ファイルのプラグイン名・バージョンが一致しません。');
  if (typeof manifest.minAppVersion !== 'string' || newer(manifest.minAppVersion, appVersion)) throw new Error(`先にObsidianを ${manifest.minAppVersion || '対応版'} 以上へ更新してください。`);
  if (files['main.js'].length < 100 || /^\s*</.test(new TextDecoder().decode(files['main.js'].subarray(0, 100)))) throw new Error('プラグイン本体として不正なファイルを受信しました。');
  return { version: next, files };
}

// All network and validation work finishes before touching the installed files.
// Keep the backup outside the plugin, and install the manifest last.
export async function installUpdate(pluginDir: string, backupRoot: string, plan: UpdatePlan, canInstall: () => boolean, replace = rename): Promise<string> {
  if (!canInstall()) throw new Error('文献の処理が終わってから更新してください。');
  const originals = new Map<string, Buffer>();
  for (const name of UPDATE_FILES) originals.set(name, await readFile(join(pluginDir, name)));
  const diskManifest = json(originals.get('manifest.json')!);
  if (diskManifest.id !== 'zotero-paper-import' || !newer(plan.version, diskManifest.version)) throw new Error('インストール済みの版が変わりました。Obsidianを再起動して確認してください。');
  await mkdir(backupRoot, { recursive: true });
  const backup = await mkdtemp(join(backupRoot, `zotero-paper-import-${diskManifest.version}-`));
  await cp(pluginDir, join(backup, 'original'), { recursive: true, errorOnExist: true, force: false });
  const stage = join(backup, 'staged'); await mkdir(stage);
  for (const name of UPDATE_FILES) await writeFile(join(stage, name), plan.files[name]);
  const replaced: string[] = [];
  try {
    if (!canInstall()) throw new Error('文献の処理が始まったため更新を中止しました。');
    for (const name of UPDATE_FILES) {
      if (!(await readFile(join(pluginDir, name))).equals(originals.get(name)!)) throw new Error('更新中にプラグインが別の場所から変更されました。');
      await replace(join(stage, name), join(pluginDir, name)); replaced.push(name);
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const name of replaced.reverse()) {
      try {
        if (hash(await readFile(join(pluginDir, name))) !== hash(plan.files[name as keyof UpdatePlan['files']])) { rollbackFailed = true; continue; }
        const restore = join(stage, name);
        await writeFile(restore, originals.get(name)!); await rename(restore, join(pluginDir, name));
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error(`更新と復元を完了できませんでした。バックアップ：${backup}`);
    throw new Error(`更新できなかったため元の版を保持しました。${error instanceof Error ? error.message : String(error)}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
  return backup;
}
