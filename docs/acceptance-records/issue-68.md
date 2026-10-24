# Issue #68 実モデル受け入れ記録

この文書は 2026-10-24 の明示起動試験の履歴である。通常手順は[実モデル受け入れ手順](../model-acceptance.md)を参照する。

## 対象と環境

- 起点 SHA: `3b75e6ca25ccf7420940dd9c4feeb67a01b86716`。この起点に本 Issue の README と明示入力例の文書変更を適用した作業ツリーを使用。Skill・MCP・manifest は起点と同一。
- README の SHA-256: `c1c3f352294625fd2f4d2a5ea0e3be572b66b7e878ee2e9e31d28a008700aaf6`。導入済み cache の README と作業ツリーの内容一致を確認。
- Windows x64、Codex CLI / App Server `0.163.0-alpha.11.2`。同じ実行ファイルから experimental JSON schema を生成し、実際の request field を確認。
- `artifact-workflow 0.5.0` のみを空の一時ホームへ `plugin/install` で導入。`expert-escalation` は未導入。版は実 cache の `.codex-plugin/plugin.json` と正本 manifest で照合。
- 実効設定: model `gpt-6-sol`、reasoning effort `xhigh`、approval policy `on-request`、reviewer `auto_review`、`activePermissionProfile.id` `:workspace`。`thread/start` response で確認。
- 試験ルート: `C:/Users/docha/AppData/Local/Temp/matsu-issue68-acceptance-UvkjXq/`。home、空の work、logs を分離し、実ユーザーの設定・cache・計画は変更していない。
- ユーザーの明示許可に基づき認証を一時コピーして使用し、終了時に削除した。認証値・非公開推論は検証用ログ・本記録へ含めていない。

## 操作と入力

README の App Server 向け明示指定を実行した。`skills/list` に空の work と `forceReload:true` を渡し、次の値を取得した。

- 正式名: `artifact-workflow:artifact-workflow`
- 表示名: `成果物生成ワークフロー`
- 有効状態: `enabled:true`
- 本文パス: `<試験ルート>/home/plugins/cache/matsu-artifact-delivery/artifact-workflow/0.5.0/skills/artifact-workflow/SKILL.md`

事前確認用 thread `01a16db3-8a8f-75c1-96c9-05c0c169b3af` では work 内の `preflight.txt` に `ok` を書き込み、読み取り後に同じファイルを削除した（exit 0、`read=ok`、`exists_after=False`）。MCP の `get_plan({sessionId:"issue68-preflight"})` は `session:null` を返した。事前確認後に work が空であることを確認して、別の新規 thread で本試験を開始した。

`turn/start` の text input は README と同じ次の一文とし、同じ input 配列へ `skills/list` で得た正式名と絶対パスの `skill` item を付けた。計画の承認・承認省略は入力していない。

```text
新入社員向けの案内文を Markdown で1ページ作成してください。
```

## 観測結果

- 親 thread: `01a16db3-e151-79e3-895b-e2c7d9ea7111`、turn: `01a16db3-e1b2-7be1-afe5-98b08abb29ce`。
- 本文読込 event `exec-7a5b9201-e756-477b-a0d8-c5819ba5ff59` は実 cache の `SKILL.md`、承認・計画管理等の Reference、役割別 Skill を `Get-Content` で読み、exit 0。計画 Skill の Reference・Asset も別の read event で読めた。
- 親が UUID `e519debb-dd8d-477b-a3e6-7b4fd7e83a26` を発行し、`initialize_session` を1回実行。event `exec-f785a667-9d5f-4d09-955e-702fddafa157` は `completed` で、`plan:null`、`completedAt:null` を返した。
- 計画は Markdown 1ページの新入社員向け案内文を成果物とし、作成タスク T1、記載項目、未提供情報の記入欄化、独立レビュー・検証を提示した。
- 最終応答は「この計画で進めてよければ『承認』とお知らせください」として停止。承認前の生成、worker / reviewer の起動、`save_plan`、`complete_session` はなかった。
- `turn/completed` 通知後に別 request の `thread/read(includeTurns:true)` で対象 turn を取得し、status `completed` を確認。非公開推論を除く `item/started` と `item/completed` は各9件で ID 集合が一致し、取得した turn も同じ9件だった。
- MCP の保存ファイルは隔離 home の `plugins/data/agent-plugins/<id>/task-memory/` 内にあり、`plan:null`、`completedAt:null`。試験終了時の work は空で、成果物ファイルは存在しなかった。

証跡は試験ルートの `logs/discovery.json`、`logs/preflight.json`、`logs/events.jsonl`、`logs/result.json` に一時保存した。events は必要な request/response、本文 read・MCP・公開応答・完了通知に限定し、非公開推論 item は除外した。raw log や認証ファイルはリポジトリに追加していない。

## 確認範囲

Workflow 単独導入の新規タスクで、README の正式な Skill 入力から本文読込、新規初期化、計画提示、承認前停止までを確認した。`allow_implicit_invocation:false` は維持している。

CLI / IDE の `$` メニューおよび desktop の Skill セレクターの画面操作は直接試験していない。操作案内は[公式 Skill ガイド](https://learn.chatgpt.com/docs/build-skills)と[App Server の Skill 入力](https://learn.chatgpt.com/docs/app-server#skills)で確認した。承認後の生成・レビュー・引き渡しは本試験の対象外である。

関連検証: `npm run test:workflow`（単体45件・E2E 4件）、`npm run check:manifests`、`git diff --check` は成功。
