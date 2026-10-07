---
name: scheduled-issue-processing
description: スケジューラがこの Skill を明示指定した場合のみ、GitHub の「AI処理可能」Issue を処理する。通常の Issue 対応や一般的な開発作業には使用しない。
---

# 定期 Issue 処理

スケジューラから Skill 名を直接指定して起動する。通常の Issue 対応や一般的な開発作業では使用しない。このスキルは処理順と停止条件だけを調整し、実装とレビューは既存の担当に委ねる。

Codex のスケジューラ / オートメーションから同一スレッドで繰り返し実行する。人間が普段操作するリポジトリとは別の、スケジューラ専用 clone / 作業ディレクトリを使う。

前回作業の特定には、同一スレッドの過去の会話・実行ログ、前回実行時の結果や中断内容、利用可能な Memory 等を補助情報として参照する。これらは状態の正本ではなく、過去ログや Memory 等が利用できないこと自体をエラーや停止理由にしない。GitHub とローカル workspace の現在状態を最終的な判断材料とする。独自の状態ファイルやチェックポイントファイル（リポジトリ外、`.codex/runtime`、Issue 処理専用の JSON / YAML、前回ステップ番号等）は作成・永続化しない。実行結果や中断内容は同一スレッドで報告する。

## 手順

1. GitHub Plugin の利用可否と、対象リポジトリ・Issue・PR・ブランチの読み取り、ブランチへの変更反映、PR 作成に必要な capability と権限を確認する。GitHub Plugin が使えない、または必要な read/write capability が不足している場合は、処理を開始せず、Plugin の導入または権限設定が必要と報告して終了する。
2. 新規 Issue の処理より前に、利用可能な補助情報と、GitHub Plugin で取得した Issue・PR・branch・commit、ローカル HEAD・branch・worktree・staged / unstaged / untracked の現在状態を照合し、未完了作業の有無を確認する。
   - 制限到達、エラー、その他の中断による未完了作業について、過去ログ等と現在状態から対応する Open Issue、branch、workspace および差分の対応を安全に一意に特定できる場合は、新しい Issue を選ばず、現在状態で確認できた未完了の段階から再開する。再開対象として確認できた既存ブランチのみ再利用し、その作業によるローカル変更を利用する。現在状態から確認できる base branch・起点 SHA と既存の作業ツリーを引き継ぐ。現在の差分に対する検証・レビュー完了を確認できなければ手順 9〜10 へ戻す。対応する Open PR 作成済みで、PR の base・head およびリモートに反映された差分が検証・レビュー済みの作業と一致する場合は、レビュー待ちとして終了する。
   - 前回作業を一意に特定できない場合はローカル workspace の staged / unstaged / untracked を確認する。clean なら未完了作業なしとして手順 3 へ進む。変更がある場合は由来を推測せず、人間による確認が必要と報告して停止する。
3. GitHub Plugin でリポジトリの Open PR を確認する。ブランチ名が `/scheduled/issue/<Issue 番号>` で終わる Open PR があれば、レビュー待ちとして終了する。
4. 新規 Issue の選択前に、スケジューラ専用のローカル作業ディレクトリで `git status --porcelain=v1 --untracked-files=all` を実行し、staged、unstaged、untracked file がなく clean であることを確認する。確認に失敗した場合は停止し、差分があれば作業ディレクトリが clean ではないため人間による確認が必要と報告して終了する。この条件は新規開始に適用し、手順 2 で正当に特定した再開作業には適用しない。
5. GitHub Plugin で `AI処理可能` ラベル付きの Open Issue を取得し、プラグインの新規作成・修正に該当する候補だけを対象にする。インフラ、CI、リポジトリ文書のみの Issue は対象外とする。候補に関連付けられた実装 PR を、ブランチ名にかかわらず確認する。Open の実装 PR がある候補と、default branch へ merge 済みの実装 PR があり人間の Close 待ちの候補は除外する。残る候補の内容、優先度、依存関係、実装可能性を判断して一件選ぶ。固定の priority ラベルは要求しない。
6. GitHub Plugin でリポジトリの default branch とその最新コミット SHA を取得する。Codex のユーザー設定にあるブランチ prefix を使い、末尾の `/` を除いて `<prefix>/scheduled/issue/<Issue 番号>` 形式のブランチ名を決める。prefix が設定から取得できない場合は `codex` を使う。
7. 取得したコミット SHA と一致する新しい隔離作業ツリーを用意する。新規開始では前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない。指定 SHA を基点にした作業ツリーを用意できない場合は停止し、環境の準備が必要と報告する。
8. GitHub Plugin で同名のリモートブランチが存在しないことを確認し、取得した SHA から作成する。新規処理で同名ブランチが既にある場合は再利用・上書きせず停止して状況を報告する。
9. `.codex/agents/issue-implementer.toml` の担当エージェントに実装を委譲する。担当エージェントは `plugin-maintenance` Skill を使い、GPT-6 Luna / reasoning medium で実装と検証を行う。
10. 親エージェントは `plugin-review` Skill を使い、GPT-6.1 Sol / reasoning xhigh で変更をレビューする。指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す。
11. 検証・レビュー済みの差分から、GitHub Plugin が提供するコミット・Git object 等の適切な機能でコミットを作成し、ref 更新等で Issue 用リモートブランチへ反映する。`git push` は使用しない。反映機能または権限が不足している場合は停止し、Plugin の導入または権限設定が必要と報告する。
12. GitHub Plugin でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致し、その差分がレビュー済みの差分と一致することを確認してから、Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。実行結果を同一スレッドで報告して終了する。

## 停止条件

- 対象となる Open PR がある場合、新しい Issue を選ばず終了する。
- 対象 Issue がない場合は終了する。
- 異常状態は自動修復しない。`reset`、変更破棄のための `checkout` / `restore`、`stash`、`clean`、未追跡ファイルの削除、その他既存のローカル変更を失わせる操作は行わない。
- GitHub Plugin が利用できない、必要な read/write capability がない、または GitHub 上の状態を確認・更新できない場合は、git、`gh`、ブラウザー等へフォールバックせず停止する。Plugin の導入または権限設定が必要であることを報告する。
- GitHub 上のレビュー済み変更を確認できない場合は PR を作成しない。
- 状態管理用のラベルは追加しない。Open PR の有無をレビュー待ち状態として扱う。
