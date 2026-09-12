import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ZoteroPaperImport from './main';
import { DEFAULT_TEMPLATE, METHOD_RULE, parseAI, type NamingMode, type Provider, type Rule } from './core';
import { FolderPicker } from './ui';
import { detectCLI, runProcess, invokeAI } from './ai';
import { tmpdir } from 'node:os';

export class ImportSettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: ZoteroPaperImport) { super(app, owner); }
  display(): void {
    const { containerEl: el } = this; const p = this.owner, s = p.settings;
    el.empty(); el.addClass('zpi-settings');
    new Setting(el).setName('Zotero Paper Import').setHeading();
    el.createEl('p', { text: 'One command → choose a paper → a folder with a note and PDFs. / 1コマンドで、論文ノートとPDFをセットで保存します。' });
    new Setting(el).setName('Zotero connection / Zoteroとの接続').setDesc('Zotero 10+ must be open on this computer. No database path, API key, or Zotero add-on required. / Zotero 10以降を起動してください。').addButton(b => b.setButtonText('Check connection / 接続確認').onClick(async () => {
      b.setDisabled(true); try { await p.client().probe(); new Notice('Connected; paper list readable / 接続できました。文献一覧も取得できています。'); } catch (e) { new Notice((e as Error).message, 15000); } finally { b.setDisabled(false); }
    })).addButton(b => b.setButtonText('Setup guide / 接続案内').onClick(() => p.showSetup()));
    new Setting(el).setName('Destination / 保存先').setDesc('Choose or type a folder inside this vault. New folders are created on import. / 保管庫内のフォルダを選択、または入力。').addText(t => t.setPlaceholder('Papers').setValue(s.folder).onChange(async v => { s.folder = v; await p.saveSettings(); })).addButton(b => b.setButtonText('Choose / 選択').onClick(() => new FolderPicker(this.app, path => { s.folder = path; void p.saveSettings(); this.display(); }).open()));
    new Setting(el).setName('Naming / 命名方式').addDropdown(d => d.addOption('author-year', 'Author + year / 著者名＋年（AI不要）').addOption('method', 'Method name / 手法名（AI）').addOption('custom', 'Custom rule / 自分のルール（AI）').setValue(s.naming).onChange(async v => { s.naming = v as NamingMode; await p.saveSettings(); this.display(); }));
    if (s.naming !== 'author-year') {
      el.createEl('p', { cls: 'zpi-disclosure', text: 'AI naming requires an installed, authenticated CLI. Paper metadata and extracted PDF text are sent to the model configured for that CLI. Its usage limits and charges apply. / AI命名にはCLIのインストール・ログインが必要です。書誌情報とPDFの抽出本文を選択したAIへ送信します。利用料金・制限はそのサービスに従います。' });
      new Setting(el).setName('AI CLI').addDropdown(d => d.addOption('codex', 'Codex').addOption('claude', 'Claude Code').addOption('opencode', 'OpenCode (experimental)').setValue(s.provider).onChange(async v => { s.provider = v as Provider; s.cliPath = ''; await p.saveSettings(); this.display(); }));
      new Setting(el).setName('CLI executable / CLIの実行ファイル').setDesc('Optional: auto-detected when blank. Stored only on this device. / 空欄なら自動検出。場所はこの端末だけに保存。').addText(t => t.setValue(s.cliPath).setPlaceholder('Auto-detect / 自動検出').onChange(async v => { s.cliPath = v; await p.saveSettings(); })).addButton(b => b.setButtonText('Detect / 検出').onClick(async () => {
        try { s.cliPath = await detectCLI(s.provider, s.cliPath); const v = await runProcess(s.cliPath, ['--version'], '', tmpdir(), 10000); await p.saveSettings(); this.display(); new Notice(v.trim().slice(0, 200)); } catch (e) { new Notice((e as Error).message, 10000); }
      }));
      new Setting(el).setName('Model / モデル').setDesc('Blank uses the CLI default. Codex uses saved authentication but ignores personal config, hooks and MCP for this operation. / 空欄は既定モデル。Codexは認証を再利用し、個人の設定・フック・MCPは読み込みません。').addText(t => t.setValue(s.model).onChange(async v => { s.model = v; await p.saveSettings(); }));
      new Setting(el).setName('Test AI connection / AI接続テスト').setDesc('Sends a short synthetic prompt; may consume usage. No paper is sent. / 短いテスト文を送信します。利用枠を消費する場合があります。').addButton(b => b.setButtonText('Test / テスト').onClick(async () => {
        b.setDisabled(true); try { parseAI(await invokeAI(s, 'Return only JSON: {"name":null,"reason":"Connection successful","evidence":"test"}')); new Notice('AI connection successful / AIに接続できました'); } catch (e) { new Notice((e as Error).message, 12000); } finally { b.setDisabled(false); }
      }));
      new Setting(el).setName('Timeout (seconds) / 制限時間（秒）').addText(t => t.setValue(String(s.timeoutSeconds)).onChange(async v => { const n = Number(v); if (Number.isFinite(n) && n >= 15 && n <= 600) { s.timeoutSeconds = n; await p.saveSettings(); } }));
      new Setting(el).setName('If AI naming fails / AI命名できない場合').addDropdown(d => d.addOption('author-year', 'Use author + year / 著者名＋年で保存').addOption('ask', 'Enter name manually / 名前を入力').setValue(s.fallback).onChange(async v => { s.fallback = v as 'ask' | 'author-year'; await p.saveSettings(); }));
      if (s.naming === 'method') el.createEl('p', { text: 'Uses a verified new method/model name. Falls back if not found. Naming evidence is saved in the note. / 論文が新しく提案する手法名を使い、確認できなければ代替名で保存します。判断根拠はノートに残ります。' });
      if (s.naming === 'custom') this.rules(el);
    }
    new Setting(el).setName('Note template / ノートのテンプレート').setHeading();
    el.createEl('p', { text: 'Variables: {{title}}, {{authors}}, {{year}}, {{abstract}}, {{source_links}}, {{pdf_links}}, {{naming_reason}}. Your personal notes live outside the generated region. / 自分のメモは自動生成領域の外に保存されます。' });
    new Setting(el).addTextArea(t => { t.inputEl.rows = 12; t.inputEl.addClass('zpi-template'); t.setValue(s.template).onChange(async v => { s.template = v; await p.saveSettings(); }); });
    new Setting(el).addButton(b => b.setButtonText('Reset template / テンプレートを標準に戻す').onClick(async () => { s.template = DEFAULT_TEMPLATE; await p.saveSettings(); this.display(); }));
    const details = el.createEl('details'); details.createEl('summary', { text: 'Advanced connection settings / 接続の詳細設定' });
    new Setting(details).setName('Local API port / ローカルAPIポート').setDesc('Usually 23119. Loopback only; no remote servers. / 通常は変更不要。この端末のZoteroにのみ接続します。').addText(t => t.setValue(String(s.port)).onChange(async v => { const n = Number(v); if (Number.isInteger(n) && n > 0 && n < 65536) { s.port = n; await p.saveSettings(); } }));
    el.createEl('p', { text: 'New naming settings do not rename existing papers. Refresh preserves personal notes and stops if a vault PDF was edited. / 命名設定の変更で既存論文は改名されません。更新時は自分のメモを保持し、保管庫側でPDFが編集されていれば停止します。' });
  }
  private rules(el: HTMLElement): void {
    const p = this.owner, s = p.settings;
    new Setting(el).setName('Naming rules / 命名ルール').addDropdown(d => {
      d.addOption('', 'Choose / 選択'); for (const r of s.rules) d.addOption(r.id, r.name);
      d.setValue(s.activeRule).onChange(async v => { s.activeRule = v; await p.saveSettings(); this.display(); });
    }).addButton(b => b.setButtonText('New / 新規').onClick(async () => { const r = { id: crypto.randomUUID(), name: 'My rule / 自分のルール', prompt: METHOD_RULE }; s.rules.push(r); s.activeRule = r.id; await p.saveSettings(); this.display(); }));
    const rule = s.rules.find(r => r.id === s.activeRule);
    if (rule) {
      new Setting(el).setName('Rule name / ルール名').addText(t => t.setValue(rule.name).onChange(async v => { rule.name = v; await p.saveSettings(); }));
      new Setting(el).setName('Instructions / 命名の指示').addTextArea(t => { t.inputEl.rows = 7; t.inputEl.addClass('zpi-template'); t.setValue(rule.prompt).onChange(async v => { rule.prompt = v; await p.saveSettings(); }); });
      new Setting(el).addButton(b => b.setButtonText('Duplicate / 複製').onClick(async () => { const r = { ...rule, id: crypto.randomUUID(), name: rule.name + ' copy' }; s.rules.push(r); s.activeRule = r.id; await p.saveSettings(); this.display(); }));
    }
    new Setting(el).setName('Share rules / ルールの共有').setDesc('Only rule names and prompts are exported, without CLI paths or authentication. / ルールだけを書き出します。CLIの場所や認証情報は含みません。').addButton(b => b.setButtonText('Export / 書き出す').onClick(() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, rules: s.rules }, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'zotero-paper-import-rules.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })).addButton(b => b.setButtonText('Import / 読み込む').onClick(() => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
      input.onchange = async () => {
        try {
          const file = input.files?.[0]; if (!file) return; if (file.size > 100_000) throw new Error('Rules file is too large');
          const data = JSON.parse(await file.text());
          if (data.schema !== 1 || !Array.isArray(data.rules) || data.rules.length > 100 || data.rules.some((r: Rule) => typeof r.name !== 'string' || typeof r.prompt !== 'string' || r.prompt.length > 20000)) throw new Error('Invalid rules file / ルール形式が不正です');
          for (const r of data.rules) s.rules.push({ id: crypto.randomUUID(), name: r.name.slice(0, 200), prompt: r.prompt });
          await p.saveSettings(); this.display(); new Notice('Rules imported. Select one to use it / ルールを読み込みました。使うルールを選択してください。');
        } catch (e) { new Notice((e as Error).message); }
      }; input.click();
    }));
  }
}
