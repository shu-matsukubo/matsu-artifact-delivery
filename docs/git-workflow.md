# Git と GitHub の操作

## 共通の安全条件

- Git 操作は通常の Git CLI を使う。GitHub 操作は必要な機能と権限を確認し、利用可能なら GitHub Plugin を優先し、利用できない操作は `gh` を使う。どちらも利用できない、権限が足りない、または結果を確認できない場合は停止して不足事項を報告する。
- 作業開始時に branch、remote、staged / unstaged / untracked の差分を確認し、既存変更を保全する。競合や不明な状態では停止して利用者へ報告する。
- 検証・レビュー済みのパスだけをステージ・コミットし、コミット後に対象差分と照合する。
- Push 前に `git remote get-url --push --all <remote>` の URL が一件だけで、対象リポジトリと一致することを確認する。Push 先が作業 branch と一致すると確認できた場合だけ、branch を明示して Push する。
- 保護ブランチへの直接コミット・Push・マージ、強制 Push、branch・tag の削除、既存変更を失わせる操作を行わない。判断できない場合は停止して利用者へ報告する。
- GitHub への書き込み結果が不明な場合は状態を再取得する。成功を確認できない場合は停止してエラーと不足事項を利用者へ報告する。

Issue 対応の branch・worktree の準備と再開は [Issue 開発 Workflow](../.agents/skills/issue-development-workflow/SKILL.md) の各 Reference に従う。Issue 固有のコミット、Push、PR 作成条件は [GitHub 反映と PR 作成](../.agents/skills/issue-development-workflow/references/publish-pr.md)を参照する。

権限は実行環境の承認設定と GitHub のブランチ保護で管理する。この資料は作業判断の基準を示す。
