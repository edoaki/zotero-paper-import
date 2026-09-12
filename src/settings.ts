import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ZoteroPaperImport from './main';
import { DEFAULT_TEMPLATE, METHOD_RULE, parseAI, type NamingMode, type Provider, type Rule } from './core';
import { FolderPicker } from './ui';
import { detectCLI, runProcess, invokeAI } from './ai';
import { tmpdir } from 'node:os';
import { defaultModels, discoverModels } from './models';

export class ImportSettingsTab extends PluginSettingTab {
  private connectionTimer?: ReturnType<typeof setInterval>;
  private connectionAbort?: AbortController;
  private modelsAbort?: AbortController;
  private recheckConnection?: () => void;
  constructor(app: App, private owner: ZoteroPaperImport) { super(app, owner); }
  hide(): void {
    clearInterval(this.connectionTimer);
    this.connectionAbort?.abort(); this.modelsAbort?.abort();
  }
  display(): void {
    this.hide();
    const { containerEl: el } = this; const p = this.owner, s = p.settings;
    el.empty(); el.addClass('zpi-settings');
    new Setting(el).setName('Zotero Paper Import').setHeading();
    el.createEl('p', { text: '1コマンドで、論文ノートとPDFをセットで保存します。' });
    this.connection(el);
    new Setting(el).setName('保存先').setDesc('保管庫内のフォルダを選択、または入力。').addText(t => t.setPlaceholder('例：文献').setValue(s.folder).onChange(async v => { s.folder = v; await p.saveSettings(); })).addButton(b => b.setButtonText('選択').onClick(() => new FolderPicker(this.app, path => { s.folder = path; void p.saveSettings(); this.display(); }).open()));
    new Setting(el).setName('命名方式').addDropdown(d => d.addOption('author-year', '著者名＋年（AI不要）').addOption('method', '手法名（AI）').addOption('custom', '自分のルール（AI）').setValue(s.naming).onChange(async v => { s.naming = v as NamingMode; await p.saveSettings(); this.display(); }));
    if (s.naming !== 'author-year') {
      el.createEl('p', { cls: 'zpi-disclosure', text: 'AI命名にはCLIのインストール・ログインが必要です。書誌情報とPDFの抽出本文を選択したAIへ送信します。利用料金・制限はそのサービスに従います。' });
      new Setting(el).setName('使用するAI').addDropdown(d => d.addOption('codex', 'Codex').addOption('claude', 'Claude Code').addOption('opencode', 'OpenCode（実験的対応）').addOption('antigravity', 'Antigravity CLI（実験的対応）').setValue(s.provider).onChange(async v => { s.provider = v as Provider; s.cliPath = ''; s.model = ''; await p.saveSettings(); this.display(); }));
      new Setting(el).setName('CLIの実行ファイル').setDesc('空欄なら自動検出。場所はこの端末だけに保存。').addText(t => t.setValue(s.cliPath).setPlaceholder('自動検出').onChange(async v => { s.cliPath = v; await p.saveSettings(); })).addButton(b => b.setButtonText('検出').onClick(async () => {
        try { s.cliPath = await detectCLI(s.provider, s.cliPath); const v = await runProcess(s.cliPath, ['--version'], '', tmpdir(), 10000); await p.saveSettings(); this.display(); new Notice(v.trim().slice(0, 200)); } catch (e) { new Notice((e as Error).message, 10000); }
      }));
      if (s.provider === 'antigravity') el.createEl('p', { text: '公式のAntigravity CLI（agy）を使います。初回はターミナルでagyを開いてGoogleアカウントでログインしてください。モデル一覧もログイン後に取得できます。' });
      this.models(el);
      new Setting(el).setName('AI接続テスト').setDesc('短いテスト文を送信します。利用枠を消費する場合があります。').addButton(b => b.setButtonText('テスト').onClick(async () => {
        b.setDisabled(true); try { parseAI(await invokeAI(s, 'Return only JSON: {"name":null,"reason":"Connection successful","evidence":"test"}')); new Notice('AIに接続できました'); } catch (e) { new Notice((e as Error).message, 12000); } finally { b.setDisabled(false); }
      }));
      new Setting(el).setName('制限時間（秒）').addText(t => t.setValue(String(s.timeoutSeconds)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 15 && n <= 600) { s.timeoutSeconds = n; await p.saveSettings(); } }));
      el.createEl('p', { cls: 'zpi-status', text: 'AIが名前を決められない場合は、著者名＋年で保存します。' });
      if (s.naming === 'method') el.createEl('p', { text: '論文が新しく提案する手法名を使い、確認できなければ代替名で保存します。判断根拠はノートに残ります。' });
      if (s.naming === 'custom') this.rules(el);
    }
    new Setting(el).setName('ノートのテンプレート').setHeading();
    el.createEl('p', { text: '置き換え項目：{{title}}（題名）、{{authors}}（著者）、{{year}}（年）、{{abstract}}（要旨）、{{source_links}}（原文リンク）、{{pdf_links}}（PDFリンク）、{{naming_reason}}（命名の根拠）。自分のメモはこの領域の外に書きます。' });
    new Setting(el).addTextArea(t => { t.inputEl.rows = 12; t.inputEl.addClass('zpi-template'); t.setValue(s.template).onChange(async v => { s.template = v; await p.saveSettings(); }); });
    new Setting(el).addButton(b => b.setButtonText('テンプレートを標準に戻す').onClick(async () => { s.template = DEFAULT_TEMPLATE; await p.saveSettings(); this.display(); }));
    const details = el.createEl('details'); details.createEl('summary', { text: '接続の詳細設定' });
    new Setting(details).setName('ローカルAPIポート').setDesc('通常は変更不要。この端末のZoteroにのみ接続します。').addText(t => t.setValue(String(s.port)).onChange(async v => { const n = Number(v); if (Number.isInteger(n) && n > 0 && n < 65536) { s.port = n; await p.saveSettings(); this.recheckConnection?.(); } }));
    el.createEl('p', { text: '命名設定の変更で既存論文は改名されません。更新時は自分のメモを保持し、保管庫側でPDFが編集されていれば停止します。' });
  }
  private connection(el: HTMLElement): void {
    const row = new Setting(el).setName('Zotero：接続状況を確認中…').setDesc('Zoteroの起動と通信許可を自動で確認します。');
    row.settingEl.addClass('zpi-connection-state');
    row.nameEl.setAttribute('role', 'status'); row.nameEl.setAttribute('aria-live', 'polite');
    let help!: HTMLButtonElement;
    row.addButton(b => { help = b.buttonEl; help.hidden = true; b.setButtonText('接続方法を見る').onClick(() => this.owner.showSetup()); });
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      this.connectionAbort?.abort(); const controller = new AbortController(); this.connectionAbort = controller;
      try {
        await this.owner.client().probe(controller.signal);
        if (controller.signal.aborted) return;
        row.setName('Zotero：接続済み').setDesc('文献一覧を取得できます。論文の取り込みを始められます。');
        row.settingEl.dataset.state = 'connected'; help.hidden = true;
      } catch (e) {
        if (controller.signal.aborted) return;
        row.setName('Zotero：未接続').setDesc((e as Error).message);
        row.settingEl.dataset.state = 'disconnected'; help.hidden = false;
      } finally { checking = false; }
    };
    this.recheckConnection = () => { row.setName('Zotero：接続状況を確認中…'); void check(); };
    void check();
    this.connectionTimer = setInterval(() => { void check(); }, 8000);
  }
  private models(el: HTMLElement): void {
    const p = this.owner, s = p.settings;
    const row = new Setting(el).setName('モデル').setDesc('一覧から選んでください。迷ったら「自動」のままで使えます。');
    let select!: HTMLSelectElement;
    const populate = (models: { value: string; label: string }[]) => {
      select.replaceChildren();
      for (const m of models) { const option = document.createElement('option'); option.value = m.value; option.textContent = m.label; select.append(option); }
      if (s.model && !models.some(m => m.value === s.model)) {
        const option = document.createElement('option'); option.value = s.model; option.textContent = `${s.model}（以前の選択）`; select.append(option);
      }
      select.value = s.model;
    };
    row.addDropdown(d => { select = d.selectEl; select.setAttribute('aria-label', 'AIのモデル'); populate(defaultModels(s.provider)); d.onChange(async v => { s.model = v; await p.saveSettings(); }); });
    const load = async () => {
      this.modelsAbort?.abort(); const controller = new AbortController(); this.modelsAbort = controller;
      try {
        const result = await discoverModels({ ...s }, controller.signal);
        if (controller.signal.aborted) return;
        populate(result);
        row.setDesc(s.provider === 'claude' ? 'モデル名の入力は不要です。「自動」または種類を選んでください。利用できる種類はログイン先の契約によります。' : 'CLIから取得したモデル一覧です。迷ったら「自動」のままで使えます。');
      } catch (e) {
        if (!controller.signal.aborted) row.setDesc(s.provider === 'antigravity' ? 'モデル一覧を取得できません。ターミナルでagyを開いてログインし、「一覧を更新」を押してください。「自動」も利用できます。' : 'モデル一覧を取得できませんでした。「自動」を使うか、CLIを設定して「一覧を更新」を押してください。');
      }
    };
    if (s.provider !== 'claude') row.addButton(b => b.setButtonText('一覧を更新').onClick(() => { void load(); }));
    void load();
  }
  private rules(el: HTMLElement): void {
    const p = this.owner, s = p.settings;
    new Setting(el).setName('命名ルール').addDropdown(d => {
      d.addOption('', '選択'); for (const r of s.rules) d.addOption(r.id, r.name);
      d.setValue(s.activeRule).onChange(async v => { s.activeRule = v; await p.saveSettings(); this.display(); });
    }).addButton(b => b.setButtonText('新規').onClick(async () => { const r = { id: crypto.randomUUID(), name: '自分のルール', prompt: METHOD_RULE }; s.rules.push(r); s.activeRule = r.id; await p.saveSettings(); this.display(); }));
    const rule = s.rules.find(r => r.id === s.activeRule);
    if (rule) {
      new Setting(el).setName('ルール名').addText(t => t.setValue(rule.name).onChange(async v => { rule.name = v; await p.saveSettings(); }));
      new Setting(el).setName('命名の指示').addTextArea(t => { t.inputEl.rows = 7; t.inputEl.addClass('zpi-template'); t.setValue(rule.prompt).onChange(async v => { rule.prompt = v; await p.saveSettings(); }); });
      new Setting(el).addButton(b => b.setButtonText('複製').onClick(async () => { const r = { ...rule, id: crypto.randomUUID(), name: rule.name + ' のコピー' }; s.rules.push(r); s.activeRule = r.id; await p.saveSettings(); this.display(); }));
    }
    new Setting(el).setName('ルールの共有').setDesc('ルールだけを書き出します。CLIの場所や認証情報は含みません。').addButton(b => b.setButtonText('書き出す').onClick(() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, rules: s.rules }, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'zotero-paper-import-rules.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })).addButton(b => b.setButtonText('読み込む').onClick(() => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
      input.onchange = async () => {
        try {
          const file = input.files?.[0]; if (!file) return; if (file.size > 100_000) throw new Error('ルールファイルが大きすぎます。100 KB以下のファイルを選んでください。');
          const data = JSON.parse(await file.text());
          if (data.schema !== 1 || !Array.isArray(data.rules) || data.rules.length > 100 || data.rules.some((r: Rule) => typeof r.name !== 'string' || typeof r.prompt !== 'string' || r.prompt.length > 20000)) throw new Error('ルール形式が不正です');
          for (const r of data.rules) s.rules.push({ id: crypto.randomUUID(), name: r.name.slice(0, 200), prompt: r.prompt });
          await p.saveSettings(); this.display(); new Notice('ルールを読み込みました。使うルールを選択してください。');
        } catch (e) { new Notice((e as Error).message); }
      }; input.click();
    }));
  }
}
