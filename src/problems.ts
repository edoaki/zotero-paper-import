export interface Problem { path: string; reason: string; action: string }
export function remedy(message: string): string {
  if (/ログイン|認証|利用枠|モデル/.test(message)) return '設定の「AIの設定」を開き、CLIへのログインと利用できるモデルを確認してから再試行してください。';
  if (/Zotero.*(?:応答|接続)|通信|起動/.test(message)) return 'Zoteroを起動し、設定で他のアプリケーションとの通信を許可してください。';
  if (/CLI|インストール|見つかりません.*設定/.test(message)) return '設定に表示されるCLIの導入手順を確認してください。';
  if (/同名|既に使われ|上書き/.test(message)) return '移動先の同名フォルダを確認し、別の分類先を選んでください。';
  if (/編集|変更|移動.*削除|中断/.test(message)) return '最新の状態を確認し、一覧を更新してから選び直してください。';
  if (/PDF/.test(message)) return '論文のPDFが保存されているか確認してください。取り込みの場合はZoteroでPDFを開いてダウンロードできます。';
  if (/内部リンク/.test(message)) return 'Obsidianの「設定 → ファイルとリンク → 内部リンクを常に更新」をオンにしてください。';
  return '表示された理由を確認して再試行してください。設定やノートを直した場合は、一覧を更新してください。';
}
