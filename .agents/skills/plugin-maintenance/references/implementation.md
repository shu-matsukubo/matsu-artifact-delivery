# プラグインの作成・修正

## 実装方針

- 対象プラグインのマニフェスト、README、スキル、MCP、テスト、生成手順を調べる。
- プラグイン仕様・スキル仕様と既存の責務境界に従う。配布用スキルは `plugins/*/skills/`、リポジトリ開発用スキルは `.agents/skills/` に置く。
- 共通マニフェストを正本とし、Codex 互換マニフェストは既存の同期手順で生成する。生成物だけを手編集しない。
- 利用者向けの操作はプラグインの README、設計・開発の詳細は `docs/`、再利用する Codex 手順は `.agents/skills/` に置く。
- 参照資料・テンプレートは必要なスキルの直下へ置き、`SKILL.md` から相対リンクする。配布対象の参照先がパッケージ内で解決することを確認する。

## 開発資料

- [製造・レビュー観点](../../../../docs/manufacturing-review.md)
- [テスト・検証観点](../../../../docs/testing-review.md)
- [試験と差分 CI](../../../../docs/testing.md)
- [配布と更新](../../../../docs/distribution.md)
- [プラグイン仕様](https://agent-plugins.org/specification)
- [スキル仕様](https://agentskills.io/specification)
- [Codex スキルガイド](https://developers.openai.com/codex/skills)

依頼に関係する資料だけを読む。
