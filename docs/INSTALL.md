# インストール・更新

通常の入れ方は [トップページ](../README.md#入れ方) をご覧ください。

## インストールできない場合

| 状態 | 確認すること |
| --- | --- |
| ZIPがなく、フォルダになっている | Safariが自動展開した可能性があります。`zotero-paper-import` 内に `main.js`・`manifest.json`・`styles.css` があれば、そのフォルダをコピーしてください。ZIPへの戻し作業は不要です。 |
| ZIPが分からない | [インストール用ZIP](https://github.com/edoaki/zotero-paper-import/releases/download/0.3.4/zotero-paper-import-0.3.4.zip?download=1) を使います。「Code → Download ZIP」「Source code」は開発用です。 |
| フォルダアイコンを押しても入らない | このアイコンはコピー先を開くボタンです。開いたFinder／エクスプローラーに、展開したフォルダをコピーします。 |
| プラグインが一覧に出ない | `plugins/zotero-paper-import/main.js` の配置か確認し、Obsidianを再起動します。Macではウィンドウを閉じるだけでなく、⌘Qで終了します。 |
| フォルダが二重になっている | `main.js` を直接含む `zotero-paper-import` フォルダを、`plugins` の直下に置きます。 |
| 有効にできない | Obsidian本体・インストーラが1.13.4以上か確認します。制限モードがオンの場合は、コミュニティプラグインを有効にします。 |

正しい配置：

```text
plugins/
└─ zotero-paper-import/
   ├─ main.js
   ├─ manifest.json
   └─ styles.css
```

## 更新

0.3.2以降は **設定 → Zotero Paper Import → プラグインの更新 → 更新** で最新版を取得できます。バックアップとファイル検証の後に置き換えます。完了後はObsidianを終了して起動し直してください。

以前の版からは、次の手順で手動更新してください。

1. Obsidianで **Zotero Paper Importをオフ** にします。
2. 新しいZIPを展開します。
3. 展開したフォルダ内の **`main.js`・`manifest.json`・`styles.css` の3ファイルだけ**を、既存の `plugins/zotero-paper-import/` にコピーして置き換えます。
4. Obsidianを再起動し、プラグインをオンにします。

既存フォルダ全体は削除しないでください。設定の `data.json`、整理履歴の `organization-history.json`、バックアップを残して更新します。
