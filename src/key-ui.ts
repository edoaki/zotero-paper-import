import { App, Modal, Setting } from 'obsidian';
import type ZoteroPaperImport from './main';
import { literatureFolders } from './layout';
import { JOB_LABELS } from './queue';
import { remedy } from './problems';

export class KeyCompletionModal extends Modal {
  private library = 'users/0'; private unsubscribe?: () => void; private closed = false; private generation = 0;
  private results!: HTMLElement;
  constructor(app: App, private owner: ZoteroPaperImport) { super(app); }
  onOpen(): void {
    this.setTitle('既存ノートのZoteroキーを補完'); this.modalEl.addClass('zpi-modal');
    this.contentEl.createEl('p', { text: 'キーがないノートを押すと、DOI・arXiv IDで照合して補完します。候補が1件に決まる場合だけ書き込みます。画面を閉じても続きます。' });
    new Setting(this.contentEl).setName('Zoteroライブラリ').addDropdown(d => {
      d.addOption('users/0', 'マイライブラリ').onChange(v => { this.library = v; });
      const client = this.owner.client();
      void client.probe().then(()=>client.libraries()).then(libraries=>{ if (this.closed) return; d.selectEl.replaceChildren(); for (const lib of libraries) d.addOption(lib.path, lib.name); d.setValue(this.library); }).catch(()=>{/* worker displays a useful error if the connection is unavailable */});
    });
    new Setting(this.contentEl).addButton(b=>b.setButtonText('一覧を更新').onClick(()=>{void this.refresh();})).addButton(b=>b.setButtonText('処理状況を見る').onClick(()=>{this.close();this.owner.openQueue();}));
    this.results = this.contentEl.createDiv(); this.unsubscribe = this.owner.queue.subscribe(()=>{void this.refresh();});void this.refresh();
  }
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    try {
      const notes = await this.owner.store.keylessNotes(literatureFolders(this.owner.settings));
      if (this.closed || generation !== this.generation) return;
      const scroll=this.contentEl.scrollTop;this.results.empty();
      if (!notes.length) this.results.createEl('p', { text: 'キーを補完する文献ノートはありません。' });
      for (const note of notes) {
        const card = this.results.createDiv({cls:'zpi-job'});card.createEl('strong',{text:note.title});card.createEl('p',{text:note.path,cls:'zpi-meta'});
        const job=this.owner.queue.latest('complete-key:'+note.path);
        if (note.issue) card.createEl('p',{text:note.issue,cls:'zpi-job-error'});
        else card.createEl('p',{text:note.identifiers.join(' · '),cls:'zpi-meta'});
        if (job && job.state!=='completed') card.createEl('p',{text:`${JOB_LABELS[job.state]}：${job.error||job.progress}`,cls:'zpi-status'});
        if(job?.state==='failed'&&job.error)card.createEl('p',{text:remedy(job.error),cls:'zpi-meta'});
        new Setting(card).addButton(b=>b.setButtonText('照合して補完').setDisabled(!!note.issue||!!job&&['queued','running'].includes(job.state)).onClick(()=>this.owner.enqueueKeyCompletion(note.path,note.title,this.library))).addButton(b=>b.setButtonText('ノートを開く').onClick(()=>{this.close();void this.owner.openNote(note.path);}));
      }
      this.contentEl.scrollTop=scroll;
    } catch(e) { if(!this.closed)this.results.setText((e as Error).message); }
  }
  onClose():void { this.closed=true;this.unsubscribe?.();this.contentEl.empty(); }
}
