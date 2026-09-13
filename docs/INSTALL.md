# インストール・更新

通常の入れ方は [トップページ](../README.md#入れ方) をご覧ください。

## インストールできない場合

| 状態 | 確認すること |
| --- | --- |
| ZIPが分からない | [インストール用ZIP](https://github.com/edoaki/zotero-paper-import/releases/download/0.3.0/zotero-paper-import-0.3.0.zip?download=1) を使います。「Code → Download ZIP」「Source code」は開発用です。 |
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

1. Obsidianで **Zotero Paper Importをオフ** にします。
2. 新しいZIPを展開します。
3. 展開したフォルダ内の **`main.js`・`manifest.json`・`styles.css` の3ファイルだけ**を、既存の `plugins/zotero-paper-import/` にコピーして置き換えます。
4. Obsidianを再起動し、プラグインをオンにします。

既存フォルダ全体は削除しないでください。設定の `data.json`、整理履歴の `organization-history.json`、バックアップを残して更新します。
