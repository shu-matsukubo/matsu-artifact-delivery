# 実装とレビューの調整

1. [`.codex/agents/issue-implementer.toml`](../../../../.codex/agents/issue-implementer.toml) の担当エージェントに実装を委譲する。担当エージェントは [plugin-maintenance](../../plugin-maintenance/SKILL.md) Skill を使い、GPT-6 Luna / reasoning medium で実装と検証を行う。
2. 親エージェントは [plugin-review](../../plugin-review/SKILL.md) Skill を使い、GPT-6.1 Sol / reasoning xhigh で変更をレビューする。
3. 指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す。
