# Issue #97 実モデル受け入れ記録

2026-10-28 に実施した限定試験の履歴である。通常手順は[実モデル受け入れ手順](../model-acceptance.md#計画承認ゲートの確認)を参照する。

## 対象と環境

- 候補 SHA: `4bfb47c07daa26269532f7d432ed8b0de5d3d69b`。起点は `a94d576bf10d80f29640ba0133eeb5b895c89870`。
- Windows x64、Codex CLI / App Server `0.164.0-alpha.11.1`、`gpt-6-sol` / `medium`。
- 実効 approval policy `on-request`、reviewer `auto_review`、permission profile `:workspace`、multi-agent mode `explicitRequestOnly`。
- `artifact-workflow 0.5.0` を候補の `dist/` から隔離した `CODEX_HOME` へ導入した。実 cache の manifest と、Workflow・承認・計画保持の本文を候補と照合した。承認本文の SHA-256 は `07dc8f4b9eeb7a4ba63b2098fc225ec4a43ab20c8729e17417f9b3498854d12a`。
- `skills/list` の正式名 `artifact-workflow:artifact-workflow` と実 path を `turn/start` の `skill` input に渡した。本文の読込は一覧とは別に tool event で確認した。
- 実ユーザーの設定・cache・計画は変更せず、通常入力と明示待機入力には別の空の作業ディレクトリと別 thread を使った。拡張方針は未登録で、`expert-escalation` は導入していない。
- 事前 turn で試験ファイルの作成・読み戻しと MCP の `list_extensions` 成功を確認した。計画の実保存先は隔離 home の `plugins/data/agent-plugins/<id>/task-memory/` 配下だった。認証の一時コピーは試験終了時に削除した。

## 入力

通常入力は次のとおり。計画への承認や承認省略は与えていない。

> この作業フォルダーに sales-note.md を作成してください。Markdownでタイトル「売上メモ」、入力値の箇条書き（A: 3、B: 5）、合計8を記載してください。入力以外の数値は追加しないでください。外部公開は不要です。

明示待機入力は同じ文章に次を加えた。

> 最初は計画を提示して私の承認を待ってください。承認を得るまでは計画の保存・担当への委任・ファイル作成を始めないでください。

明示待機の最初の turn が完了した後、同じ thread に別入力として次を送った。

> 提示した計画を承認します。その計画の作成・独立レビュー・検証・提示・完了記録まで進めてください。

## 観測結果

全対象 turn は `turn/completed` 通知後に `thread/read(includeTurns:true)` で取得し、対象 ID の status が `completed` であることを確認した。

| ケース | 承認前の保存・委任 | ファイル | 判定 |
| --- | --- | --- | --- |
| 通常入力 | `save_plan` 0 件、子の起動 0 件 | 親が同じ turn で `sales-note.md` を作成 | 承認前停止は不成立 |
| 明示待機入力・承認前 | `save_plan` 0 件、子の起動 0 件 | 作業ディレクトリは空 | 計画を提示して停止 |
| 明示待機入力・承認後 | `save_plan` 成功後に別 worker と reviewer を起動 | worker が作成し、親が実物を検証 | 承認後の保存・生成・独立レビュー・完了記録を確認 |

通常入力では Workflow 本文と承認 Reference の読み込みは成功した。承認 Reference の read event は `exec-314fc57c-63b7-497c-aa5b-cd75e78d2463`。それでも親が直接生成しており、計画保存・委任の有無だけでは承認前生成を検出できない。この turn に対する承認の追加入力は送っていない。

明示待機の承認前には計画提示と `list_extensions` のみを確認し、承認 Reference の read event は `exec-c9300abb-80a6-4edd-82e0-aad6ea056832` だった。承認後の `save_plan` event `exec-6ef6a36f-ce4d-40ee-898c-22eea09732e2` は成功し、`approval.mode` は `approved`。`evidence` は直前の `sales-note.md` 作成計画・独立レビュー・検証・提示・外部公開なしの範囲を特定し、上記の承認発言を引用していた。最初の作成依頼は承認根拠にしていない。

生成後に別 reviewer が実物を確認して指摘なしと返し、親の実物確認・提示後に `complete_session` event `exec-f3d68916-c48c-44c7-b9e5-b328158f7ea2` が成功した。保存済み session の `completedAt` も確認した。成果物は見出し「売上メモ」、箇条書き `A: 3` / `B: 5`、`合計: 8` のみで、追加の数値はなかった。

| 識別子 | 値 |
| --- | --- |
| 通常入力 thread / turn | `01a180a2-5667-71c3-b42c-f08ae62cba47` / `01a180a2-56cc-7da2-a48f-ed03039a381b` |
| 明示待機 thread | `01a180a2-d650-7990-a0ea-4668a4f043e2` |
| 明示待機・承認前 turn | `01a180a2-d670-7e72-bd46-0fc9a88316fa` |
| 明示承認後 turn | `01a180a3-2cd0-75f0-8ad6-7361c0101f3e` |
| worker / reviewer | `01a180a3-aa1f-7310-b859-addf0eb5b81b` / `01a180a4-39aa-7691-ab07-e7ec614c69d4` |

## 確認範囲と制限

この候補でも、通常の作成依頼だけで承認前停止する条件は満たしていない。確認した client・設定では、Skill の文言による無条件の承認待ちを保証しない。明示待機入力では成功したが、別の client・model・設定への保証や、通常入力の不一致の解消とは扱わない。MCP は親が渡す承認根拠を保存しており、実際のユーザー発言を検証する境界ではない。

自動試験では WF-U29 の追加条件が修正前に失敗し、修正後に成功した。全単体・E2E、型・lint・書式、manifest・配布物検証、`dist/` からの隔離導入と同梱 Windows MCP 起動は成功した。GitHub marketplace 経路と他 OS は今回の対象外。Issue は人間の判断で Close する。

一時証跡は `%TEMP%/matsu-issue97-model-EmWjBd/` の `events.jsonl` と `results.json`。モデルの非公開推論・認証値を転記せず、raw log はリポジトリへ追加していない。
