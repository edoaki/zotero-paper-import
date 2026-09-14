# Zotero Paper Import

Zoteroの論文を、ノートとPDFのセットでObsidianに保存するプラグインです。AIで論文名を付けたり、分類フォルダへ整理したりできます。

## [⬇ インストール用ZIPをダウンロード（0.3.4）](https://github.com/edoaki/zotero-paper-import/releases/download/0.3.4/zotero-paper-import-0.3.4.zip?download=1)

Obsidian **1.13.4以上**・Zotero **10以上**が必要です。Macで動作確認済み、Windowsは未検証です。

## 入れ方

1. ダウンロード先を開きます。ZIPがある場合は展開してください。すでに `zotero-paper-import` フォルダになっていれば、そのままで大丈夫です。
2. Obsidianの **設定 → コミュニティプラグイン** で、「インストールされたプラグイン」付近の **フォルダアイコン** を押します。
3. 開いたFinder（Windowsではエクスプローラー）に、`zotero-paper-import` フォルダを丸ごとコピーします。
4. Obsidianを再起動し、コミュニティプラグインの一覧で **Zotero Paper Import** をオンにします。

コピー後に `plugins/zotero-paper-import/main.js` があれば正しい配置です。

**Safariでは、ZIPがダウンロード後に自動で展開されることがあります。** `zotero-paper-import` フォルダを開いて `main.js`・`manifest.json`・`styles.css` があれば、インストールに必要なファイルは揃っています。ZIPに戻す必要はありません。[Safariのダウンロードについて（Apple公式）](https://support.apple.com/ja-jp/guide/safari/sfri40598/mac)

既に入れている人は [更新手順](docs/INSTALL.md#更新) を使ってください。

## Zoteroの準備（初めて使う人向け）

### 1. Zoteroアプリを入れる

[Zotero公式のダウンロードページ](https://www.zotero.org/download/) から、パソコン用のZoteroをインストールして起動します。

### 2. ChromeにZotero Connectorを入れる

1. Chromeを開き、右上の **⋮（縦に3つの点）→ 拡張機能 → Chrome ウェブストアにアクセス** を押します。[Chrome ウェブストア](https://chromewebstore.google.com/) を直接開いても大丈夫です。
2. **Zotero Connector** を検索し、**Chromeに追加 → 拡張機能を追加** を押します。
3. Chrome右上の **拡張機能（パズルのピースのアイコン）** を押し、Zotero Connectorの横の **ピン** を押します。ピン留めしておくと、いつでもすぐに使えて便利です。

### 3. 論文ページからZoteroに登録する

1. Zoteroアプリを起動したまま、Chromeで **arXivなどの論文ページ** を開きます。タイトルや要旨が載っているページで大丈夫です。
2. 右上にピン留めした **Zotero Connectorのアイコン** を押すと、その論文がZoteroに登録されます。アイコンはページに応じて、紙や本などの形に変わります。
3. Zoteroアプリで論文が追加されたことを確認します。取得できるPDFがあれば、一緒に保存されます。

あとは下の「最初の設定」を済ませ、Obsidianで取り込む論文を選べばOKです。

参考：[Zotero公式ガイド](https://www.zotero.org/support/quick_start_guide#capturing_items) · [Chrome拡張機能の公式ヘルプ](https://support.google.com/chrome_webstore/answer/2664769?hl=ja)

## 最初の設定

1. Zoteroを起動し、**設定 → 詳細** で他のアプリケーションとの通信を許可します。
2. Obsidianの **設定 → Zotero Paper Import** を開き、「Zotero：接続済み」を確認します。
3. **文献の親フォルダ** を選びます。例えば `文献` を選ぶと、論文は `文献/未整理` に入ります。

## 使い方

⌘P（WindowsはCtrl＋P）で **「Zoteroから論文を取り込む」** を実行します。

| やりたいこと | 操作 |
| --- | --- |
| 論文を取り込む | 「取り込み」タブで論文を押す |
| 未整理の論文を分類する | 「整理」タブで論文を押す |
| 分類先を直す | 「整理結果」から「分類先を変更」 |
| 既存ノートをZoteroと紐づける | 設定の「キーを補完」 |

選んだ論文はバックグラウンドで順番に処理します。画面を閉じても続きます。ノート内のPDFリンクから、保存したPDFを開けます。

**要旨は初期設定で日本語に翻訳し、原文もノートに残します。** 設定で使用するAIを選び、画面の導入・ログイン案内に従ってください。翻訳にはAIの利用枠を消費します。AIなしで取り込む場合は「要旨を日本語に翻訳」をオフにし、命名方式を「著者名＋年」にしてください。

---

[詳しい使い方](docs/README.ja.md) · [インストールで困ったら](docs/INSTALL.md) · [不具合を報告](https://github.com/edoaki/zotero-paper-import/issues)

[開発者向け](docs/DEVELOPMENT.md) · MITライセンス · Zotero・Obsidianの非公式プラグイン
