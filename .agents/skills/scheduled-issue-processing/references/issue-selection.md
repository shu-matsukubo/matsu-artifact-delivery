# 新規 Issue の選定

1. GitHub Plugin でリポジトリの Open PR を確認する。ブランチ名が `/scheduled/issue/<Issue 番号>` で終わる Open PR があれば、新しい Issue を選ばず、レビュー待ちとして終了する。
2. 新規 Issue の選択前に、スケジューラ専用のローカル作業ディレクトリで `git status --porcelain=v1 --untracked-files=all` を実行し、staged、unstaged、untracked file がなく clean であることを確認する。確認に失敗した場合は停止する。差分があれば、[変更の保全](resume.md#変更の保全)に従い、作業ディレクトリが clean ではないため人間による確認が必要と報告して終了する。この条件は新規開始に適用し、再開判定で正当に特定した再開作業には適用しない。
3. GitHub Plugin で `AI処理可能` ラベル付きの Open Issue を取得し、プラグインの新規作成・修正に該当する候補だけを対象にする。インフラ、CI、リポジトリ文書のみの Issue は対象外とする。
   - 候補に関連付けられた実装 PR を、ブランチ名にかかわらず確認する。
   - Open の実装 PR がある候補と、default branch へ merge 済みの実装 PR があり人間の Close 待ちの候補は除外する。
   - 残る候補の内容、優先度、依存関係、実装可能性を判断して一件選ぶ。固定の priority ラベルは要求しない。対象 Issue がない場合は終了する。
