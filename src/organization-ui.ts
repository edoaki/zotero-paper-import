import { App, Modal, Setting } from 'obsidian';
import type ZoteroPaperImport from './main';
import { modeTabs } from './ui';
import { organizePaths, type OrganizePaper } from './organization';
import { JOB_LABELS } from './queue';

export class OrganizePicker extends Modal {
  private unsubscribe?: () => void;
  private closed = false;
  private generation = 0;
  private query = '';
  private results!: HTMLElement;
  private status!: HTMLElement;
  private papers: OrganizePaper[] = [];
  constructor(app: App, private owner: ZoteroPaperImport) { super(app); }
  onOpen(): void {
    this.setTitle('文献を整理する'); this.modalEl.addClass('zpi-modal'); this.contentEl.addClass('zpi-picker');
    modeTabs(this.contentEl, 'organize', () => { void this.owner.openPicker(); });
    this.contentEl.createEl('p', { text: '論文を押すと、AIが分類してフォルダごと移動します。画面を閉じても、選んだ順に処理を続けます。' });
    new Setting(this.contentEl).setName('検索').addSearch(s => s.setPlaceholder('タイトル・フォルダ名').onChange(v => { this.query = v; this.renderRows(); }));
    new Setting(this.contentEl).addButton(b => b.setButtonText('整理結果・元に戻す').onClick(() => this.owner.openOrganizationHistory())).addButton(b => b.setButtonText('設定').onClick(() => { this.close(); this.owner.openSettings(); }));
    this.status = this.contentEl.createEl('p', { cls: 'zpi-status' });
    this.results = this.contentEl.createDiv({ cls: 'zpi-results' });
    this.unsubscribe = this.owner.queue.subscribe(() => { void this.refresh(); });
    void this.refresh();
  }
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    try {
      if (this.owner.organizationError) throw new Error(this.owner.organizationError);
      const paths = organizePaths(this.owner.settings);
      const papers = await this.owner.organizationStore.candidates(paths);
      if (this.closed || generation !== this.generation) return;
      this.papers = papers;
      this.status.setText(`未整理：${paths.inbox}\n分類先：${paths.root}\n${papers.length}件。ノートとPDFを含む論文フォルダが対象です。`);
      this.renderRows();
    } catch (e) { if (!this.closed) this.status.setText((e as Error).message); }
  }
  private renderRows(): void {
    const scroll = this.results.scrollTop; this.results.empty();
    const papers = this.papers.filter(p => `${p.title} ${p.folder}`.toLocaleLowerCase().includes(this.query.toLocaleLowerCase()));
    if (!papers.length) this.results.createEl('p', { text: '整理できる論文がありません。未整理フォルダの場所は「設定」で変更できます。' });
    for (const paper of papers) {
      const job = this.owner.queue.latest('organize:' + paper.folder);
      const button = this.results.createEl('button', { cls: 'zpi-paper' });
      button.createEl('strong', { text: paper.title });
      button.createEl('span', { text: paper.folder, cls: 'zpi-meta' });
      button.createEl('span', { text: job && ['queued','running','failed','cancelled'].includes(job.state) ? `${JOB_LABELS[job.state]}：${job.error || job.progress}` : 'クリックして整理する', cls: 'zpi-import-state' });
      button.disabled = !!job && ['queued','running'].includes(job.state);
      button.addEventListener('click', () => this.owner.enqueueOrganization(paper));
    }
    this.results.scrollTop = scroll;
  }
  onClose(): void { this.closed = true; this.unsubscribe?.(); this.contentEl.empty(); }
}

export class OrganizationHistoryModal extends Modal {
  private unsubscribe?: () => void;
  constructor(app: App, private owner: ZoteroPaperImport) { super(app); }
  onOpen(): void {
    this.setTitle('整理結果・元に戻す'); this.modalEl.addClass('zpi-modal'); this.contentEl.addClass('zpi-queue');
    this.unsubscribe = this.owner.queue.subscribe(() => this.render()); this.render();
  }
  private render(): void {
    const scroll = this.contentEl.scrollTop; this.contentEl.empty();
    this.contentEl.createEl('p', { text: '元に戻すと論文フォルダを元の場所へ移動します。整理後に書き足したメモも保持します。' });
    const records = this.owner.organizer.records;
    if (this.owner.organizationError) this.contentEl.createEl('p', { text: this.owner.organizationError, cls: 'zpi-job-error' });
    if (!records.length) this.contentEl.createEl('p', { text: '整理結果はまだありません。' });
    for (const record of [...records].reverse()) {
      const card = this.contentEl.createDiv({ cls: 'zpi-job' });
      card.createEl('strong', { text: record.title });
      const labels = { prepared: '移動を確認中（中断した場合はプラグインの再読み込みで復旧）', done: '整理済み', restoring: '元に戻しています', undone: '元に戻しました', failed: '整理できませんでした', unchanged: '未整理のまま' };
      card.createEl('p', { text: labels[record.state], cls: 'zpi-import-state' });
      card.createEl('p', { text: record.from + (record.to !== record.from ? '\n→ ' + record.to : ''), cls: 'zpi-status' });
      card.createEl('p', { text: record.reason });
      if (record.newCategory) card.createEl('p', { text: `新しく作成した分類：${record.newCategory.path}`, cls: 'zpi-meta' });
      if (record.error) card.createEl('p', { text: record.error, cls: 'zpi-job-error' });
      const job = this.owner.queue.latest('undo:' + record.id);
      if (job?.state === 'failed') card.createEl('p', { text: job.error || '元に戻せませんでした', cls: 'zpi-job-error' });
      const actions = new Setting(card);
      if (record.state === 'done') actions.addButton(b => b.setButtonText(job && ['queued','running'].includes(job.state) ? '元に戻す処理を待機中…' : '元に戻す').setDisabled(!!job && ['queued','running'].includes(job.state)).onClick(() => this.owner.enqueueUndo(record.id)));
      const path = `${['done','restoring'].includes(record.state) ? record.to : record.from}/${record.noteName}`;
      if (this.app.vault.getAbstractFileByPath(path)) actions.addButton(b => b.setButtonText('ノートを開く').onClick(() => { this.close(); void this.owner.openNote(path); }));
    }
    this.contentEl.scrollTop = scroll;
  }
  onClose(): void { this.unsubscribe?.(); this.contentEl.empty(); }
}
