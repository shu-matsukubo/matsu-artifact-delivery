# Plugin の作成・修正

## 進め方

1. 依頼に関係する Plugin の manifest、README、skills、MCP、契約テスト、生成手順を確認する。
2. 変更する正本と生成物を特定し、Agent Plugins / Agent Skills の標準と既存の責務境界に沿って実装する。
3. 利用者向けの操作は Plugin の README、設計・開発の詳細は `docs/`、再利用する Codex 手順は `.agents/skills/` に置く。
4. 参照資料・テンプレートは必要な skill の直下へ置き、`SKILL.md` から相対リンクする。
5. 変更に合う検証を選び、実施した内容と未確認事項を報告する。

## 実装基準

- Skill は具体的な利用者の目的に絞り、`name` と適用条件が明確な `description` を付ける。
- `SKILL.md` には適用条件・要点・読み込む資料だけを置く。詳細な判断基準は `references/`、繰り返し提示・コピーする提案文は `assets/` に分ける。
- MCP はライブデータ・認証・制御された操作を担当し、Skill は手順・判断・出力を担当する。
- portable manifest を正本とし、Codex 互換 manifest は既存の同期手順で生成する。生成物だけを手編集しない。
- 既存契約・配布時の参照解決・失敗時の扱いまで変更影響を確認する。

## 開発資料

- [製造・レビュー観点](../../../../docs/manufacturing-review.md)
- [テスト・検証観点](../../../../docs/testing-review.md)
- [試験と差分 CI](../../../../docs/testing.md)
- [配布と更新](../../../../docs/distribution.md)
- [Agent Plugins Specification](https://agent-plugins.org/specification)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Codex skill guide](https://developers.openai.com/codex/skills)

Read only the material that applies to the requested change.
