import { App, TFile, TFolder, parseYaml, stringifyYaml, normalizePath } from 'obsidian';
import type { Storage, StoredNote } from './importer';
import { readRecord, replaceGenerated, type RecordData } from './core';
import { ImportedPapers, inFolder, paperIdentifiers } from './imported';
import { ZoteroClient } from './zotero';
import { uniqueKeyMatch } from './key-completion';
import type { JobProgress } from './queue';
import type { ZoteroItem } from './core';

export interface KeylessNote { path: string; title: string; identifiers: string[]; issue?: string }

export function frontmatter(text: string): { values: Record<string, unknown>; end: number } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) throw new Error('ノートのプロパティがありません');
  const values = parseYaml(m[1]);
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('ノートのプロパティ形式が不正です。');
  return { values, end: m[0].length };
}
export class VaultStorage implements Storage {
  constructor(private app: App, private pluginId: string) {}
  async keylessNotes(roots: string[]): Promise<KeylessNote[]> {
    const result: KeylessNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!roots.some(root => inFolder(file.path, root))) continue;
      const text = await this.app.vault.cachedRead(file);
      let fm: Record<string, unknown>; try { fm = frontmatter(text).values; } catch { continue; }
      if (fm['zotero-key']) continue;
      const identifiers = paperIdentifiers(fm);
      if (!identifiers.length && !fm.citekey && !fm['pdf-status'] && !fm.zpi) continue;
      const missing = typeof fm.arxiv === 'number' ? 'arxivのプロパティの種類を「テキスト」に変更し、正しいarXiv IDを設定してください。' : 'DOI・arXiv IDがありません。ノートのプロパティに確認済みの識別子を記入してください。';
      result.push({ path: file.path, title: String(fm.title || file.basename), identifiers, issue: fm.zpi ? 'プラグインの管理情報があるため、既存情報を確認してください。' : !identifiers.length ? missing : undefined });
    }
    return result;
  }
  async completeKey(path: string, library: string, client: ZoteroClient, progress: JobProgress): Promise<string> {
    if (!/^(users\/0|groups\/\d+)$/.test(library)) throw new Error('Zoteroのライブラリを選び直してください。');
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('対象ノートが移動・削除されました。一覧を更新してください。');
    const original = await this.app.vault.read(file), metadata = frontmatter(original).values;
    const declared = metadata['zotero-library'];
    if (declared && ![library, ...(library === 'users/0' ? ['My Library','マイライブラリ','library'] : [])].includes(String(declared))) throw new Error('ノートのライブラリ指定と選択したライブラリが異なります。選び直してください。');
    const identifiers = paperIdentifiers(metadata);
    if (metadata['zotero-key'] || metadata.zpi || !identifiers.length) uniqueKeyMatch(metadata, []);
    progress.update('ZoteroのDOI・arXiv IDと照合中…');
    await client.probe(progress.controller.signal);
    const items: ZoteroItem[] = []; let start = 0;
    while (true) {
      const page = await client.searchPage('', library, start, progress.controller.signal); items.push(...page.items);
      if (!page.hasMore) break; start += 100;
    }
    const matched = uniqueKeyMatch(metadata, items);
    const fresh = await client.paper(matched.key, library, progress.controller.signal);
    uniqueKeyMatch(metadata, [fresh.item]);
    progress.controller.signal.throwIfAborted();
    const current = await this.app.vault.read(file), fm = frontmatter(current).values;
    if (file.path !== path || JSON.stringify(paperIdentifiers(fm).sort()) !== JSON.stringify(identifiers.sort()) || fm['zotero-key'] || fm.zpi || fm['zotero-library'] !== declared) throw new Error('照合中に識別情報が変更されました。一覧を更新して再試行してください。');
    progress.commit(); progress.update('Zoteroキーを補完中…');
    await this.app.vault.process(file, text => {
      if (text !== current) throw new Error('保存直前にノートが編集されました。再試行してください。');
      const parsed = frontmatter(text);
      parsed.values['zotero-key'] = matched.key; parsed.values['zotero-library'] = library;
      parsed.values['zotero-status'] = 'registered';
      parsed.values['zotero-link'] = `zotero://select/${library === 'users/0' ? 'library' : library}/items/${matched.key}`;
      return '---\n' + stringifyYaml(parsed.values) + '---\n' + text.slice(parsed.end);
    });
    return path;
  }
  async importedPapers(folder: string | string[]): Promise<ImportedPapers> {
    const index = new ImportedPapers();
    const roots = Array.isArray(folder) ? folder : [folder];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      // Managed notes remain identifiable even after a manual move outside the destination.
      if (!roots.some(root => inFolder(file.path, root)) && !cached?.zpi) continue;
      if (cached && !cached.zpi && !cached['zotero-key'] && !['DOI','doi','arxiv','arxiv-id','arxivId','url','URL'].some(key => cached[key])) continue;
      const text = await this.app.vault.cachedRead(file);
      try { index.add(frontmatter(text).values, text, file.path); } catch { /* unrelated or broken note */ }
    }
    return index;
  }
  async records(): Promise<StoredNote[]> {
    const result: StoredNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      // A missing cache can occur immediately after creating a note.
      if (fm && !fm.zpi) continue;
      const text = await this.app.vault.cachedRead(file);
      if (!text.startsWith('---') || !text.includes('\nzpi:')) continue;
      try { const record = readRecord(frontmatter(text).values); if (record) result.push({ path: file.path, text, record }); } catch { /* unrelated or broken note */ }
    }
    return result;
  }
  async exists(path: string): Promise<boolean> { return await this.app.vault.adapter.exists(path); }
  async children(folder: string): Promise<string[]> {
    const f = this.app.vault.getAbstractFileByPath(folder);
    return f instanceof TFolder ? f.children.map(x => x.name) : [];
  }
  async mkdir(path: string): Promise<void> {
    let current = '';
    for (const part of path.split('/')) {
      current = current ? current + '/' + part : part;
      const entry = this.app.vault.getAbstractFileByPath(current);
      if (entry && !(entry instanceof TFolder)) throw new Error('指定したフォルダ名と同名のファイルがあります。別の保存先を指定してください。');
      if (!entry) await this.app.vault.createFolder(current);
    }
  }
  async reserveFolder(path: string): Promise<void> { await this.app.vault.createFolder(path); }
  async createText(path: string, text: string): Promise<void> { await this.app.vault.create(path, text); }
  async createBinary(path: string, bytes: Uint8Array): Promise<void> { await this.app.vault.createBinary(path, Uint8Array.from(bytes).buffer); }
  async readBinary(path: string): Promise<Uint8Array> { return new Uint8Array(await this.app.vault.adapter.readBinary(path)); }
  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('保管庫でPDFが見つかりません。ファイル一覧を確認してください。');
    await this.app.vault.modifyBinary(file, Uint8Array.from(bytes).buffer);
  }
  async removeCreated(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.fileManager.trashFile(file);
  }
  async updateNote(note: StoredNote, record: RecordData, generated: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) throw new Error('更新中にノートが移動または削除されたため停止しました。');
    await this.app.vault.process(file, text => {
      if (text !== note.text) throw new Error('更新中にノートが変更されたため、編集内容を保持して停止しました。');
      const replaced = replaceGenerated(text, generated);
      const { values, end } = frontmatter(replaced);
      values.zpi = record; values['pdf-status'] = record.pdfStatus; values.citekey = record.naming.name;
      return '---\n' + stringifyYaml(values) + '---\n' + replaced.slice(end);
    });
  }
  async backup(note: StoredNote, pdfs: { filename: string; bytes: Uint8Array }[]): Promise<void> {
    const base = normalizePath(`${this.app.vault.configDir}/plugins/${this.pluginId}/backups/${Date.now()}-${note.record.key}`);
    await this.app.vault.adapter.mkdir(base);
    await this.app.vault.adapter.write(`${base}/note.md`, note.text);
    for (const p of pdfs) await this.app.vault.adapter.writeBinary(`${base}/${p.filename}`, Uint8Array.from(p.bytes).buffer);
  }
}
