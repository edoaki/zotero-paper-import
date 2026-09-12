import { App, TFile, TFolder, parseYaml, stringifyYaml, normalizePath } from 'obsidian';
import type { Storage, StoredNote } from './importer';
import { readRecord, replaceGenerated, type RecordData } from './core';
import { ImportedPapers, inFolder } from './imported';

export function frontmatter(text: string): { values: Record<string, unknown>; end: number } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) throw new Error('ノートのプロパティがありません');
  const values = parseYaml(m[1]);
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('ノートのプロパティ形式が不正です。');
  return { values, end: m[0].length };
}
export class VaultStorage implements Storage {
  constructor(private app: App, private pluginId: string) {}
  async importedPapers(folder: string): Promise<ImportedPapers> {
    const index = new ImportedPapers();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
      // Managed notes remain identifiable even after a manual move outside the destination.
      if (!inFolder(file.path, folder) && !cached?.zpi) continue;
      if (cached && !cached.zpi && !cached['zotero-key']) continue;
      const text = await this.app.vault.cachedRead(file);
      try { index.add(frontmatter(text).values, text); } catch { /* unrelated or broken note */ }
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
