# 実装とレビューの調整

1. 対象 Issue、完了条件、作業ツリーと担当範囲を [`.codex/agents/issue-implementer.toml`](../../../../.codex/agents/issue-implementer.toml) の担当エージェントに渡し、担当エージェントに実装を委譲する。担当エージェントは GPT-6 Luna / reasoning medium で実装と検証を行う。
2. プラグインの新規作成・修正に関わる範囲では、担当エージェントは [plugin-maintenance](../../plugin-maintenance/SKILL.md)、親エージェントは [plugin-review](../../plugin-review/SKILL.md) を使う。インフラ、CI、リポジトリ文書のみの範囲では、[AGENTS.md](../../../../AGENTS.md)、[製造・レビュー観点](../../../../docs/manufacturing-review.md)、[テスト・検証観点](../../../../docs/testing-review.md)に従って実装・検証・レビューを行う。
3. 親エージェントは GPT-6.1 Sol / reasoning xhigh でレビューする。対象が混在する場合は対象範囲ごとの手順を適用し、依存先への影響も含めて変更全体をレビューする。
4. 指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す。
