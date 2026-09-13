# Zotero Paper Import

Zoteroの論文を、ノートとPDFのセットでObsidianに保存するプラグインです。AIで論文名を付けたり、分類フォルダへ整理したりできます。

## [⬇ インストール用ZIPをダウンロード（0.3.0）](https://github.com/edoaki/zotero-paper-import/releases/download/0.3.0/zotero-paper-import-0.3.0.zip?download=1)

Obsidian **1.13.4以上**・Zotero **10以上**が必要です。Macで動作確認済み、Windowsは未検証です。

## 入れ方

1. 上のZIPを展開します。`zotero-paper-import` フォルダができます。
2. Obsidianの **設定 → コミュニティプラグイン** で、「インストールされたプラグイン」付近の **フォルダアイコン** を押します。
3. 開いたFinder（Windowsではエクスプローラー）に、`zotero-paper-import` フォルダを丸ごとコピーします。
4. Obsidianを再起動し、コミュニティプラグインの一覧で **Zotero Paper Import** をオンにします。

コピー後に `plugins/zotero-paper-import/main.js` があれば正しい配置です。

既に入れている人は [更新手順](docs/INSTALL.md#更新) を使ってください。

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

**AIを使う場合**は、設定でCodexなどのAIを選び、画面の導入・ログイン案内に従ってください。通常の取り込みはAIなしでも使えます。

---

[詳しい使い方](docs/README.ja.md) · [インストールで困ったら](docs/INSTALL.md) · [不具合を報告](https://github.com/edoaki/zotero-paper-import/issues)

[開発者向け](docs/DEVELOPMENT.md) · MITライセンス · Zotero・Obsidianの非公式プラグイン
