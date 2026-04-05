# Contributing to Ukyo

## 開発環境のセットアップ

```bash
git clone https://github.com/i-cezuki/ukyo.git
cd ukyo
bun install
cp env.example .env
# .env に JQUANTS_API_KEY と LLM プロバイダーのキーを設定
```

## テストの実行

```bash
bun test              # 全テスト
bun test src/tools/finance/   # finance ツールのみ
bun run typecheck     # 型検査
```

## ブランチ戦略

- `main` — 安定版。直接コミット不可
- 機能追加・修正は feature ブランチを切って PR を出す

## Pull Request のガイドライン

- PR を出す前に `bun test` と `bun run typecheck` が pass していることを確認する
- コミットメッセージは `feat:` / `fix:` / `chore:` / `docs:` プレフィックスを使う
- J-Quants V2 API の新しいエンドポイントを使う場合は公式ドキュメントでパスを確認する

## コーディングルール

- `any` 型の使用禁止
- API を呼び出すツールには `sourceUrls` を必ず含める
- 全コードパスで `formatToolResult()` を返す（plain string を返さない）
- 日付計算は JST 基準でミリ秒演算を使う（`setDate(getDate() - N)` は使わない）
- 環境変数は `JQUANTS_API_KEY` を使う（`FINANCIAL_DATASETS_API_KEY` は使わない）

## ライセンス

このプロジェクトへの貢献は [MIT License](LICENSE) に同意したものとみなします。
