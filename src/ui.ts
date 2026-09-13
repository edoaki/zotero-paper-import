import { App, Modal, Setting, FuzzySuggestModal, TFolder, TFile } from 'obsidian';
import { authorsOf, yearOf, type ZoteroItem, type Paper, identity } from './core';
import { ZoteroClient } from './zotero';
import { JOB_LABELS, type SerialQueue, type QueueJob } from './queue';
import { unimportedPage, type ImportedPapers } from './imported';
import { remedy } from './problems';

type QueueView = Pick<SerialQueue<unknown>, 'jobs' | 'subscribe' | 'latest'>;
export function modeTabs(el: HTMLElement, selected: 'import' | 'organize', change: (mode: 'import' | 'organize') => void): void {
  const tabs = el.createDiv({ cls: 'zpi-mode-tabs', attr: { role: 'tablist', 'aria-label': '文献の操作' } });
  for (const [mode, text] of [['import', '取り込み'], ['organize', '整理']] as const) {
    const button = tabs.createEl('button', { text, attr: { role: 'tab', 'aria-selected': String(selected === mode) } });
    button.addEventListener('click', () => { if (selected !== mode) change(mode); });
  }
}

export class FolderPicker extends FuzzySuggestModal<string> {
  constructor(app: App, private done: (path: string) => void) { super(app); this.setPlaceholder('保存先を選択'); }
  getItems(): string[] { return this.app.vault.getAllLoadedFiles().filter((x): x is TFolder => x instanceof TFolder && !!x.path).map(x => x.path); }
  getItemText(item: string): string { return item; }
  onChooseItem(item: string): void { this.done(item); }
}
export class PaperPicker extends Modal {
  private library = 'users/0';
  private query = '';
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private results!: HTMLElement;
  private status!: HTMLElement;
  private generation = 0;
  private closed = false;
  private unsubscribe?: () => void;
  private queueSummary!: HTMLElement;
  private rowStates = new Map<string, { button: HTMLButtonElement; state: HTMLElement }>();
  private hiddenCount = 0;
  private hasMore = false;
  private ready = false;
  private exclusions!: HTMLDetailsElement;
  constructor(app: App, private client: ZoteroClient, private queue: QueueView, private done: (paper: Paper) => void, private openQueue: () => void, private imported: () => Promise<ImportedPapers>, private organize: () => void, private setup: () => void) { super(app); }
  async onOpen(): Promise<void> {
    this.closed = false;
    this.setTitle('Zoteroから取り込む');
    this.modalEl.addClass('zpi-modal');
    this.contentEl.addClass('zpi-picker');
    modeTabs(this.contentEl, 'import', () => this.organize());
    let librarySelect!: HTMLSelectElement;
    new Setting(this.contentEl).setName('ライブラリ').addDropdown(drop => {
      drop.addOption('users/0', 'マイライブラリ').onChange(v => { this.library = v; void this.search(); });
      librarySelect = drop.selectEl;
    });
    new Setting(this.contentEl).setName('検索').addSearch(search => {
      search.setPlaceholder('タイトル・著者・年').onChange(v => {
        this.query = v; clearTimeout(this.timer); this.timer = setTimeout(() => { void this.search(); }, 250);
      });
      search.inputEl.setAttribute('aria-label', 'Zoteroの論文を検索');
      setTimeout(() => search.inputEl.focus(), 50);
    });
    this.queueSummary = this.contentEl.createDiv({ cls: 'zpi-queue-summary' });
    new Setting(this.contentEl).setDesc('論文を続けて選べます。画面を閉じても順番に処理します。').addButton(b => b.setButtonText('取り込み状況を見る').onClick(this.openQueue));
    this.unsubscribe = this.queue.subscribe(() => this.updateQueue());
    this.updateQueue();
    this.status = this.contentEl.createEl('p', { cls: 'zpi-status' });
    this.results = this.contentEl.createDiv({ cls: 'zpi-results' });
    this.exclusions = this.contentEl.createEl('details', { cls: 'zpi-exclusions' });
    this.status.setText('Zoteroに接続中…'); this.controller = new AbortController();
    try {
      await this.client.probe(this.controller.signal);
      const libs = await this.client.libraries();
      if (this.closed) return;
      librarySelect.replaceChildren();
      for (const l of new Map(libs.map(l => [l.path, l])).values()) librarySelect.createEl('option', { text: l.name, value: l.path });
      librarySelect.value = this.library; this.ready = true;
      await this.search();
    } catch (e) {
      if (this.closed) return;
      this.status.setText((e as Error).message + '\n「整理」タブはZoteroが起動していなくても使えます。');
      new Setting(this.results).addButton(b => b.setButtonText('接続方法を見る').onClick(this.setup));
    }
  }
  private async search(): Promise<void> {
    if (!this.ready || this.closed) return;
    this.controller?.abort(); this.controller = new AbortController();
    const signal = this.controller.signal, generation = ++this.generation;
    this.status.setText('検索中…');
    this.results.empty(); this.rowStates.clear();
    try {
      const index = await this.imported();
      if (generation !== this.generation || signal.aborted) return;
      const page = await unimportedPage(
        start => this.client.searchPage(this.query, this.library, start, signal),
        item => index.has({ item, library: this.library, serverId: this.client.serverId }), signal);
      if (generation !== this.generation || signal.aborted) return;
      const items = page.items;
      this.hiddenCount = page.hidden; this.hasMore = page.hasMore;
      this.exclusions.empty(); this.exclusions.createEl('summary', { text: `取り込み済みで非表示の論文と理由（${page.hidden}件）` });
      for (const item of page.hiddenItems) {
        const match = index.match({ item, library: this.library, serverId: this.client.serverId });
        const card = this.exclusions.createDiv({ cls: 'zpi-job' }); card.createEl('strong', { text: item.data.title || item.key }); card.createEl('p', { text: match?.reason || '取り込み済み', cls: 'zpi-meta' });
        if (match?.path) new Setting(card).setDesc(match.path).addButton(b => b.setButtonText('既存ノートを開く').onClick(() => { const file = this.app.vault.getAbstractFileByPath(match.path!); if (file instanceof TFile) { this.close(); void this.app.workspace.getLeaf(false).openFile(file); } }));
      }
      const rows: { paper: Paper; state: HTMLElement }[] = [];
      for (const item of items) {
        const paper: Paper = { item, library: this.library, serverId: this.client.serverId };
        const button = this.results.createEl('button', { cls: 'zpi-paper' });
        button.createEl('strong', { text: item.data.title || 'タイトル未設定' });
        button.createEl('span', { text: `${authorsOf(item)} · ${yearOf(item)}`, cls: 'zpi-meta' });
        const state = button.createEl('span', { text: 'PDF確認中…', cls: 'zpi-meta' });
        const importedState = button.createEl('span', { cls: 'zpi-import-state' });
        this.rowStates.set('import:' + identity(paper), { button, state: importedState });
        button.addEventListener('click', () => { this.done(paper); this.updateQueue(); });
        rows.push({ paper, state });
      }
      this.updateQueue();
      // Limit simultaneous requests to avoid overwhelming a large Zotero library.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (cursor < rows.length && !signal.aborted) {
          const row = rows[cursor++];
          try {
            const pdfs = await this.client.attachments(row.paper, signal);
            if (!signal.aborted) row.state.setText(pdfs.length ? `PDF添付：${pdfs.length}件（ダウンロード済みかは取り込み時に確認します）` : 'PDF添付なし');
          } catch { if (!signal.aborted) row.state.setText('PDF状態未確認'); }
        }
      }));
    } catch (e) { if (!signal.aborted) this.status.setText((e as Error).message); }
  }
  private updateQueue(): void {
    const running = this.queue.jobs.find(j => j.state === 'running');
    const count = this.queue.jobs.filter(j => j.state === 'queued').length;
    this.queueSummary.setText(running ? `処理中：${running.title} — ${running.progress}　／　待機中：${count}件` : count ? `待機中：${count}件` : '論文を選ぶと待ち行列に追加されます');
    for (const [key, row] of this.rowStates) {
      const job = this.queue.latest(key);
      if (job?.state === 'completed' && job.path && this.app.vault.getAbstractFileByPath(job.path)) {
        const card = this.exclusions.createDiv({ cls: 'zpi-job' });
        card.createEl('strong', { text: row.button.querySelector('strong')?.textContent || job.title });
        card.createEl('p', { text: 'この待ち行列で取り込みを完了しました。', cls: 'zpi-meta' });
        new Setting(card).setDesc(job.path).addButton(b => b.setButtonText('既存ノートを開く').onClick(() => { const file = this.app.vault.getAbstractFileByPath(job.path!); if (file instanceof TFile) { this.close(); void this.app.workspace.getLeaf(false).openFile(file); } }));
        row.button.remove(); this.rowStates.delete(key); this.hiddenCount++; continue;
      }
      row.state.setText(job ? `${JOB_LABELS[job.state]}${job.state === 'running' ? '：' + job.progress : ''}` : 'クリックして取り込む');
      row.state.dataset.state = job?.state || 'new';
      row.button.disabled = !!job && ['queued', 'running', 'needs-input'].includes(job.state);
    }
    if (this.status && this.results) this.status.setText(`未取り込み：${this.rowStates.size}件${this.hasMore ? '（続きは検索で絞り込めます）' : ''}。取り込み済み${this.hiddenCount}件は非表示です。`);
    this.exclusions?.querySelector('summary')?.setText(`取り込み済みで非表示の論文と理由（${this.hiddenCount}件）`);
  }
  onClose(): void { this.closed = true; this.controller?.abort(); clearTimeout(this.timer); this.unsubscribe?.(); this.contentEl.empty(); }
}

export class QueueModal<T> extends Modal {
  private unsubscribe?: () => void;
  constructor(app: App, private queue: SerialQueue<T>, private resolve: (job: QueueJob<T>) => void, private openFile: (path: string) => void, private history?: () => void) { super(app); }
  onOpen(): void {
    this.setTitle('文献の処理状況'); this.modalEl.addClass('zpi-modal');
    this.contentEl.addClass('zpi-queue'); this.unsubscribe = this.queue.subscribe(() => this.render()); this.render();
  }
  private render(): void {
    const scroll = this.contentEl.scrollTop; this.contentEl.empty();
    this.contentEl.createEl('p', { text: '選んだ順番に処理します。この画面を閉じても処理は続きます。' });
    if (this.history) new Setting(this.contentEl).addButton(b => b.setButtonText('整理結果・分類先を変更').onClick(() => { this.close(); this.history!(); }));
    if (!this.queue.jobs.length) this.contentEl.createEl('p', { text: '待ち行列は空です。取り込みコマンドから論文を選んでください。' });
    for (const job of this.queue.jobs) {
      const card = this.contentEl.createDiv({ cls: 'zpi-job' });
      card.createEl('strong', { text: job.title });
      card.createEl('p', { text: `${JOB_LABELS[job.state]}：${job.progress}`, cls: 'zpi-import-state' }).dataset.state = job.state;
      if (job.path) card.createEl('p', { text: job.path, cls: 'zpi-meta' });
      if (job.error) card.createEl('p', { text: job.error, cls: 'zpi-job-error' });
      if (job.error) card.createEl('p', { text: remedy(job.error), cls: 'zpi-meta' });
      const request = job.input as { kind?: string; reason?: string } | undefined;
      if (request?.reason) card.createEl('p', { text: request.reason, cls: 'zpi-meta' });
      const actions = new Setting(card);
      if (job.state === 'completed' && job.path) actions.addButton(b => b.setButtonText('ノートを開く').onClick(() => { this.close(); this.openFile(job.path!); }));
      if (job.state === 'needs-input') actions.addButton(b => b.setButtonText(request?.kind === 'select-pdf' ? 'PDFを選択' : 'ノートだけ保存').setCta().onClick(() => this.resolve(job)));
      if ((job.payload as {kind?:string})?.kind !== 'undo' && ['failed', 'cancelled', 'needs-input'].includes(job.state)) actions.addButton(b => b.setButtonText('再試行').onClick(() => this.queue.retry(job.id)));
      if (['queued', 'running', 'needs-input'].includes(job.state) && !job.committing) actions.addButton(b => b.setButtonText('キャンセル').onClick(() => this.queue.cancel(job.id)));
    }
    new Setting(this.contentEl).addButton(b => b.setButtonText('完了・キャンセル済みを一覧から消す').onClick(() => this.queue.clearFinished()));
    this.contentEl.scrollTop = scroll;
  }
  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }

}
export function chooseAttachments(app: App, items: ZoteroItem[]): Promise<ZoteroItem[] | null> {
  return new Promise(resolve => {
    class AttachmentPicker extends Modal {
      private selected = new Set(items.map(i => i.key));
      private primary = items[0].key;
      private answered = false;
      onOpen(): void {
        this.setTitle('PDFを選択'); this.modalEl.addClass('zpi-modal');
        this.contentEl.createEl('p', { text: '本文と必要な補足資料を選んでください。' });
        new Setting(this.contentEl).setName('本文').addDropdown(d => {
          for (const i of items) d.addOption(i.key, String(i.data.title || i.data.filename || i.key));
          d.onChange(v => { this.primary = v; this.selected.add(v); });
        });
        for (const i of items) new Setting(this.contentEl).setName(String(i.data.title || i.data.filename || i.key)).addToggle(t => t.setValue(true).onChange(on => { on ? this.selected.add(i.key) : this.selected.delete(i.key); }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('取り込む').setCta().onClick(() => {
          const ordered = [...items].sort((a, b) => a.key === this.primary ? -1 : b.key === this.primary ? 1 : 0).filter(i => this.selected.has(i.key));
          if (!ordered.length) return;
          this.answered = true; resolve(ordered); this.close();
        }));
      }
      onClose(): void { if (!this.answered) resolve(null); this.contentEl.empty(); }
    }
    new AttachmentPicker(app).open();
  });
}
export function confirmChoice(app: App, title: string, message: string, accept: string): Promise<boolean> {
  return new Promise(resolve => {
    class Choice extends Modal {
      answered = false;
      onOpen(): void {
        this.setTitle(title); this.contentEl.createEl('p', { text: message });
        new Setting(this.contentEl).addButton(b => b.setButtonText('中止').onClick(() => this.close())).addButton(b => b.setButtonText(accept).setCta().onClick(() => { this.answered = true; resolve(true); this.close(); }));
      }
      onClose(): void { if (!this.answered) resolve(false); this.contentEl.empty(); }
    }
    new Choice(app).open();
  });
}
export function requestName(app: App, suggestion: string): Promise<string | null> {
  return new Promise(resolve => {
    class Name extends Modal {
      value = suggestion; answered = false;
      onOpen(): void {
        this.setTitle('論文フォルダ名');
        new Setting(this.contentEl).setName('名前').addText(t => t.setValue(this.value).onChange(v => { this.value = v; }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('保存').setCta().onClick(() => { if (!this.value.trim()) return; this.answered = true; resolve(this.value); this.close(); }));
      }
      onClose(): void { if (!this.answered) resolve(null); }
    }
    new Name(app).open();
  });
}
export class Progress extends Modal {
  controller = new AbortController(); private status?: HTMLElement; completed = false;
  private committing = false;
  onOpen(): void {
    this.setTitle('Zotero Paper Import');
    this.status = this.contentEl.createEl('p', { text: '準備中…' });
    new Setting(this.contentEl).addButton(b => b.setButtonText('中止').onClick(() => { this.controller.abort(); this.close(); }));
  }
  update(text: string): void { this.status?.setText(text); }
  commit(): void { this.committing = true; for (const b of this.contentEl.querySelectorAll('button')) b.disabled = true; }
  finish(): void { this.completed = true; this.close(); }
  onClose(): void { if (!this.completed && !this.committing) this.controller.abort(); }
}
