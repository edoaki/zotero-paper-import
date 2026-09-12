import { Plugin, Notice, Modal, Setting, TFile, TFolder } from 'obsidian';
import { DEFAULT_SETTINGS, authorYear, safeName, validateFolder, generatedBounds, type Settings, type Paper, type NameResult, type ZoteroItem } from './core';
import { ZoteroClient } from './zotero';
import { Importer, type PDFInput, type StoredNote } from './importer';
import { VaultStorage } from './storage';
import { nameWithAI } from './ai';
import { ImportSettingsTab } from './settings';
import { PaperPicker, chooseAttachments, confirmChoice, requestName, Progress } from './ui';

export default class ZoteroPaperImport extends Plugin {
  declare settings: Settings;
  store!: VaultStorage;
  importer!: Importer;
  busy = false;
  private activeProgress?: Progress;
  async onload(): Promise<void> {
    const data = await this.loadData();
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data || {}), ...this.app.loadLocalStorage(this.manifest.id + ':device') };
    this.store = new VaultStorage(this.app, this.manifest.id);
    this.importer = new Importer(this.store);
    this.addSettingTab(new ImportSettingsTab(this.app, this));
    this.addRibbonIcon('download', 'Zotero Paper Import', () => { void this.openPicker(); });
    this.addCommand({ id: 'import-paper', name: 'Import paper from Zotero / Zoteroから論文を取り込む', callback: () => { void this.openPicker(); } });
    this.addCommand({ id: 'refresh-paper', name: 'Refresh this paper / この論文の情報・PDFを更新', callback: () => { void this.refreshActive(false); } });
    this.addCommand({ id: 'rename-paper', name: 'Apply naming settings to this paper / この論文を現在の命名設定で改名', callback: () => { void this.refreshActive(true); } });
    this.addCommand({ id: 'setup', name: 'Connect to Zotero / Zoteroとの接続を設定', callback: () => this.showSetup() });
  }
  onunload(): void { this.activeProgress?.controller.abort(); this.activeProgress?.finish(); }
  client(): ZoteroClient { return new ZoteroClient(this.settings.port); }
  async saveSettings(): Promise<void> {
    const { cliPath, port, ...shared } = this.settings;
    this.app.saveLocalStorage(this.manifest.id + ':device', { cliPath, port });
    await this.saveData(shared);
  }
  openSettings(): void {
    // Settings navigation is not exposed in the public type declarations.
    const settings = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    settings.open(); settings.openTabById(this.manifest.id);
  }
  showSetup(initial = ''): void {
    const plugin = this;
    class Setup extends Modal {
      private timer?: ReturnType<typeof setInterval>;
      private checking = false;
      onOpen(): void {
        this.setTitle('Connect to Zotero / Zoteroとの接続');
        this.contentEl.createEl('p', { text: '1. Open Zotero 10 or newer on this computer. / この端末でZotero 10以降を起動してください。' });
        this.contentEl.createEl('p', { text: '2. Zotero → Settings → Advanced → Allow other applications on this computer to communicate with Zotero. / Zoteroの設定 → 詳細で「このコンピューター上の他のアプリケーションにZoteroとの通信を許可する」を有効にしてください。' });
        const status = this.contentEl.createEl('p', { text: initial || 'Checking… / 接続確認中…', cls: 'zpi-status' });
        const check = async () => {
          if (this.checking) return; this.checking = true;
          try { await plugin.client().probe(); status.setText('✓ Connected; paper list available / 接続できました。文献を取得できます。'); clearInterval(this.timer); }
          catch (e) { status.setText((e as Error).message); } finally { this.checking = false; }
        };
        new Setting(this.contentEl).addButton(b => b.setButtonText('Open Zotero / Zoteroを開く').onClick(() => { window.open('zotero://select/library'); })).addButton(b => b.setButtonText('Retry / 再確認').onClick(() => { void check(); }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('Choose destination / 保存先を設定').setCta().onClick(() => { this.close(); plugin.openSettings(); }));
        this.timer = setInterval(() => { void check(); }, 4000); void check();
      }
      onClose(): void { clearInterval(this.timer); this.contentEl.empty(); }
    }
    new Setup(this.app).open();
  }
  async openPicker(): Promise<void> {
    if (this.busy) { new Notice('An import is already running / 取り込み中です'); return; }
    try { validateFolder(this.settings.folder); } catch { this.openSettings(); new Notice('Choose a destination folder first / 最初に保存先を指定してください'); return; }
    const client = this.client();
    try { await client.probe(); }
    catch (e) { this.showSetup((e as Error).message); return; }
    new PaperPicker(this.app, client, paper => { void this.importPaper(client, paper); }).open();
  }
  private async collectPDFs(client: ZoteroClient, paper: Paper, progress: Progress, tracked?: StoredNote): Promise<{ pdfs: PDFInput[]; reason: string } | null> {
    progress.update('Reading PDF attachments… / PDF添付を確認中…');
    const signal = progress.controller.signal;
    const attachments = await client.attachments(paper, signal);
    let selected: ZoteroItem[] | null;
    if (tracked?.record.attachments.length) {
      selected = tracked.record.attachments.map(a => attachments.find(i => i.key === a.key)).filter((x): x is ZoteroItem => !!x);
      if (selected.length !== tracked.record.attachments.length) throw new Error('A tracked PDF is no longer attached in Zotero. Existing files were kept. / 取り込み済みPDFの添付がZoteroで見つかりません。既存ファイルを保持して停止しました。');
    } else selected = attachments.length > 1 ? await chooseAttachments(this.app, attachments) : attachments;
    if (selected === null || signal.aborted) return null;
    const pdfs: PDFInput[] = [], errors: string[] = [];
    for (const a of selected) {
      progress.update(`Reading PDF ${pdfs.length + 1}/${selected.length}… / PDFを取得中…`);
      try { pdfs.push({ key: a.key, bytes: await client.pdf(paper, a.key, signal) }); }
      catch (e) { if (signal.aborted) return null; errors.push(String(a.data.title || a.key) + ': ' + (e as Error).message); }
    }
    if (errors.length || !pdfs.length) {
      if (tracked?.record.attachments.length) throw new Error(errors.join('\n') || 'PDF unavailable. Existing files kept.');
      const reason = errors.join('\n') || 'No PDF attachment in Zotero / ZoteroにPDF添付がありません';
      const accepted = await confirmChoice(this.app, 'PDF unavailable / PDF未取得', reason + '\n\nSave the note without PDFs? Retry Refresh after downloading in Zotero. / PDFなしでノートを保存しますか？Zoteroで取得後に更新できます。', 'Save note only / ノートだけ保存');
      // Never label a supplement as the main PDF when the selected primary failed.
      return accepted ? { pdfs: [], reason } : null;
    }
    return { pdfs, reason: '' };
  }
  private async naming(paper: Paper, pdfs: PDFInput[], progress: Progress): Promise<NameResult | null> {
    const fallback: NameResult = { name: authorYear(paper.item), mode: 'author-year', reason: 'First author surname + publication year / 第一著者の姓＋出版年' };
    if (this.settings.naming === 'author-year') return fallback;
    progress.update('AI is checking the paper name… / AIが論文の命名根拠を確認中…');
    let reason = '';
    try {
      const result = await nameWithAI(paper, this.settings, pdfs[0]?.bytes, progress.controller.signal);
      if (result) return result;
      reason = 'No supported name found in the supplied paper / 確認できる手法名が見つかりませんでした';
    } catch (e) { if (progress.controller.signal.aborted) return null; reason = (e as Error).message; }
    if (this.settings.fallback === 'ask') {
      const name = await requestName(this.app, fallback.name);
      return name ? { name: safeName(name), mode: this.settings.naming, reason: 'Manual name after AI fallback / AI命名できなかったため手入力。\n' + reason } : null;
    }
    new Notice('Using author + year / 著者名＋年で保存します。\n' + reason, 12000);
    return { ...fallback, reason: fallback.reason + '\n\nAI fallback / AI代替理由: ' + reason };
  }
  async importPaper(client: ZoteroClient, paper: Paper): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const progress = new Progress(this.app); this.activeProgress = progress; progress.open();
    try {
      const existing = await this.importer.find(paper);
      if (existing) { await this.openNote(existing.path); new Notice('Existing paper opened / 登録済みノートを開きました'); return; }
      const result = await this.collectPDFs(client, paper, progress);
      if (!result || progress.controller.signal.aborted) return;
      const name = await this.naming(paper, result.pdfs, progress);
      if (!name || progress.controller.signal.aborted) return;
      progress.update('Saving and verifying… / 保存・検証中…');
      progress.commit();
      const imported = await this.importer.import(paper, this.settings, name, result.pdfs, result.reason);
      await this.openNote(imported.path);
      new Notice(`Imported / 取り込み完了: ${name.name}${result.pdfs.length ? '' : ' (PDF未取得)'}`);
    } catch (e) { if (!progress.controller.signal.aborted) this.showError(e); }
    finally { progress.finish(); this.activeProgress = undefined; this.busy = false; }
  }
  async refreshActive(rename: boolean): Promise<void> {
    if (this.busy) return;
    const file = this.app.workspace.getActiveFile();
    const note = (await this.store.records()).find(n => n.path === file?.path);
    if (!note) { new Notice('Open a note created by Zotero Paper Import / このプラグインで取り込んだノートを開いてください'); return; }
    this.busy = true; const progress = new Progress(this.app); this.activeProgress = progress; progress.open();
    try {
      generatedBounds(note.text);
      const client = this.client(); await client.probe(progress.controller.signal);
      if (client.serverId !== note.record.serverId) throw new Error('This note belongs to another Zotero database / このノートは別のZoteroデータベースから取り込まれています');
      const paper = await client.paper(note.record.key, note.record.library, progress.controller.signal);
      const result = await this.collectPDFs(client, paper, progress, note);
      if (!result || progress.controller.signal.aborted) return;
      let name: NameResult | undefined;
      if (rename) {
        const proposed = await this.naming(paper, result.pdfs, progress);
        if (!proposed || progress.controller.signal.aborted) return;
        name = proposed;
        progress.commit();
        await this.renamePaperFolder(note, name.name);
        // Obsidian may update links when moving; read that result as the update baseline.
        const refreshed = (await this.store.records()).find(n => n.record.key === note.record.key && n.record.serverId === note.record.serverId && n.record.library === note.record.library);
        if (!refreshed) throw new Error('Moved note not found');
        Object.assign(note, refreshed);
      }
      progress.update('Refreshing… / 更新中…');
      progress.commit();
      await this.importer.update(note, paper, this.settings, result.pdfs, name);
      await this.openNote(note.path); new Notice('Paper refreshed; your notes were preserved / 更新しました。自分のメモは保持されています。');
    } catch (e) { if (!progress.controller.signal.aborted) this.showError(e); }
    finally { progress.finish(); this.activeProgress = undefined; this.busy = false; }
  }
  private async renamePaperFolder(note: StoredNote, name: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile) || !file.parent?.parent) throw new Error('Paper folder not found');
    const folder = file.parent;
    if (folder.children.filter(f => f instanceof TFile && f.extension === 'md').length !== 1) throw new Error('Folder contains multiple notes; rename manually / 複数ノートがあるため手動で改名してください');
    const safe = safeName(name); const destination = `${folder.parent!.path}/${safe}`.replace(/^\//, '');
    if (folder.path !== destination && folder.parent!.children.some(f => f !== folder && f.name.toLocaleLowerCase() === safe.toLocaleLowerCase())) throw new Error('The proposed folder name already exists / 同名のフォルダが存在します');
    await this.store.backup(note, []);
    if (folder.path !== destination) await this.app.fileManager.renameFile(folder, destination);
    if (file.basename !== safe) await this.app.fileManager.renameFile(file, `${destination}/${safe}.md`);
  }
  private async openNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }
  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(message, 15000);
    // No raw CLI output, prompts, credentials, or attachment paths are logged.
  }
}
