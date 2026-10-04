# Codex 開発ルールの設計

Codex の repo skill は `.agents/skills/` に置く。配布する Plugin の skill は各 Plugin の `skills/` に置き、両者を混在させない。

| 場所 | 責務 |
| --- | --- |
| `AGENTS.md` | 常時適用する短い開発方針、検証コマンド、必要な資料への案内 |
| `.agents/skills/<name>/SKILL.md` | 特定の作業を選ぶ条件、短い実行手順、必要な参照先 |
| `.agents/skills/<name>/references/` | 必要なときに読む設計・判断基準・詳細手順 |
| `.agents/skills/<name>/assets/` | 提案書など、繰り返し使うテンプレートや素材 |
| `docs/` | 現行の設計、契約、開発・配布の詳細 |
| `plugins/*/skills/` | 利用者に配布する Plugin のワークフロー |

Repo skill は Plugin の作成・修正とレビューを扱う。`SKILL.md` は短いルーターとして保ち、詳しい手順を references、再利用する文面を assets に分ける。設計資料と実行手順を重複して記述しない。

この構成は[Codex の skill 配置・構成](https://developers.openai.com/codex/skills)、[Agent Skills 仕様](https://agentskills.io/specification)、[Plugin の skill 作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。Codex はリポジトリの `.agents/skills/` を探索し、skill は `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。
