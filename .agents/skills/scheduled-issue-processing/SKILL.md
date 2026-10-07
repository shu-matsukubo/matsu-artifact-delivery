---
name: scheduled-issue-processing
description: スケジューラがこの Skill を明示指定した場合のみ、GitHub の「AI処理可能」Issue を処理する。通常の Issue 対応や一般的な開発作業には使用しない。
---

# 定期 Issue 処理

スケジューラから Skill 名を直接指定して起動する。通常の Issue 対応や一般的な開発作業では使用しない。このスキルは処理順と停止条件だけを調整し、実装とレビューは既存の担当に委ねる。

## 手順

1. GitHub Plugin の利用可否と、対象リポジトリ・Issue・PR・ブランチの読み取り、ブランチへの変更反映、PR 作成に必要な capability と権限を確認する。GitHub Plugin が使えない、または必要な read/write capability が不足している場合は、処理を開始せず、Plugin の導入または権限設定が必要と報告して終了する。
2. GitHub Plugin でリポジトリの Open PR を確認する。ブランチ名が `/scheduled/issue/<Issue 番号>` で終わる Open PR があれば、レビュー待ちとして終了する。
3. GitHub Plugin で `AI処理可能` ラベル付きの Open Issue を取得し、プラグインの新規作成・修正に該当する候補だけを対象にする。インフラ、CI、リポジトリ文書のみの Issue は対象外とする。候補に関連付けられた実装 PR を、ブランチ名にかかわらず確認する。Open の実装 PR がある候補と、default branch へ merge 済みの実装 PR があり人間の Close 待ちの候補は除外する。残る候補の内容、優先度、依存関係、実装可能性を判断して一件選ぶ。固定の priority ラベルは要求しない。
4. GitHub Plugin でリポジトリの default branch とその最新コミット SHA を取得する。Codex のユーザー設定にあるブランチ prefix を使い、末尾の `/` を除いて `<prefix>/scheduled/issue/<Issue 番号>` 形式のブランチ名を決める。prefix が設定から取得できない場合は `codex` を使う。
5. 取得したコミット SHA と一致する新しい隔離作業ツリーを用意する。前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない。指定 SHA を基点にした作業ツリーを用意できない場合は停止し、環境の準備が必要と報告する。
6. GitHub Plugin で同名のリモートブランチが存在しないことを確認し、取得した SHA から作成する。同名ブランチが既にある場合は再利用・上書きせず停止して状況を報告する。
7. `.codex/agents/issue-implementer.toml` の担当エージェントに実装を委譲する。担当エージェントは `plugin-maintenance` Skill を使い、GPT-6 Luna / reasoning medium で実装と検証を行う。
8. 親エージェントは `plugin-review` Skill を使い、GPT-6.1 Sol / reasoning xhigh で変更をレビューする。指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す。
9. 検証・レビュー済みの差分から、GitHub Plugin が提供するコミット・Git object 等の適切な機能でコミットを作成する。作成したコミット SHA を記録し、ref 更新等で Issue 用リモートブランチへ反映する。`git push` は使用しない。反映機能または権限が不足している場合は停止し、Plugin の導入または権限設定が必要と報告する。
10. GitHub Plugin でリモートブランチを再取得し、リモートブランチの先端 SHA が記録したコミット SHA と一致し、その差分がレビュー済みの差分と一致することを確認してから、Issue を参照する Open PR を作成する。PR の base は手順 4 の default branch、head は手順 6 の Issue 用ブランチとする。PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。完了結果を記録して終了する。

## 停止条件

- 対象となる Open PR がある場合、新しい Issue を選ばず終了する。
- 対象 Issue がない場合は終了する。
- GitHub Plugin が利用できない、必要な read/write capability がない、または GitHub 上の状態を確認・更新できない場合は、git、`gh`、ブラウザー等へフォールバックせず停止する。Plugin の導入または権限設定が必要であることを報告する。
- GitHub 上のレビュー済み変更を確認できない場合は PR を作成しない。
- 状態管理用のラベルは追加しない。Open PR の有無をレビュー待ち状態として扱う。
