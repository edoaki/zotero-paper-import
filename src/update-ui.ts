import { apiVersion, FileSystemAdapter, Notice, requestUrl, Setting } from 'obsidian';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type ZoteroPaperImport from './main';
import { installUpdate, prepareUpdate } from './updater';

export class PluginUpdater {
  private working = false;
  private installed = '';
  constructor(private owner: ZoteroPaperImport) {}
  render(el: HTMLElement): void {
    const row = new Setting(el).setName('プラグインの更新')
      .setDesc(this.installed ? `${this.installed} に更新済みです。Obsidianを終了して起動し直してください。` : `使用中：${this.owner.manifest.version}。GitHubの正式リリースから更新します。設定と文献は保持します。`);
    row.addButton(button => button.setButtonText(this.installed ? '再起動待ち' : '更新').setDisabled(this.working || !!this.installed).onClick(async () => {
      if (this.working || this.installed) return;
      const p = this.owner;
      if (p.busy) { new Notice('文献の処理が終わってから更新してください。'); return; }
      if (!(p.app.vault.adapter instanceof FileSystemAdapter)) { new Notice('プラグインの更新はデスクトップで行ってください。'); return; }
      this.working = true; button.setDisabled(true); row.setDesc('GitHubの最新版を確認しています…');
      try {
        const base = p.app.vault.adapter.getBasePath();
        const pluginDir = join(base, p.app.vault.configDir, 'plugins', p.manifest.id);
        const disk = JSON.parse(await readFile(join(pluginDir, 'manifest.json'), 'utf8'));
        if (disk.version !== p.manifest.version) { this.installed = disk.version; row.setDesc(`${disk.version} が保存済みです。Obsidianを終了して起動し直してください。`); return; }
        const plan = await prepareUpdate(disk.version, apiVersion, async url => {
          const response = await requestUrl({ url, headers: { Accept: 'application/vnd.github+json' }, throw: false });
          if (response.status === 404) throw new Error('公開済みの正式リリースが見つかりません。現在の版はそのまま使えます。');
          if (response.status === 403 || response.status === 429) throw new Error('GitHubのアクセス制限です。時間を置いて再度お試しください。');
          if (response.status !== 200) throw new Error(`GitHubから取得できませんでした（${response.status}）。現在の版は変更していません。`);
          const bytes = new Uint8Array(response.arrayBuffer);
          if (bytes.length > 25_000_000) throw new Error('更新ファイルが大きすぎるため停止しました。');
          return bytes;
        });
        if (!plan) { row.setDesc(`使用中：${disk.version}。公開済みの最新版と同じか、それより新しい版です。`); return; }
        row.setDesc(`${plan.version} を検証しました。バックアップして更新しています…`);
        await installUpdate(pluginDir, join(base, p.app.vault.configDir, 'plugin-backups'), plan, () => !p.busy);
        this.installed = plan.version;
        row.setDesc(`${plan.version} に更新しました。Obsidianを終了して起動し直してください。`);
        new Notice('プラグインを更新しました。Obsidianを終了して起動し直すと反映されます。', 12000);
      } catch (error) { const message = error instanceof Error ? error.message : String(error); row.setDesc(message); new Notice(message, 12000); }
      finally { this.working = false; button.setDisabled(!!this.installed).setButtonText(this.installed ? '再起動待ち' : '更新'); }
    }));
  }
}
