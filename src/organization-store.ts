import { App, TFile, TFolder, stringifyYaml } from 'obsidian';
import { sha256, MAX_PDF_BYTES } from './zotero';
import { VaultStorage, frontmatter } from './storage';
import { validateFolder } from './core';
import type { Category, OrganizationIO, OrganizationRecord, OrganizePaper, OrganizePaths, PaperSnapshot } from './organization';
import type { Problem } from './problems';

export class OrganizationStore implements OrganizationIO {
  private path: string;
  private journalText: string | null = null;
  constructor(private app: App, private store: VaultStorage, pluginId: string) {
    this.path = `${app.vault.configDir}/plugins/${pluginId}/organization-history.json`;
  }
  async load(): Promise<OrganizationRecord[]> {
    if (!await this.app.vault.adapter.exists(this.path)) return [];
    this.journalText = await this.app.vault.adapter.read(this.path);
    const records = JSON.parse(this.journalText);
    if (!Array.isArray(records)) throw new Error('整理履歴の形式が不正です。既存ファイルを保持しました。');
    for (const r of records) {
      if (!r || typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.reason !== 'string' || typeof r.noteName !== 'string' || !r.noteName.endsWith('.md') || /[/\\]/.test(r.noteName) || !['prepared','done','restoring','undone','failed','unchanged','superseded'].includes(r.state)) throw new Error('整理履歴に不正な情報があります。ファイルを保持しました。');
      validateFolder(r.from); validateFolder(r.to); validateFolder(r.noteName);
      if (r.newCategory && (validateFolder(r.newCategory.path) !== r.to.slice(0, r.to.lastIndexOf('/')) || typeof r.newCategory.description !== 'string')) throw new Error('整理履歴の分類先が不正です。');
    }
    return records;
  }
  async persist(records: OrganizationRecord[]): Promise<void> {
    // Keep the previous journal before replacing it, including cross-device synchronized copies.
    const current = await this.app.vault.adapter.exists(this.path) ? await this.app.vault.adapter.read(this.path) : null;
    if (current !== this.journalText) throw new Error('別の端末などで整理履歴が変更されました。プラグインを読み込み直してください。');
    if (current !== null) await this.app.vault.adapter.write(this.path + '.bak', current);
    const text = JSON.stringify(records, null, 2);
    await this.app.vault.adapter.write(this.path, text); this.journalText = text;
  }
  private metadata(text: string): Record<string, unknown> {
    if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
    return frontmatter(text).values;
  }
  private note(folder: TFolder): TFile | undefined {
    const notes = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'md' && f.name !== '分類.md');
    // Multiple Markdown files can represent multiple papers; keep those folders untouched.
    if (notes.length !== 1) return undefined;
    const note = notes[0];
    const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
    if (fm?.['zotero-key'] || fm?.zpi || folder.children.some(f => f instanceof TFile && f.extension === 'pdf')) return note;
    return undefined;
  }
  async candidates(paths: OrganizePaths): Promise<OrganizePaper[]> {
    return (await this.scan(paths)).papers;
  }
  async scan(paths: OrganizePaths): Promise<{ papers: OrganizePaper[]; skipped: Problem[] }> {
    const inbox = this.app.vault.getAbstractFileByPath(paths.inbox);
    if (!inbox) return { papers: [], skipped: [{ path: paths.inbox, reason: '未整理フォルダはまだありません。', action: '論文を取り込むと自動で作成されます。' }] };
    if (!(inbox instanceof TFolder)) throw new Error('未整理の場所にはフォルダを指定してください。');
    const papers: OrganizePaper[] = [];
    const skipped: Problem[] = [];
    for (const folder of inbox.children) {
      if (!(folder instanceof TFolder)) {
        if (folder.name !== '分類.md') skipped.push({ path: folder.path, reason: '論文フォルダの外に置かれています。', action: '論文ごとのフォルダを作り、ノートとPDFを中へまとめてください。' });
        continue;
      }
      const file = this.note(folder);
      if (!file) {
        const count = folder.children.filter(f => f instanceof TFile && f.extension === 'md' && f.name !== '分類.md').length;
        skipped.push({ path: folder.path, reason: count > 1 ? 'ノートが複数あり、論文を1件に特定できません。' : count === 0 ? '論文ノートがありません。' : 'PDFもZoteroの識別情報も見つかりません。', action: '1つの論文フォルダにノート1枚とPDFをまとめるか、ノートのZoteroキーを確認してください。' }); continue;
      }
      const text = await this.app.vault.cachedRead(file);
      let fm: Record<string, unknown>;
      try { fm = this.metadata(text); } catch { skipped.push({ path: file.path, reason: 'ノートのプロパティを読み取れません。', action: 'ノート先頭のプロパティの形式を確認してから、一覧を更新してください。' }); continue; }
      if (fm.routing === 'manual') { skipped.push({ path: file.path, reason: '手動で分類先を固定した論文です。', action: '整理結果から分類先を変更するか、Obsidianのファイル一覧で移動してください。' }); continue; }
      const title = typeof fm.title === 'string' ? fm.title : text.match(/^# (.+)$/m)?.[1] || folder.name;
      papers.push({ folder: folder.path, notePath: file.path, title, created: file.stat.ctime });
    }
    return { papers: papers.sort((a, b) => a.title.localeCompare(b.title, 'ja')), skipped };
  }
  async locate(recordId: string): Promise<OrganizePaper> {
    const matches = this.app.vault.getMarkdownFiles().filter(f => this.app.metadataCache.getFileCache(f)?.frontmatter?.['zpi-organization'] === recordId);
    if (matches.length !== 1) throw new Error(matches.length ? '同じ整理IDのノートが複数あります。同期による重複を確認してください。' : '整理後に論文が変更・削除されたか、さらに分類先を変更済みです。一覧を更新してください。');
    const file = matches[0]; if (!file.parent) throw new Error('論文フォルダがありません。');
    return { folder: file.parent.path, notePath: file.path, title: String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title || file.basename), created: file.stat.ctime };
  }
  async categories(paths: OrganizePaths): Promise<Category[]> {
    const root = this.app.vault.getAbstractFileByPath(paths.root);
    if (!(root instanceof TFolder)) throw new Error('分類先の親フォルダがありません。設定で選択してください。');
    const result: Category[] = [];
    const visit = async (parent: TFolder, depth: number) => {
      if (depth > 4) return;
      for (const folder of parent.children) {
        if (!(folder instanceof TFolder) || folder.path === paths.inbox || folder.path.startsWith(paths.inbox + '/') || folder.name.startsWith('.') || this.note(folder)) continue;
        if (folder.children.some(f => f instanceof TFile && f.extension === 'md' && f.name !== '分類.md' && (this.app.metadataCache.getFileCache(f)?.frontmatter?.citekey || this.app.metadataCache.getFileCache(f)?.frontmatter?.['pdf-status']))) continue;
        if (result.length >= 200) throw new Error('分類先が多すぎます。設定で分類先の親フォルダを絞り込んでください。');
        const guide = folder.children.find((f): f is TFile => f instanceof TFile && f.name === '分類.md');
        if (!paths.inbox.startsWith(folder.path + '/')) result.push({ path: folder.path.slice(paths.root.length + 1), description: guide ? (await this.app.vault.cachedRead(guide)).slice(0, 10000) : '' });
        await visit(folder, depth + 1);
      }
    };
    await visit(root, 1); return result;
  }
  async readPaper(paper: OrganizePaper): Promise<PaperSnapshot> {
    const folder = this.app.vault.getAbstractFileByPath(paper.folder), file = this.app.vault.getAbstractFileByPath(paper.notePath);
    if (!(folder instanceof TFolder) || !(file instanceof TFile) || file.parent !== folder || (paper.created && file.stat.ctime !== paper.created) || this.note(folder) !== file) throw new Error('選択した論文が移動・変更されたか、複数のノートがあります。現在の配置を保持して停止しました。');
    const text = await this.app.vault.read(file), fm = this.metadata(text);
    const files: string[] = [];
    const collect = (f: TFolder) => { for (const child of f.children) { if (child instanceof TFolder) collect(child); else if (child instanceof TFile) files.push(`${child.path.slice(folder.path.length)}:${child.stat.mtime}:${child.stat.size}`); } };
    collect(folder);
    return { ...paper, text, routing: fm.routing, marker: fm['zpi-organization'], fingerprint: sha256(Buffer.from(text + JSON.stringify(files.sort()))) };
  }
  async pdf(paper: OrganizePaper): Promise<Uint8Array | undefined> {
    const folder = this.app.vault.getAbstractFileByPath(paper.folder);
    if (!(folder instanceof TFolder)) return;
    const pdfs = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === 'pdf');
    const file = pdfs.find(f => f.name === '本文.pdf') || (pdfs.length === 1 ? pdfs[0] : undefined);
    if (!file) return;
    if (file.stat.size > MAX_PDF_BYTES) throw new Error('PDFが大きすぎるため本文を確認できません。128 MiB以下のPDFに対応しています。');
    return new Uint8Array(await this.app.vault.readBinary(file));
  }
  async inspect(path: string): Promise<'folder' | 'file' | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file) return file instanceof TFolder ? 'folder' : 'file';
    // The adapter may see newly synchronized files before the application index does.
    return await this.app.vault.adapter.exists(path) ? 'file' : null;
  }
  async createCategory(path: string, description: string): Promise<void> {
    await this.app.vault.createFolder(path);
    await this.app.vault.create(`${path}/分類.md`, description);
  }
  async cleanupCategory(category: { path: string; description: string }): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(category.path);
    if (!(folder instanceof TFolder)) return;
    const disk = await this.app.vault.adapter.list(category.path);
    if (disk.folders.length || disk.files.some(path => path !== `${category.path}/分類.md`)) return;
    if (folder.children.length === 1) {
      const guide = folder.children[0];
      if (!(guide instanceof TFile) || guide.name !== '分類.md' || await this.app.vault.read(guide) !== category.description) return;
    } else if (folder.children.length) return;
    await this.app.fileManager.trashFile(folder);
  }
  private async change(paper: PaperSnapshot, apply: (fm: Record<string, unknown>) => void): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(paper.notePath);
    if (!(file instanceof TFile)) throw new Error('論文ノートが移動しました。');
    await this.app.vault.process(file, text => {
      if (text !== paper.text) throw new Error('論文ノートが編集中に変更されたため停止しました。');
      const has = /^---\r?\n/.test(text), parsed = has ? frontmatter(text) : { values: {}, end: 0 };
      apply(parsed.values);
      return '---\n' + stringifyYaml(parsed.values) + '---\n' + text.slice(parsed.end);
    });
  }
  async mark(paper: PaperSnapshot, record: OrganizationRecord): Promise<void> {
    if ((await this.readPaper(paper)).fingerprint !== paper.fingerprint) throw new Error('移動直前に論文の内容が変わりました。再試行してください。');
    await this.change(paper, fm => { fm.routing = record.manual ? 'manual' : 'classified'; fm['zpi-organization'] = record.id; });
  }
  async restoreMetadata(paper: PaperSnapshot, record: OrganizationRecord): Promise<void> {
    await this.change(paper, fm => {
      if (fm['zpi-organization'] !== record.id || fm.routing !== (record.manual ? 'manual' : 'classified')) throw new Error('分類情報が変更されているため、処理前の状態に戻せません。');
      if (record.previousRouting === undefined) delete fm.routing; else fm.routing = record.previousRouting;
      if (record.previousMarker === undefined) delete fm['zpi-organization']; else fm['zpi-organization'] = record.previousMarker;
    });
  }
  async move(from: string, to: string): Promise<void> {
    if ((this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig('alwaysUpdateLinks') !== true) throw new Error('リンクを保ったまま移動するため、Obsidianの設定 → ファイルとリンク →「内部リンクを常に更新」をオンにしてください。');
    const folder = this.app.vault.getAbstractFileByPath(from);
    if (!(folder instanceof TFolder) || await this.inspect(to)) throw new Error('移動元が変更されたか、移動先が既に使われています。');
    await this.store.mkdir(to.slice(0, to.lastIndexOf('/')));
    await this.app.fileManager.renameFile(folder, to);
  }
}
