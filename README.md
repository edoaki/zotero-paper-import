# Zotero Paper Import

Zoteroの論文を選ぶと、Obsidianの保管庫に「ノート＋PDF」が入った論文フォルダを作ります。

## まず、ここからダウンロード

### [⬇ インストール用ZIPをダウンロード（日本語版 0.1.1）](https://github.com/edoaki/zotero-paper-import/releases/download/0.1.1/zotero-paper-import-0.1.1.zip)

**上のリンクを押せば、必要なZIPを直接ダウンロードできます。GitHubへのログインは不要です。**

GitHubの緑色の「Code → Download ZIP」や「Source code (zip)」は開発用です。インストールには、必ず上のリンクの `zotero-paper-import-0.1.1.zip` を使ってください。

## Macでの入れ方

### 1. ZIPを展開する

Finderの「ダウンロード」で `zotero-paper-import-0.1.1.zip` をダブルクリックします。

`zotero-paper-import` というフォルダができます。Safariなどで既に展開されている場合は、そのフォルダを使います。

フォルダを開いて、**`main.js` と `manifest.json` と `styles.css` が見えること**を確認してください。

```text
ダウンロード/
└─ zotero-paper-import/     ← このフォルダごとコピーします
   ├─ main.js
   ├─ manifest.json
   ├─ styles.css
   └─ INSTALL.txt            ← 日本語の手順
```

### 2. Obsidianから、入れる場所を開く

1. プラグインを使いたい保管庫をObsidianで開きます。
2. 左下の歯車から「設定 → コミュニティプラグイン」を開きます。
3. 「インストールされたプラグイン」の見出し付近にある**フォルダのアイコン**を押します。マウスを重ねると「プラグインのフォルダを開く」と出るアイコンです。
4. **Finderのウィンドウが開きます。ここがコピー先です。**

> このアイコンはZIPを選んでインストールするボタンではありません。保存場所をFinderで開くボタンです。Obsidianの設定画面へZIPやフォルダをドラッグしてもインストールされません。

### 3. 開いたFinderにフォルダを入れる

手順1の **`zotero-paper-import` フォルダを丸ごと**、手順2で開いたFinderの `plugins` フォルダにコピーします。

入れた後は、この並びになれば正解です。

```text
plugins/                    ← フォルダアイコンで開いた場所
├─ copilot/                 ← 既存のプラグインがある場合
└─ zotero-paper-import/     ← 今回コピーしたフォルダ
   ├─ main.js
   ├─ manifest.json
   └─ styles.css
```

**`plugins → zotero-paper-import → main.js` の順に開けることを確認してください。**

次の配置は間違いです。

```text
plugins/main.js                                 × フォルダに入っていない
plugins/zotero-paper-import/zotero-paper-import/main.js   × 二重になっている
plugins/zotero-paper-import-main/src/main.ts      × 開発用ZIPを使っている
```

### 4. 一覧を読み直して、有効にする

1. Obsidianの「設定 → コミュニティプラグイン」に戻ります。
2. 「インストールされたプラグイン」付近の**円形の矢印アイコン（プラグインの再読み込み）**を押します。
3. 一覧に **Zotero Paper Import** が出たら、右側のスイッチをオンにします。
4. 設定の左側に **Zotero Paper Import** が追加されれば完了です。

一覧に出ない場合は、Obsidianをいったん**終了してから起動し直して**ください。Macではウィンドウを閉じるだけでは終了しないため、メニューバーの「Obsidian → Obsidianを終了」（⌘Q）を使います。

制限モードが有効な場合は、「コミュニティプラグインを有効にする」などの案内に沿って解除してから進めます。

## 最初の論文を取り込む

1. Macで**Zotero 10以降**を起動します。
2. Zoteroの「設定 → 詳細」で、他のアプリケーションと通信することを許可します。
3. Obsidianの「設定 → Zotero Paper Import」で **接続確認** を押します。
4. **保存先**に、保管庫内のフォルダ名を入力します。例：`文献`。まだないフォルダでも使えます。
5. 最初は **命名方式：著者名＋年（AI不要）** のままで試してください。
6. 設定を閉じ、⌘Pを押して **Zoteroから論文を取り込む** と入力し、そのコマンドを選びます。
7. 論文を検索して選ぶと、ノートとPDFが保存されます。

```text
文献/
└─ smith2025/
   ├─ smith2025.md
   └─ 本文.pdf
```

ノートの「PDF」欄から、保管庫内のPDFを開けます。

## うまくいかないとき

| 状態 | 確認すること |
| --- | --- |
| ZIPの場所が分からない | このページ上部の「インストール用ZIPをダウンロード」を押してください。 |
| フォルダアイコンを押したがインストールできない | 開いたFinderがコピー先です。その中へ `zotero-paper-import` フォルダを入れます。 |
| `main.js` がない | 開発用のZIPをダウンロードした可能性があります。上部の直接リンクから取り直してください。 |
| コピーしたのに一覧へ出ない | 「プラグインの再読み込み」を押すか、Obsidianを終了して起動し直してください。 |
| フォルダが二重になっている | `main.js` を直接含む方のフォルダを、`plugins` の直下へ置いてください。 |
| 有効化に失敗する | Obsidian本体とインストーラが1.13.4以降か確認してください。設定の「Obsidianについて」で確認できます。 |
| Zoteroにつながらない | Zoteroを起動して、通信許可を有効にします。プラグインの「接続案内」を開くと確認できます。 |
| PDFを取得できない | Zotero側でそのPDFを開き、ダウンロードを完了してから取り込んでください。 |

## 既に0.1.0を入れている人へ

Obsidianでこのプラグインのスイッチをオフにしてから、新しいZIPのフォルダ内にある **`main.js`・`manifest.json`・`styles.css` の3ファイルだけ**を、既存の `plugins/zotero-paper-import/` 内へコピーして置き換えます。

**既存フォルダ全体は削除しないでください。** 設定の `data.json` やバックアップを残したまま更新できます。コピー後に「プラグインの再読み込み」を押すかObsidianを起動し直し、スイッチをオンにします。表示されるバージョンが **0.1.1** なら更新完了です。

## AIで手法名にしたい場合

基本の取り込みができたら、設定の **命名方式 → 手法名（AI）** を選びます。使うCLIを選択し、インストール・ログイン済みの状態で「検出」「AI接続テスト」を実行してください。

- 対応候補：Codex、Claude Code、OpenCode。
- 実機で成功を確認済みなのはCodexです。Claude Codeは認証済み環境での確認待ち、OpenCodeは実験的対応です。
- 自分の命名ルールを文章で登録し、書き出して共有することもできます。
- AI利用時は書誌情報とPDFの抽出本文を選択したAIへ送信します。料金・利用上限はそのCLIで利用するサービスに従います。

[命名・更新・iPadでの閲覧など、詳しい使い方](docs/README.ja.md)

## この版について

macOS向けの初期ベータ版です。Zotero **10以降**、Obsidian本体・インストーラ **1.13.4以降**が必要です。コミュニティプラグイン一覧には未申請です。

生成物は通常のMarkdownとPDFなので、iCloudなどで同期・ダウンロードが完了すればiPadで読めます。iPadのオフライン実機検証は未実施です。取り込み処理はMacで行います。

[設計](docs/DESIGN.md) · [検証記録](docs/TESTING.md) · [不具合を報告する](https://github.com/edoaki/zotero-paper-import/issues)

## 開発する人向け

開発用にNode.js 22以降を用意し、次を実行します。プラグインを使うだけなら、この作業は不要です。

```sh
npm ci
npm run check
npm run package
```

実行用ファイルは `dist/`、インストール用ZIPは `release/` に生成されます。

ライセンス：MIT © 2026 edoaki。PDF本文の抽出にはMozilla PDF.js（Apache-2.0）を同梱しています。ライセンス全文は `THIRD-PARTY-LICENSES.txt` にあります。Zotero・Obsidianの公式製品ではありません。
