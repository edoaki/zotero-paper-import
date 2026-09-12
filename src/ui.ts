import { App, Modal, Setting, FuzzySuggestModal, TFolder } from 'obsidian';
import { authorsOf, yearOf, type ZoteroItem, type Paper } from './core';
import { ZoteroClient } from './zotero';

export class FolderPicker extends FuzzySuggestModal<string> {
  constructor(app: App, private done: (path: string) => void) { super(app); this.setPlaceholder('Choose a vault folder / 保存先を選択'); }
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
  constructor(app: App, private client: ZoteroClient, private done: (paper: Paper) => void) { super(app); }
  async onOpen(): Promise<void> {
    this.setTitle('Import from Zotero / Zoteroから取り込む');
    this.contentEl.addClass('zpi-picker');
    new Setting(this.contentEl).setName('Library / ライブラリ').addDropdown(drop => {
      drop.addOption('users/0', 'My Library / マイライブラリ').onChange(v => { this.library = v; void this.search(); });
      void this.client.libraries().then(libs => { for (const l of libs) drop.addOption(l.path, l.name); }).catch(e => { this.status.setText(String(e.message)); });
    });
    new Setting(this.contentEl).setName('Search / 検索').addSearch(search => {
      search.setPlaceholder('Title, author, year / タイトル・著者・年').onChange(v => {
        this.query = v; clearTimeout(this.timer); this.timer = setTimeout(() => { void this.search(); }, 250);
      });
      search.inputEl.setAttribute('aria-label', 'Search Zotero');
      setTimeout(() => search.inputEl.focus(), 50);
    });
    this.status = this.contentEl.createEl('p', { cls: 'zpi-status' });
    this.results = this.contentEl.createDiv({ cls: 'zpi-results' });
    await this.search();
  }
  private async search(): Promise<void> {
    this.controller?.abort(); this.controller = new AbortController();
    const signal = this.controller.signal, generation = ++this.generation;
    this.status.setText('Searching… / 検索中…');
    this.results.empty();
    try {
      const items = await this.client.search(this.query, this.library, signal);
      if (generation !== this.generation || signal.aborted) return;
      this.status.setText(`${items.length}${items.length === 100 ? '+' : ''} papers / 件 · Narrow the search if needed / 多い場合は検索で絞り込んでください`);
      const rows: { paper: Paper; state: HTMLElement }[] = [];
      for (const item of items) {
        const paper: Paper = { item, library: this.library, serverId: this.client.serverId };
        const button = this.results.createEl('button', { cls: 'zpi-paper' });
        button.createEl('strong', { text: item.data.title || 'Untitled' });
        button.createEl('span', { text: `${authorsOf(item)} · ${yearOf(item)}`, cls: 'zpi-meta' });
        const state = button.createEl('span', { text: 'Checking PDF… / PDF確認中…', cls: 'zpi-meta' });
        button.addEventListener('click', () => { this.close(); this.done(paper); });
        rows.push({ paper, state });
      }
      // Limit simultaneous requests to avoid overwhelming a large Zotero library.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (cursor < rows.length && !signal.aborted) {
          const row = rows[cursor++];
          try {
            const pdfs = await this.client.attachments(row.paper, signal);
            if (!signal.aborted) row.state.setText(pdfs.length ? `PDF attachments: ${pdfs.length} (local availability checked on import) / PDF添付あり・実体は取込時に確認` : 'No PDF attachment / PDF添付なし');
          } catch { if (!signal.aborted) row.state.setText('PDF status unknown / PDF状態未確認'); }
        }
      }));
    } catch (e) { if (!signal.aborted) this.status.setText((e as Error).message); }
  }
  onClose(): void { this.controller?.abort(); clearTimeout(this.timer); this.contentEl.empty(); }
}
export function chooseAttachments(app: App, items: ZoteroItem[]): Promise<ZoteroItem[] | null> {
  return new Promise(resolve => {
    class AttachmentPicker extends Modal {
      private selected = new Set(items.map(i => i.key));
      private primary = items[0].key;
      private answered = false;
      onOpen(): void {
        this.setTitle('Choose PDFs / PDFを選択');
        this.contentEl.createEl('p', { text: 'Select the main paper and optional supplements. / 本文と必要な補足資料を選んでください。' });
        new Setting(this.contentEl).setName('Main PDF / 本文').addDropdown(d => {
          for (const i of items) d.addOption(i.key, String(i.data.title || i.data.filename || i.key));
          d.onChange(v => { this.primary = v; this.selected.add(v); });
        });
        for (const i of items) new Setting(this.contentEl).setName(String(i.data.title || i.data.filename || i.key)).addToggle(t => t.setValue(true).onChange(on => { on ? this.selected.add(i.key) : this.selected.delete(i.key); }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('Import selected / 取り込む').setCta().onClick(() => {
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
        new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel / 中止').onClick(() => this.close())).addButton(b => b.setButtonText(accept).setCta().onClick(() => { this.answered = true; resolve(true); this.close(); }));
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
        this.setTitle('Paper folder name / 論文フォルダ名');
        new Setting(this.contentEl).setName('Name / 名前').addText(t => t.setValue(this.value).onChange(v => { this.value = v; }));
        new Setting(this.contentEl).addButton(b => b.setButtonText('Save / 保存').setCta().onClick(() => { if (!this.value.trim()) return; this.answered = true; resolve(this.value); this.close(); }));
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
    this.status = this.contentEl.createEl('p', { text: 'Preparing… / 準備中…' });
    new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel / 中止').onClick(() => { this.controller.abort(); this.close(); }));
  }
  update(text: string): void { this.status?.setText(text); }
  commit(): void { this.committing = true; for (const b of this.contentEl.querySelectorAll('button')) b.disabled = true; }
  finish(): void { this.completed = true; this.close(); }
  onClose(): void { if (!this.completed && !this.committing) this.controller.abort(); }
}
