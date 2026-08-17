<p align="center">
  <a href="../../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · 日本語 · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a>
</p>

<a href="https://www.youtube.com/watch?v=5AWoGo-L16I" target="_blank" rel="noopener noreferrer">
  <img width="1339" height="607" alt="rowboat-github-2" src="../../assets/readme-dark/hero-video.png" />
</a>

<h5 align="center">

<h1 align="center">Rowboat</h1>
<p align="center">あなたの仕事の記憶を持ち、それをもとに行動するための作業サーフェスを内蔵した、デスクトップ AI コワーカー。</p>

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs/rowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
    <a href="https://www.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://discord.gg/wajrgmJQ6b" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>

</h5>

Rowboat はあなたの仕事を生きたナレッジグラフとしてインデックス化し、それを活用してあなたのマシン上で仕事をこなします。AI と協働するための作業サーフェスとして、メールクライアント、ノート、ブラウザ、コードモード、会議ノートテイカー、そしてプロジェクトごとのワークスペースを備えています。


Mac/Windows/Linux 向け最新版のダウンロード: [ダウンロード](https://www.rowboatlabs.com/downloads)

<p align="center">
<a href="https://www.youtube.com/watch?v=et5yQABJ3xI">
<img width="800" height="450" alt="Rowboat Apps to Code demo" src="../../apps/x/demo.gif" />
</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=et5yQABJ3xI"> デモ - アプリからコードへ </a> · <a href="https://www.youtube.com/watch?v=7xTpciZCfpw"> デモ - ナレッジグラフ</a>
</p>


⭐ Rowboat が役に立ったら、ぜひリポジトリにスターを付けてください。より多くの人に見つけてもらう助けになります。

---
## 概要

<table>
<tr>
<td width="40%" valign="middle">
<h3>ブレイン</h3>
Rowboat はメール、会議、Slack、アシスタントとの会話を、Obsidian スタイルのバックリンクでつながった生きたナレッジグラフとしてインデックス化します。
</td>
<td width="60%">
<img width="1502" height="939" alt="Brain graph screenshot" src="../../assets/readme-dark/brain.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>メール</h3>
内蔵のメールクライアントが、メールを「重要」と「それ以外」に自動で仕分けます。重要なメールに対しては、Rowboat が仕事のコンテキストをすべて活用して返信の下書きを自動作成します。
</td>
<td width="60%">
<img width="1512" height="948" alt="Email screenshot" src="../../assets/readme-dark/email.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>バックグラウンドエージェント</h3>
新着メールなどのイベントをトリガーに、あるいは毎日午前 8 時のようなスケジュールで動作するバックグラウンドエージェントを設定できます。エージェントはツールに接続し、Web を検索し、ブラウザを操作し、Claude Code や Codex を使ってコードを書くことができます。
</td>
<td width="60%">
<img width="1512" height="951" alt="Background agents screenshot" src="../../assets/readme-dark/background-agents.png" />

</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>内蔵ブラウザ</h3>
Rowboat には、あなたとアシスタントが Web 上のタスクで協働できるブラウザが内蔵されています。メインのブラウザから隔離されているため、アシスタントにアクセスさせたいアカウントだけにログインできます。
</td>
<td width="60%">
<img width="1512" height="948" alt="Browser screenshot" src="../../assets/readme-dark/browser.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>会議ノート</h3>
マイクとスピーカーの音声を取り込み、ライブの文字起こしを生成し、会議の内容を Markdown ファイルに要約してナレッジグラフを更新する、ローカル動作の会議ノートテイカーです。
</td>
<td width="60%">
<img width="1512" height="947" alt="Meeting notes screenshot" src="../../assets/readme-dark/meeting-notes.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>コードモード</h3>
コードモードでは、Claude Code や Codex を使って複数のコーディングエージェントを並列に立ち上げ、必要に応じて Rowboat が仕事のコンテキストをすべて携えてそれらを指揮します。
</td>
<td width="60%">
<img width="1512" height="949" alt="Code mode screenshot" src="../../assets/readme-dark/code-mode.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>アプリ</h3>
Rowboat の中に独自の作業サーフェスを構築できます。作成したアプリはすべてのツールと連携機能にアクセスでき、他の人と共有することもできます。
</td>
<td width="60%">
<img width="1512" height="949" alt="Apps screenshot" src="../../assets/readme-dark/apps.png" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>連携機能</h3>
人気の高い各種プロダクトとのワンクリック連携を備えています。
</td>
<td width="60%">
<img width="1512" height="948" alt="Integrations screenshot" src="../../assets/readme-dark/integrations.png" />
</td>
</tr>

</table>

---

## インストール

**Mac/Windows/Linux 向け最新版のダウンロード:** [ダウンロード](https://www.rowboatlabs.com/downloads)

**すべてのリリースファイル:**   https://github.com/rowboatlabs/rowboat/releases/latest

### Google のセットアップ
Google サービス（Gmail、カレンダー、ドライブ）に接続するには、[Google のセットアップ](https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md)に従ってください。

### 音声入力
音声入力とボイスノートを有効にするには（任意）、`~/.rowboat/config/deepgram.json` に Deepgram の API キーを追加してください。

### 音声出力

音声出力を有効にするには（任意）、`~/.rowboat/config/elevenlabs.json` に ElevenLabs の API キーを追加してください。

### Web 検索

Exa のリサーチ検索を利用するには（任意）、`~/.rowboat/config/exa-search.json` に Exa の API キーを追加してください。

### 外部ツール

外部ツールを有効にするには（任意）、任意の MCP サーバーを追加するか、`~/.rowboat/config/composio.json` に API キーを追加して Composio のツールを利用できます。

すべての API キーファイルは同じ形式です:
```
{
  "apiKey": "<key>"
}
```


## 何が違うのか

多くの AI ツールは、トランスクリプトやドキュメントを検索して、その都度コンテキストを再構築します。

Rowboat はその代わりに、**長期的に維持されるナレッジ**を保持します:
- コンテキストは時間とともに蓄積される
- 関係性は明示的で、いつでも確認できる
- ノートはモデルの中に隠されるのではなく、あなた自身が編集できる
- すべてがプレーンな Markdown としてあなたのマシン上に存在する

その結果得られるのは、毎回ゼロから始まる検索ではなく、複利のように積み上がる記憶です。

## 好みのモデルを持ち込む

Rowboat はあなたの好みのモデル構成で動作します:
- Ollama や LM Studio 経由の**ローカルモデル**
- **ホスト型モデル**（お手持ちの API キー/プロバイダーを利用）
- モデルはいつでも切り替え可能 — データはローカルの Markdown ボルトに保持されます

## ツールで Rowboat を拡張（MCP）

Rowboat は **Model Context Protocol（MCP）** を介して外部のツールやサービスに接続できます。
つまり、検索、データベース、CRM、サポートツール、自動化など（一例です）、あるいは社内の独自ツールも接続できます。

例: Exa（Web 検索）、Twitter/X、ElevenLabs（音声）、Slack、Linear/Jira、GitHub など。

## 設計思想としてのローカルファースト

- すべてのデータはプレーンな Markdown としてローカルに保存されます
- 独自形式やホスティングによるロックインはありません
- すべてをいつでも確認、編集、バックアップ、削除できます

---
<div align="center">

[Discord](https://discord.gg/wajrgmJQ6b) · [Twitter](https://x.com/intent/user?screen_name=rowboatlabshq)
</div>
