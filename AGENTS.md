# 実装言語と検証

人間・AIが保守する実装、テスト、補助スクリプトはすべて TypeScript（`.ts`）で書く。新規ファイルごとに JavaScript と TypeScript を選ばない。Node.js 22.19.0 以降でスクリプトとルートのテストを直接実行するため、型を消去するだけで実行できる構文を使う。

ビルド・ツールが生成する JavaScript / CJS は許可する。生成物を手編集せず、TypeScript のソースと生成手順を変更する。Git 管理する JavaScript 生成物は `scripts/check-typescript.ts` の明示的な許可一覧で管理し、生成元との一致を検証する。依存と未追跡のビルド出力は Git の除外設定に従う。

共通基盤の変更ではルートの `npm run check`、`npm run lint`、`npm run format:check`、`npm test` を実行する。MCP に関わる変更では `plugins/artifact-workflow` の `check`、`lint`、`format:check` も実行する。手順と対象一覧は [試験と差分 CI](docs/testing.md) を参照する。
