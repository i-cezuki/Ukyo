# Ukyo — 日本株専門の財務リサーチエージェント

Ukyo は、日本株の分析に特化した自律型リサーチエージェントです。[J-Quants](https://jpx-jquants.com/ja#pricing) V2 API と LLM（大規模言語モデル）を組み合わせて、東証上場銘柄の株価・財務・決算予定・信用取引・投資部門別動向・IR 書類などを日本語で調べることができます。

<img width="1118" height="574" alt="Ukyo のターミナルデモ（トヨタとホンダの比較）" src=".github/assets/ukyo-readme-demo.png" />

## 目次

- [概要](#概要)
- [必要な環境](#必要な環境)
- [セットアップ](#セットアップ)
- [起動方法](#起動方法)
- [使い方の例](#使い方の例)
- [評価の実行](#評価の実行)
- [デバッグ](#デバッグ)
- [WhatsApp 連携](#whatsapp-連携)
- [コントリビュート](#コントリビュート)
- [ライセンス](#ライセンス)

## 概要

Ukyo は、複雑な日本株に関する質問を実行可能な調査ステップに分解しながら進めます。単に数値を返すだけでなく、株価・財務・投資指標・信用需給・投資家動向・IR 資料といった複数の情報源を横断して、根拠付きの日本語回答をまとめます。

**主な機能:**

- **日本株データの取得** — J-Quants V2 API から株価・財務サマリー・決算予定・信用取引・投資部門別情報を取得
- **日本語に最適化された表示** — `1兆円` / `1000億円` のような金額表記、`YYYY/MM/DD` 形式の日付表示
- **銘柄の自動解決** — 会社名・証券コード・よく使われる略称から東証コードを特定
- **IR 調査の支援** — EDINET / TDnet / 公式 IR ページを優先した書類検索と読み方のガイド
- **エージェント型の調査** — タスクの分解、自己検証、ツール選択による段階的なリサーチ

## 必要な環境

- [Bun](https://bun.sh) 1.0 以上
- [J-Quants](https://jpx-jquants.com/ja#pricing) API アカウント
  - **Premium プラン（推奨）**: Ukyo の全機能を利用できます
  - **Standard / Light プラン**: 株価・上場銘柄一覧・財務サマリー・決算予定・信用取引など一部機能が利用可能
  - **Free プラン**: 直近 12 週間を除く遅延データが中心のため、動作確認用途に限られます
- LLM の API キー（いずれか 1 つ以上）
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GOOGLE_API_KEY`
  - `XAI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `MOONSHOT_API_KEY`
  - `DEEPSEEK_API_KEY`
- `EXASEARCH_API_KEY`（任意・推奨）
  - IR 資料や大量保有報告書の調査精度が向上します

### Bun のインストール

Bun が未インストールの場合は、以下のコマンドでインストールできます。

**macOS / Linux**

```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows**

```bash
powershell -c "irm bun.sh/install.ps1|iex"
```

インストール後の確認:

```bash
bun --version
```

## セットアップ

1. リポジトリをクローンして、プロジェクトディレクトリに移動します。

```bash
git clone <your-repo-url>
cd Ukyo
```

2. 依存パッケージをインストールします。

```bash
bun install
```

3. 環境変数ファイルをコピーして、使用する API キーを設定します。

```bash
cp env.example .env
```

最小構成の例:

```bash
OPENAI_API_KEY=your-openai-api-key
JQUANTS_API_KEY=your-jquants-api-key
EXASEARCH_API_KEY=your-exa-api-key
```

J-Quants の API キーは [J-Quants ダッシュボード](https://jpx-jquants.com/dashboard/menu/) の V2 API 設定から取得してください。

## 起動方法

対話モードで起動:

```bash
bun start
```

ファイル監視付きで開発する場合:

```bash
bun dev
```

## 使い方の例

```text
トヨタ(7203)の最新株価を教えて
キーエンス(6861)のPBRと配当利回りを計算して
ソニーグループの直近4期の財務推移を要約して
信用倍率が高い銘柄のリスクを説明して
外国人投資家の最近の売買動向を教えて
この会社のIR資料を読むときに注目すべき論点を整理して
あなたは誰ですか？
```

## 評価の実行

評価ランナーを使ってテストできます。

```bash
bun run src/evals/run.ts
```

ランダムサンプルで実行する場合:

```bash
bun run src/evals/run.ts --sample 10
```

LangSmith を使う場合は `.env` に `LANGSMITH_API_KEY` を設定してください。

## デバッグ

Ukyo は各クエリのツール呼び出しを `.dexter/scratchpad/` に JSONL 形式で保存します。調査の流れや取得データを追いたいときに便利です。

**保存先**

```text
.dexter/scratchpad/
├── 2026-01-30-111400_9a8f10723f79.jsonl
├── 2026-01-30-143022_a1b2c3d4e5f6.jsonl
└── ...
```

各エントリには以下の情報が含まれます。

- `init` — 元の質問
- `tool_result` — ツール呼び出し、引数、結果、要約
- `thinking` — エージェントの途中の思考過程

## WhatsApp 連携

WhatsApp 連携を使うと、チャット経由で Ukyo に質問を送ることができます。

```bash
# QR コードで WhatsApp をリンク
bun run gateway:login

# 連携を起動
bun run gateway
```

詳細は [WhatsApp Gateway README](src/gateway/channels/whatsapp/README.md) を参照してください。

## コントリビュート

1. リポジトリを Fork する
2. フィーチャーブランチを作成する
3. 変更をコミットする
4. ブランチを Push する
5. Pull Request を作成する

PR は小さく、レビューしやすい単位に分けるのがおすすめです。

## ライセンス

MIT License で公開されています。
