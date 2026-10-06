# Codex 開発ルールの設計

Codex のリポジトリ用スキルは `.agents/skills/` に置く。配布するプラグインのスキルは各プラグインの `skills/` に置き、両者を混在させない。

| 場所 | 役割 |
| --- | --- |
| `AGENTS.md` | 常時適用する短い開発方針、検証コマンド、必要な資料への案内 |
| `.agents/skills/<name>/SKILL.md` | 作業を選ぶ条件、スキルの前提と手順 |
| `.agents/skills/<name>/references/` | 手順ごとの詳しい判断基準や補足資料 |
| `.agents/skills/<name>/assets/` | 提案書など、繰り返し使うテンプレートや素材 |
| `docs/` | 現行の設計、契約、開発・配布の詳細資料 |
| `plugins/*/skills/` | 利用者へ配布するプラグインのワークフロー |

リポジトリ用スキルはプラグインの作成・修正とレビューを扱う。`SKILL.md` にスキルの前提と手順を記し、手順の詳細を references、再利用する文面を assets に分ける。設計資料と実行手順を重複して記述しない。

この構成は[Codex のスキル配置・構成](https://developers.openai.com/codex/skills)、[スキル仕様](https://agentskills.io/specification)、[プラグインのスキル作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。Codex はリポジトリの `.agents/skills/` を探索し、スキルは `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。
