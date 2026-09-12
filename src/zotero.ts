import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Paper, ZoteroItem } from './core';

export class ConnectionError extends Error {
  constructor(public kind: 'offline' | 'disabled' | 'version' | 'other', message: string) { super(message); }
}
export interface Reply { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
export const MAX_PDF_BYTES = 128 * 1024 * 1024;
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function isPDF(bytes: Uint8Array): boolean { return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-')); }
export function localRequest(port: number, path: string, signal?: AbortSignal): Promise<Reply> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !path.startsWith('/api/')) return Promise.reject(new Error('Invalid local API address'));
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { 'Zotero-API-Version': '3', Accept: 'application/json' }, signal }, res => {
      const chunks: Buffer[] = []; let length = 0;
      res.on('data', (b: Buffer) => { length += b.length; if (length > MAX_PDF_BYTES) req.destroy(new Error('Response too large')); else chunks.push(b); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('Connection timed out')));
    req.on('error', reject);
  });
}
export class ZoteroClient {
  serverId = '';
  version = '';
  constructor(public port = 23119) {}
  async probe(signal?: AbortSignal): Promise<void> {
    let r: Reply;
    try { r = await localRequest(this.port, '/api/', signal); }
    catch { if (signal?.aborted) throw new Error('Cancelled / キャンセルしました'); throw new ConnectionError('offline', 'No response from Zotero. Open Zotero, then retry. If it is already running, check the local API port. / Zoteroから応答がありません。起動と通信設定を確認してください。'); }
    if (r.status === 403) throw new ConnectionError('disabled', 'In Zotero: Settings → Advanced → Allow other applications on this computer to communicate with Zotero. / Zoteroの設定 → 詳細で、他のアプリケーションとの通信を許可してください。');
    this.version = String(r.headers['zotero-version'] || String(r.headers.server || '').match(/Zotero\/([\d.]+)/)?.[1] || '');
    this.serverId = String(r.headers['zotero-server-id'] || '');
    if (!this.serverId || ![200, 300].includes(r.status)) throw new ConnectionError('version', `Zotero 10 or newer is required by this beta. Detected: ${this.version || 'unknown'}. / このベータ版はZotero 10以降に対応しています。`);
    await this.get('/users/0/items/top?limit=1', signal);
  }
  async get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    const r = await localRequest(this.port, '/api' + path, signal);
    if (r.status !== 200) throw new Error(`Zotero returned HTTP ${r.status}. / Zoteroの読み取りに失敗しました。`);
    if (this.serverId && r.headers['zotero-server-id'] !== this.serverId) throw new Error('Zotero library changed during this operation. Retry / 接続先が変わりました。再実行してください。');
    return JSON.parse(r.body.toString('utf8')) as T;
  }
  async libraries(): Promise<{ path: string; name: string }[]> {
    const groups = await this.get<Array<{ id?: number; data?: { id?: number; name?: string } }>>('/users/0/groups');
    return [{ path: 'users/0', name: 'My Library / マイライブラリ' }, ...groups.map(g => ({ path: 'groups/' + (g.id || g.data?.id), name: g.data?.name || 'Group' })).filter(g => /^groups\/\d+$/.test(g.path))];
  }
  async search(query: string, library: string, signal?: AbortSignal): Promise<ZoteroItem[]> {
    const items = await this.get<ZoteroItem[]>(`/${library}/items/top?limit=100&sort=dateAdded&direction=desc&q=${encodeURIComponent(query)}&qmode=titleCreatorYear`, signal);
    return items.filter(i => !['attachment', 'note'].includes(i.data.itemType || ''));
  }
  async paper(key: string, library: string, signal?: AbortSignal): Promise<Paper> {
    if (!/^[A-Z0-9]{8}$/.test(key) || !/^(users\/0|groups\/\d+)$/.test(library)) throw new Error('Invalid Zotero identity');
    return { item: await this.get<ZoteroItem>(`/${library}/items/${key}`, signal), library, serverId: this.serverId };
  }
  async attachments(paper: Paper, signal?: AbortSignal): Promise<ZoteroItem[]> {
    const children = await this.get<ZoteroItem[]>(`/${paper.library}/items/${paper.item.key}/children`, signal);
    return children.filter(c => c.data.itemType === 'attachment' && c.data.contentType === 'application/pdf');
  }
  async pdf(paper: Paper, key: string, signal?: AbortSignal): Promise<Buffer> {
    const r = await localRequest(this.port, `/api/${paper.library}/items/${key}/file`, signal);
    if (r.headers['zotero-server-id'] !== this.serverId) throw new Error('Zotero connection changed / 接続先が変わりました');
    let bytes: Buffer;
    if (r.status === 302 && r.headers.location) {
      const location = new URL(r.headers.location);
      if (location.protocol !== 'file:' || (location.hostname && location.hostname !== 'localhost')) throw new Error('Unexpected attachment location / PDFの保存先が不正です');
      const path = fileURLToPath(location);
      if (!/\.pdf$/i.test(path)) throw new Error('Attachment is not a PDF');
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_PDF_BYTES) throw new Error('PDF exceeds the 128 MiB beta limit.');
        bytes = await readFile(path, { signal });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('PDF is not downloaded on this computer. Open it in Zotero to download, then retry. / PDFをZoteroでダウンロードしてから再実行してください。');
        throw e;
      }
    } else if (r.status === 200) bytes = r.body;
    else throw new Error(`PDF unavailable (HTTP ${r.status}). Download it in Zotero first. / PDFをZoteroで取得してください。`);
    if (!isPDF(bytes)) throw new Error('Attachment did not contain valid PDF bytes / PDFの実体を確認できませんでした');
    return bytes;
  }
}
