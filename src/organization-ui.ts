import { App, Modal, Setting, Notice } from 'obsidian';
import type ZoteroPaperImport from './main';
import { modeTabs } from './ui';
import { organizePaths, type OrganizePaper } from './organization';
import { JOB_LABELS } from './queue';
import { remedy, type Problem } from './problems';
import { paperPaths } from './layout';

export class OrganizePicker extends Modal {
  private unsubscribe?: () => void;
  private closed = false;
  private generation = 0;
  private query = '';
  private results!: HTMLElement;
  private status!: HTMLElement;
  private papers: OrganizePaper[] = [];
  private skipped: Problem[] = [];
  constructor(app: App, private owner: ZoteroPaperImport) { super(app); }
  onOpen(): void {
    this.setTitle('文献を整理する'); this.modalEl.addClass('zpi-modal'); this.contentEl.addClass('zpi-picker');
    modeTabs(this.contentEl, 'organize', () => { void this.owner.openPicker(); });
    this.contentEl.createEl('p', { text: '論文を押すと、AIが分類してフォルダごと移動します。画面を閉じても、選んだ順に処理を続けます。' });
    new Setting(this.contentEl).setName('検索').addSearch(s => s.setPlaceholder('タイトル・フォルダ名').onChange(v => { this.query = v; this.renderRows(); }));
    new Setting(this.contentEl).addButton(b => b.setButtonText('整理結果・分類先を変更').onClick(() => this.owner.openOrganizationHistory())).addButton(b => b.setButtonText('一覧を更新').onClick(() => { void this.refresh(); })).addButton(b => b.setButtonText('設定').onClick(() => { this.close(); this.owner.openSettings(); }));
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
      const { papers, skipped } = await this.owner.organizationStore.scan(paths);
      if (this.closed || generation !== this.generation) return;
      this.papers = papers; this.skipped = skipped;
      this.status.setText(`未整理：${paths.inbox}\n分類先：${paths.root}\n${papers.length}件。ノートとPDFを含む論文フォルダが対象です。`);
      this.renderRows();
    } catch (e) { if (!this.closed) this.status.setText((e as Error).message + '\n' + remedy((e as Error).message)); }
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
      if (job?.state === 'failed' && job.error) button.createEl('span', { text: remedy(job.error), cls: 'zpi-meta' });
      button.disabled = !!job && ['queued','running'].includes(job.state);
      button.addEventListener('click', () => this.owner.enqueueOrganization(paper));
    }
    if (this.skipped.length) {
      const details = this.results.createEl('details', { cls: 'zpi-exclusions' });
      details.createEl('summary', { text: `整理できない項目と理由（${this.skipped.length}件）` });
      for (const issue of this.skipped) { const card = details.createDiv({ cls: 'zpi-job' }); card.createEl('strong', { text: issue.path }); card.createEl('p', { text: issue.reason }); card.createEl('p', { text: issue.action, cls: 'zpi-meta' }); }
    }
    this.results.scrollTop = scroll;
  }
  onClose(): void { this.closed = true; this.unsubscribe?.(); this.contentEl.empty(); }
}

export class OrganizationHistoryModal extends Modal {
  private unsubscribe?: () => void;
  private categoryModal?: CategoryChangeModal;
  constructor(app: App, private owner: ZoteroPaperImport) { super(app); }
  onOpen(): void {
    this.setTitle('整理結果・分類先を変更'); this.modalEl.addClass('zpi-modal'); this.contentEl.addClass('zpi-queue');
    this.unsubscribe = this.owner.queue.subscribe(() => this.render()); this.render();
  }
  private render(): void {
    const scroll = this.contentEl.scrollTop; this.contentEl.empty();
    this.contentEl.createEl('p', { text: '分類先を選び直すと、現在の論文フォルダを移動します。整理後に書き足したメモも保持します。' });
    const records = this.owner.organizer.records;
    if (this.owner.organizationError) this.contentEl.createEl('p', { text: this.owner.organizationError, cls: 'zpi-job-error' });
    if (!records.length) this.contentEl.createEl('p', { text: '整理結果はまだありません。' });
    for (const record of [...records].reverse()) {
      const card = this.contentEl.createDiv({ cls: 'zpi-job' });
      card.createEl('strong', { text: record.title });
      const labels = { prepared: '移動が中断しています。現在のノートと配置を確認してください。', done: '整理済み', restoring: '旧版の処理が中断しています。現在の配置を保持します。', undone: '旧版で取り消し済み', failed: '整理できませんでした', unchanged: '未整理のまま', superseded: '後から分類先を変更済み' };
      card.createEl('p', { text: labels[record.state], cls: 'zpi-import-state' });
      card.createEl('p', { text: record.from + (record.to !== record.from ? '\n→ ' + record.to : ''), cls: 'zpi-status' });
      card.createEl('p', { text: record.reason });
      if (record.newCategory) card.createEl('p', { text: `新しく作成した分類：${record.newCategory.path}`, cls: 'zpi-meta' });
      if (record.error) card.createEl('p', { text: record.error, cls: 'zpi-job-error' });
      const job = this.owner.queue.latest('change-category:' + record.id);
      if (job?.state === 'failed') card.createEl('p', { text: (job.error || '分類先を変更できませんでした') + '\n' + remedy(job.error || ''), cls: 'zpi-job-error' });
      const actions = new Setting(card);
      if (record.state === 'done') actions.addButton(b => b.setButtonText(job && ['queued','running'].includes(job.state) ? '分類先を変更中…' : '分類先を変更').setDisabled(!!job && ['queued','running'].includes(job.state)).onClick(() => { this.categoryModal?.close(); this.categoryModal = new CategoryChangeModal(this.app, this.owner, record.id); this.categoryModal.open(); }));
      const path = `${['done','restoring'].includes(record.state) ? record.to : record.from}/${record.noteName}`;
      if (this.app.vault.getAbstractFileByPath(path)) actions.addButton(b => b.setButtonText('ノートを開く').onClick(() => { this.close(); void this.owner.openNote(path); }));
    }
    this.contentEl.scrollTop = scroll;
  }
  onClose(): void { this.categoryModal?.close(); this.unsubscribe?.(); this.contentEl.empty(); }
}

class CategoryChangeModal extends Modal {
  private closed = false;
  constructor(app: App, private owner: ZoteroPaperImport, private recordId: string) { super(app); }
  async onOpen(): Promise<void> {
    this.setTitle('分類先を変更'); this.modalEl.addClass('zpi-modal');
    const status = this.contentEl.createEl('p', { text: '現在の論文と分類先を確認中…' });
    try {
      const paper = await this.owner.organizationStore.locate(this.recordId);
      const paths = paperPaths(this.owner.settings), categories = await this.owner.organizationStore.categories(paths);
      if (this.closed) return;
      if (!categories.length) throw new Error('分類先がありません。文献の親フォルダ内に分類フォルダを作成してください。');
      status.setText('現在の場所：' + paper.folder);
      let selected = categories[0].path;
      const current = paper.folder.slice(0, paper.folder.lastIndexOf('/')).slice(paths.root.length + 1);
      if (categories.some(c => c.path === current)) selected = current;
      new Setting(this.contentEl).setName('移動先').addDropdown(d => { for (const category of categories) d.addOption(category.path, category.path); d.setValue(selected).onChange(v => { selected = v; }); });
      new Setting(this.contentEl).setDesc('選んだ分類先へフォルダごと移動し、手動で分類先を指定した論文として保持します。').addButton(b => b.setButtonText('移動').setCta().onClick(() => { this.owner.enqueueCategoryChange(this.recordId, paper.folder, selected); this.close(); }));
    } catch (e) { if (!this.closed) status.setText((e as Error).message); }
  }
  onClose(): void { this.closed = true; this.contentEl.empty(); }
}
