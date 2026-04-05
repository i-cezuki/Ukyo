# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |

## Reporting a Vulnerability

セキュリティ上の問題を発見した場合は、**Issue を公開しないでください。**

GitHub の [Private vulnerability reporting](https://github.com/i-cezuki/ukyo/security/advisories/new) から報告してください。

できる限り早く対応します。

## API キーの取り扱い

- `.env` ファイルをリポジトリにコミットしないでください（`.gitignore` で除外済み）
- `JQUANTS_API_KEY` や LLM プロバイダーのキーを公開リポジトリに含めないでください
- キーが漏洩した場合はただちに各サービスのダッシュボードで無効化してください
