import { Plugin, Notice, Modal, Setting, TFile, TFolder } from 'obsidian';
import { DEFAULT_SETTINGS, authorYear, safeName, validateFolder, generatedBounds, identity, migrateAISettings, type Settings, type Paper, type NameResult, type ZoteroItem } from './core';
import { ZoteroClient } from './zotero';
import { Importer, type PDFInput, type StoredNote } from './importer';
import { VaultStorage } from './storage';
import { nameWithAI } from './ai';
import { ImportSettingsTab } from './settings';
import { PaperPicker, chooseAttachments, QueueModal } from './ui';
import { SerialQueue, NeedsInput, JOB_LABELS, type QueueJob, type JobProgress } from './queue';

export interface ImportTask {
  kind: 'import' | 'refresh' | 'rename'; paper: Paper; settings: Settings; selectedPDFKeys?: string[]; noteOnly?: boolean;
}
export interface TaskInput { kind: 'select-pdf' | 'missing-pdf'; attachments?: ZoteroItem[]; reason?: string }

export default class ZoteroPaperImport extends Plugin {
  declare settings: Settings;
  store!: VaultStorage;
  importer!: Importer;
  queue!: SerialQueue<ImportTask>;
  get busy(): boolean { return this.queue?.running || false; }
  private picker?: PaperPicker;
  private queueModal?: QueueModal<ImportTask>;
  private readonly queueStorageKey = 'zotero-paper-import:queue';
  async onload(): Promise<void> {
    // Older versions did not close their picker on unload; retire only our own stale dialogs.
    for (const picker of document.querySelectorAll('.zpi-picker, .zpi-queue')) {
      picker.closest('.modal-container')?.querySelector<HTMLButtonElement>('.modal-close-button')?.click();
    }
    const data = await this.loadData();
    if (data) delete data.fallback;
    const previousDefault = DEFAULT_SETTINGS.template.replace('## 要旨', '## Abstract').replace('## 命名の根拠', '## Naming');
    if (data?.template === previousDefault) data.template = DEFAULT_SETTINGS.template;
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data || {}), ...this.app.loadLocalStorage(this.manifest.id + ':device') };
    const migrated = migrateAISettings(this.settings);
    if (migrated !== this.settings) { this.settings = migrated; await this.saveSettings(); }
    this.store = new VaultStorage(this.app, this.manifest.id);
    this.importer = new Importer(this.store);
    this.queue = new SerialQueue((job, progress) => this.runTask(job, progress));
    const saved = this.app.loadLocalStorage(this.queueStorageKey);
    if (Array.isArray(saved)) this.queue.restore(saved.filter(j => j?.id && j?.key && j?.payload?.paper?.item?.key && j?.payload?.settings && j.state in JOB_LABELS).map(j => ({ ...j, payload: { ...j.payload, settings: migrateAISettings(j.payload.settings) } })));
    const status = this.addStatusBarItem();
    status.addClass('zpi-statusbar'); status.setAttribute('role', 'button'); status.tabIndex = 0;
    const updateQueue = () => {
      const active = this.queue.jobs.filter(j => j.state === 'running').length;
      const waiting = this.queue.jobs.filter(j => j.state === 'queued').length;
      const attention = this.queue.jobs.filter(j => j.state === 'needs-input' || j.state === 'failed').length;
      status.setText(active || waiting || attention ? `文献：処理中 ${active}・待機 ${waiting}${attention ? `・要確認 ${attention}` : ''}` : '文献の取り込み状況');
      this.app.saveLocalStorage(this.queueStorageKey, this.queue.jobs);
    };
    status.addEventListener('click', () => this.openQueue());
    status.addEventListener('keydown', e => { if (e.key === 'Enter') this.openQueue(); });
    this.register(this.queue.subscribe(updateQueue)); updateQueue();
    const settingsTab = new ImportSettingsTab(this.app, this);
    this.addSettingTab(settingsTab);
    this.register(() => settingsTab.hide());
    this.addRibbonIcon('download', 'Zotero Paper Import', () => { void this.openPicker(); });
    this.addCommand({ id: 'import-paper', name: 'Zoteroから論文を取り込む', callback: () => { void this.openPicker(); } });
    this.addCommand({ id: 'refresh-paper', name: 'この論文の情報・PDFを更新', callback: () => { void this.refreshActive(false); } });
    this.addCommand({ id: 'rename-paper', name: 'この論文を現在の命名設定で改名', callback: () => { void this.refreshActive(true); } });
    this.addCommand({ id: 'queue', name: '取り込み状況・待ち行列を開く', callback: () => this.openQueue() });
    this.addCommand({ id: 'setup', name: 'Zoteroとの接続を設定', callback: () => this.showSetup() });
  }
  onunload(): void { this.picker?.close(); this.queueModal?.close(); this.queue?.dispose(); }
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
        this.setTitle('Zoteroとの接続');
        this.contentEl.createEl('p', { text: 'この端末でZotero 10以降を起動してください。' });
        this.contentEl.createEl('p', { text: 'Zoteroの設定 → 詳細で「このコンピューター上の他のアプリケーションにZoteroとの通信を許可する」を有効にしてください。' });
        const status = this.contentEl.createEl('p', { text: initial || '接続確認中…', cls: 'zpi-status' });
        const check = async () => {
          if (this.checking) return; this.checking = true;
          try { await plugin.client().probe(); status.setText('接続できました。文献を取得できます。'); clearInterval(this.timer); }
          catch (e) { status.setText((e as Error).message); } finally { this.checking = false; }
        };
        new Setting(this.contentEl).addButton(b => b.setButtonText('Zoteroを開く').onClick(() => { window.open('zotero://select/library'); })).addButton(b => b.setButtonText('再確認').onClick(() => { void check(); }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('保存先を設定').setCta().onClick(() => { this.close(); plugin.openSettings(); }));
        this.timer = setInterval(() => { void check(); }, 4000); void check();
      }
      onClose(): void { clearInterval(this.timer); this.contentEl.empty(); }
    }
    new Setup(this.app).open();
  }
  async openPicker(): Promise<void> {
    try { validateFolder(this.settings.folder); } catch { this.openSettings(); new Notice('最初に保存先を指定してください'); return; }
    const client = this.client();
    try { await client.probe(); }
    catch (e) { this.showSetup((e as Error).message); return; }
    this.picker?.close();
    this.picker = new PaperPicker(this.app, client, this.queue, paper => this.enqueuePaper(paper), () => this.openQueue(), () => this.store.importedPapers(this.settings.folder));
    this.picker.open();
  }
  private async collectPDFs(client: ZoteroClient, paper: Paper, progress: JobProgress, task: ImportTask, tracked?: StoredNote): Promise<{ pdfs: PDFInput[]; reason: string }> {
    if (task.noteOnly && !tracked?.record.attachments.length) return { pdfs: [], reason: 'PDFを取得できなかったため、利用者がノートのみの保存を選択しました。' };
    progress.update('PDF添付を確認中…');
    const signal = progress.controller.signal;
    const attachments = await client.attachments(paper, signal);
    let selected: ZoteroItem[];
    const keys = tracked?.record.attachments.length ? tracked.record.attachments.map(a => a.key) : task.selectedPDFKeys;
    if (keys?.length) {
      selected = keys.map(key => attachments.find(a => a.key === key)).filter((x): x is ZoteroItem => !!x);
      if (selected.length !== keys.length) throw new Error('選んだPDFがZoteroで見つかりません。既存ファイルを保持して停止しました。');
    } else if (attachments.length > 1) {
      throw new NeedsInput('本文と取り込むPDFを選んでください', { kind: 'select-pdf', attachments } satisfies TaskInput);
    } else selected = attachments;
    const pdfs: PDFInput[] = [];
    for (const a of selected) {
      progress.update(`PDFを取得中… ${pdfs.length + 1}/${selected.length}`);
      try { pdfs.push({ key: a.key, bytes: await client.pdf(paper, a.key, signal) }); }
      catch (e) {
        if (signal.aborted || tracked?.record.attachments.length) throw e;
        throw new NeedsInput('PDFをダウンロードするか、ノートだけ保存してください', { kind: 'missing-pdf', reason: (e as Error).message } satisfies TaskInput);
      }
    }
    if (!pdfs.length) throw new NeedsInput('PDF添付がありません。ノートだけ保存することもできます', { kind: 'missing-pdf', reason: 'ZoteroにPDF添付がありません。' } satisfies TaskInput);
    return { pdfs, reason: '' };
  }
  private async naming(paper: Paper, pdfs: PDFInput[], progress: JobProgress, settings: Settings): Promise<NameResult | null> {
    const fallback: NameResult = { name: authorYear(paper.item), mode: 'author-year', reason: '第一著者の姓＋出版年' };
    if (settings.naming === 'author-year') return fallback;
    progress.update('AIが論文の命名根拠を確認中…');
    let reason = '';
    try {
      const result = await nameWithAI(paper, settings, pdfs[0]?.bytes, progress.controller.signal);
      if (result) return result;
      reason = '確認できる手法名が見つかりませんでした';
    } catch (e) { if (progress.controller.signal.aborted) return null; reason = (e as Error).message; }
    progress.update('AIが命名できなかったため、著者名＋年で保存します');
    return { ...fallback, reason: fallback.reason + '\n\nAIで命名できなかった理由：' + reason };
  }
  enqueuePaper(paper: Paper): void {
    try {
      validateFolder(this.settings.folder);
      this.queue.add('import:' + identity(paper), paper.item.data.title || 'タイトル未設定', { kind: 'import', paper, settings: this.settings });
    } catch (e) { this.showError(e); }
  }
  openQueue(): void {
    this.picker?.close();
    this.queueModal?.close();
    this.queueModal = new QueueModal(this.app, this.queue, job => { void this.resolveTask(job); }, path => { void this.openNote(path); });
    this.queueModal.open();
  }
  private async resolveTask(job: QueueJob<ImportTask>): Promise<void> {
    const request = job.input as TaskInput | undefined;
    if (request?.kind === 'select-pdf' && request.attachments?.length) {
      const selected = await chooseAttachments(this.app, request.attachments);
      if (selected?.length) this.queue.retry(job.id, task => { task.selectedPDFKeys = selected.map(a => a.key); });
    } else if (request?.kind === 'missing-pdf') {
      this.queue.retry(job.id, task => { task.noteOnly = true; });
    }
  }
  async refreshActive(rename: boolean): Promise<void> {
    try {
      const file = this.app.workspace.getActiveFile();
      const note = (await this.store.records()).find(n => n.path === file?.path);
      if (!note) { new Notice('このプラグインで取り込んだノートを開いてください'); return; }
      const paper: Paper = { item: { key: note.record.key, data: { title: file?.basename } }, serverId: note.record.serverId, library: note.record.library };
      const kind = rename ? 'rename' : 'refresh';
      this.queue.add(kind + ':' + identity(paper), `${file?.basename}（${rename ? '改名' : '更新'}）`, { kind, paper, settings: this.settings });
      new Notice('待ち行列に追加しました。ほかのノートを操作できます。');
    } catch (e) { this.showError(e); }
  }
  private async runTask(job: QueueJob<ImportTask>, progress: JobProgress): Promise<string> {
    const task = job.payload, settings = task.settings;
    progress.update('Zoteroに接続中…');
    const client = new ZoteroClient(settings.port); await client.probe(progress.controller.signal);
    if (client.serverId !== task.paper.serverId) throw new Error('選択時とZoteroの接続元が異なります。接続を確認して再試行してください。');
    const paper = await client.paper(task.paper.item.key, task.paper.library, progress.controller.signal);
    let note = await this.importer.find(paper);
    if (task.kind === 'import' && note) return note.path;
    if (task.kind !== 'import' && !note) throw new Error('更新対象のノートが見つかりません。');
    if (note) generatedBounds(note.text);
    const result = await this.collectPDFs(client, paper, progress, task, note);
    if (progress.controller.signal.aborted) throw new Error('キャンセルしました');
    let name: NameResult | undefined;
    if (task.kind === 'import' || task.kind === 'rename') {
      name = await this.naming(paper, result.pdfs, progress, settings) || undefined;
      if (!name || progress.controller.signal.aborted) throw new Error('キャンセルしました');
    }
    progress.update('保存・検証中…'); progress.commit();
    let path: string;
    if (task.kind === 'import') {
      path = (await this.importer.import(paper, settings, name!, result.pdfs, result.reason)).path;
    } else {
      // Personal writing may have changed while the AI was running. Read it again before committing.
      note = await this.importer.find(paper);
      if (!note) throw new Error('更新対象のノートが見つかりません。');
      if (task.kind === 'rename') {
        await this.renamePaperFolder(note, name!.name);
        note = await this.importer.find(paper);
        if (!note) throw new Error('改名後のノートが見つかりません。');
      }
      await this.importer.update(note, paper, settings, result.pdfs, name);
      path = note.path;
    }
    new Notice(`文献の${task.kind === 'import' ? '取り込み' : '更新'}が完了しました：${path}`);
    return path;
  }
  private async renamePaperFolder(note: StoredNote, name: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile) || !file.parent?.parent) throw new Error('論文フォルダが見つかりません。取り込んだ文献ノートを開いてください。');
    const folder = file.parent;
    if (folder.children.filter(f => f instanceof TFile && f.extension === 'md').length !== 1) throw new Error('複数ノートがあるため手動で改名してください');
    const safe = safeName(name); const destination = `${folder.parent!.path}/${safe}`.replace(/^\//, '');
    if (folder.path !== destination && folder.parent!.children.some(f => f !== folder && f.name.toLocaleLowerCase() === safe.toLocaleLowerCase())) throw new Error('同名のフォルダが存在します');
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
