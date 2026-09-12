import { Notice, Setting } from 'obsidian';
import type { Settings } from './core';
import { detectCLI } from './cli';
import { cliGuide, CLI_NAMES, guideOS, OS_LABELS, type GuideOS } from './cli-guide';

export class CLISetup {
  private generation = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private status: Setting;
  private guide: HTMLDetailsElement;
  private input!: HTMLInputElement;
  constructor(private el: HTMLElement, private settings: Settings, private save: () => Promise<void>, private detected: () => void) {
    el.addClass('zpi-cli-setup');
    this.status = new Setting(el).setName(`${CLI_NAMES[settings.provider]}：確認中…`);
    this.status.nameEl.setAttribute('role', 'status'); this.status.nameEl.setAttribute('aria-live', 'polite');
    this.guide = el.createEl('details', { cls: 'zpi-cli-guide' });
    this.guide.createEl('summary', { text: 'インストール・ログインの手順' });
    let os = guideOS(process.platform);
    const chooser = new Setting(this.guide).setName('手順を表示するOS').setDesc(os ? `この端末は${OS_LABELS[os]}です。別のOSの手順にも切り替えられます。` : 'OSを判定できませんでした。使用するOSを選んでください。');
    const body = this.guide.createDiv();
    chooser.addDropdown(d => {
      if (!os) d.addOption('', 'OSを選択');
      for (const [value, label] of Object.entries(OS_LABELS)) d.addOption(value, label);
      d.setValue(os || '').onChange(value => { os = value as GuideOS; this.renderGuide(body, os); });
    });
    if (os) this.renderGuide(body, os);
    const retry = new Setting(el).setDesc('インストールとログインが終わったら押してください。').addButton(b => b.setButtonText('再検出').onClick(() => { void this.check(true); }));
    retry.settingEl.addClass('zpi-cli-retry');
    const location = el.createEl('details'); location.createEl('summary', { text: 'CLIの場所を指定（自動で見つからない場合）' });
    new Setting(location).setName('CLIの実行ファイル').setDesc('空欄で自動検出。実行ファイルの場所はこの端末だけに保存します。Windowsでは.exeを指定してください。').addText(t => {
      this.input = t.inputEl;
      t.setValue(settings.cliPath).setPlaceholder('自動検出').onChange(v => {
        settings.cliPath = v; this.generation++; clearTimeout(this.timer);
        void this.save().catch(e => new Notice((e as Error).message));
        this.timer = setTimeout(() => { void this.check(); }, 350);
      });
    });
    void this.check();
  }
  private renderGuide(body: HTMLElement, os: GuideOS): void {
    body.empty(); const guide = cliGuide(this.settings.provider, os);
    body.createEl('p', { text: guide.terminal });
    for (const [i, step] of guide.steps.entries()) {
      const section = body.createDiv({ cls: 'zpi-cli-step' });
      section.createEl('strong', { text: `${i + 1}. ${step.title}` });
      section.createEl('p', { text: step.description });
      if (step.command) {
        section.createEl('pre').createEl('code', { text: step.command });
        new Setting(section).addButton(b => b.setButtonText('コマンドをコピー').onClick(async () => {
          try { await navigator.clipboard.writeText(step.command!); new Notice('コピーしました。ターミナルに貼り付けて実行してください。'); }
          catch { new Notice('コピーできませんでした。枠内のコマンドを選択してコピーしてください。'); }
        }));
      }
      if (step.link) section.createEl('a', { text: step.link.label, href: step.link.url, attr: { target: '_blank', rel: 'noopener noreferrer' } });
    }
    body.createEl('a', { text: `${CLI_NAMES[this.settings.provider]}の公式手順を開く`, href: guide.source, attr: { target: '_blank', rel: 'noopener noreferrer' } });
  }
  async check(auto = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const { provider, cliPath } = this.settings;
    const current = () => !this.disposed && generation === this.generation;
    this.status.setName(`${CLI_NAMES[provider]}：確認中…`).setDesc('この端末の実行ファイルを探しています。');
    this.el.dataset.state = 'checking';
    try {
      // A retry discovers newly installed CLIs even if the old configured path was wrong.
      let file: string;
      try { file = await detectCLI(provider, cliPath); }
      catch (e) { if (!auto || !cliPath.trim()) throw e; file = await detectCLI(provider); }
      if (!current()) return;
      if (auto && cliPath.trim() && file !== cliPath) {
        this.settings.cliPath = file; this.input.value = file; await this.save();
        if (!current()) return;
      }
      this.status.setName(`${CLI_NAMES[provider]}：検出済み`).setDesc(`見つかりました：${file}\nログイン状態は「AI接続テスト」で確認してください。`);
      this.el.dataset.state = 'found'; this.guide.open = false;
      this.detected();
    } catch {
      if (!current()) return;
      this.status.setName(`${CLI_NAMES[provider]}：見つかりません`).setDesc(cliPath.trim() ? '指定された場所に実行ファイルがありません。「再検出」で探し直すか、下の手順で導入してください。' : 'まだインストールされていないか、保存場所を検出できません。下の手順で導入してください。');
      this.el.dataset.state = 'missing'; this.guide.open = true;
    }
  }
  dispose(): void { this.disposed = true; this.generation++; clearTimeout(this.timer); }
}
