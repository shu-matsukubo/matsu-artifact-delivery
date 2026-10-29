---
name: plugin-skill-authoring
description: このリポジトリで Plugin の Skill を新規作成・修正・検証するときに使う。配布用とリポジトリ開発用の Skill に共通の設計方針を適用する。
---

# Plugin Skill の作成・検証

## 概要

Plugin の Skill を作成・修正し、同じ設計方針で構造を検証する。

## 制約と責務範囲

- 対象は `plugins/*/skills/` と `.agents/skills/` の Skill。
- [Skill 設計の方針](references/design-policy.md)に従う。
- 本 Skill は Skill 文書の設計・構造検証を担当する。Plugin 全体の挙動・配布・権限の検証は呼び出し元の責務とする。
- 既存の仕様と参照先を保持し、依頼範囲外の Skill は変更しない。

## フロー

1. 対象 Skill と呼び出し元、既存の参照先を特定する。
2. [Skill 設計の方針](references/design-policy.md)に従って、Skill の作成・修正または検証を行う。
3. [構造検証スクリプト](scripts/validate-skill.ts)を実行し、メタデータ・構造・ローカルリンクを検証する。
4. 対象に関係する既存テストを実行し、機械的に判定できない責務境界・文意をレビューする。
5. 変更範囲と検証結果、未確認事項を提示する。
