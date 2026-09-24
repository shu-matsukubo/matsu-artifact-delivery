# 配布と更新

配布物はリポジトリルートの `npm run package` で生成する `dist/` を正本とする。ローカルのインストール試験とリリースには同じ配布物を使う。開発用の `plugins/` を直接インストールすると、Git管理外の開発依存もコピーされ得る。

## 配布物の生成

```sh
npm ci --ignore-scripts
npm --prefix plugins/artifact-workflow ci
npm run package
```

manifest検証・互換設定の同期確認・MCPの生成物一致確認に成功すると、専用出力先 `dist/` を作り直す。出力先に手作業のファイルは置かない。正本を変更した後、互換設定だけなら `npm run sync:manifests`、MCPソースも変えた場合は `npm --prefix plugins/artifact-workflow run build` で生成物を更新してから実行する。

[配布処理](../scripts/package-plugins.mjs)がファイル一覧を管理する。README、LICENSE、共通・互換manifest、Skill一式、Custom Agent定義、WorkflowのMCP設定とbundle・依存ライセンスを含む。開発用のpackage/lockfile、ソース、試験、スクリプト、`node_modules`、`.build`、`.test-build` は含めない。同梱ディレクトリ内のシンボリックリンクも拒否する。

`.agents/plugins/marketplace.json` は内容を変えず `dist/.agents/plugins/marketplace.json` にコピーする。`./plugins/<name>` は配布ルート `dist/` 基準の相対パスとなる。生成処理と構成E2Eは同じ配布処理を使い、READMEを含むローカルリンク・アンカーも配布物内で検証する。

## ローカルへの登録と再インストール

[公式のローカルmarketplace手順](https://developers.openai.com/plugins/build/plugins)に従い、ソースをCLIで登録する。

```sh
codex plugin marketplace list
codex plugin marketplace add ./dist
codex plugin list --marketplace matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
codex plugin add expert-escalation@matsu-artifact-delivery
```

必要なPluginだけインストールする。既に同名marketplaceがリポジトリ直下や別の場所を指す場合は、一覧で既存の場所を確認したうえで `codex plugin marketplace remove matsu-artifact-delivery`、`codex plugin marketplace add ./dist` の順に登録し直す。設定ファイルやカタログを手編集して切り替えない。同名のGit配布などを使っている場合も、ローカル反復試験へ切り替える意図を確認してから行う。

アプリとCLIで見える一覧が異なる場合は、アプリが選択しているmarketplaceとインストール元も確認する。配布物の再生成だけではインストール済みキャッシュは更新されない。再インストール後、アプリで有効化とCustom Agent登録を確認し、**新しいタスク**で試す。既存の実行中タスクへ更新が反映される前提にしない。

## 開発時のcachebuster

両Pluginともrootの `plugin.json` を正本とする。外部の `plugin-creator/scripts/update_plugin_cachebuster.py` は互換manifestだけを更新するため、実行後にそのcachebusterを正本へ取り込み、互換設定を生成し直す。

以下の `<plugin-creator>` は現在利用可能な同スキルの実際のディレクトリに置き換える。Pythonを利用できる環境で、リポジトリルートから実行する。helperのデフォルトUTC timestampを使い、既存の `+codex.*` は置き換える。

```sh
python <plugin-creator>/scripts/read_marketplace_name.py --marketplace-path .agents/plugins/marketplace.json
python <plugin-creator>/scripts/validate_plugin.py plugins/artifact-workflow
python <plugin-creator>/scripts/update_plugin_cachebuster.py plugins/artifact-workflow
npm run sync:manifests -- --adopt-cachebuster artifact-workflow
```

Escalationも同じ手順で、パスと引数を `expert-escalation` に置き換える。`--adopt-cachebuster` はPlugin名と正本の基底バージョンが同じ `+codex.<token>` だけを受け付ける。helperの変更を放置したままWorkflowをビルドすると、正本の古い版で互換設定が再生成される。

Workflowのソースも変更した場合はビルドし、その後に以下を実行する。

```sh
npm run check:manifests
npm test
npm run package
npm run test:install
```

生成されたカタログについても `read_marketplace_name.py --marketplace-path dist/.agents/plugins/marketplace.json` で名前を確認する。上記の登録先確認・再インストール・新しいタスクでの確認までを一続きの更新手順とする。開発用cachebusterは正式リリースの版として扱わず、package.json / lockfileの基底バージョンは維持する。

## 正式版の確定

各root `plugin.json` のversionを正式版に変更し、`npm run sync:manifests` で両Pluginの互換設定へ同期する。Workflowは `npm --prefix plugins/artifact-workflow version <正式版> --no-git-tag-version` でpackage.jsonとpackage-lock.jsonも同じ版へ更新する。root manifest・互換manifest・package.json・lockfileの最上位と `packages[""]` の版を照合し、MCPをビルドする。

型・lint・書式・全試験に成功した候補から配布物を生成し、`npm run test:install` でその配布物を検証する。候補を固定して実モデルによる生成・承認待ち・独立レビュー・相談を含む受け入れ試験を行い、その確認後に正式リリースを判断する。CLIとMCPの試験だけで実モデルの受け入れ試験を代替しない。

## スキーマの固定と試験

[公式plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)と[公式MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)の1.0.0版を [test/schemas/agent-plugins-1.0.0](../test/schemas/agent-plugins-1.0.0/) に保存する。取得元・日時・SHA-256は同ディレクトリのREADMEに記載する。AjvのJSON Schema 2020-12検証をCI・共通 `loadPlugin()`・配布前検証で実行し、試験時のダウンロードは行わない。規格更新時は公式ファイル・許可するschema ID・負例をまとめて更新する。

Codex互換manifestは共通schemaへ混ぜず、専用の整合性・パス検査とplugin-creatorの検証器で検証する。正本との同一性、MCPの実ファイルとパス包含、Node起動の契約はJSON Schema以外でも検査する。

`npm run test:install` はCodex CLIがPATHにある環境で実行する追加のリリース前試験。既に生成した `dist/` を空の一時Codexホームへインストールし、実キャッシュの全ファイル・内容・ローカルリンク・不要ディレクトリ不在と、NodeだけでのMCP起動を検証する。子プロセスだけに一時 `CODEX_HOME` を渡し、実ユーザーの登録・インストール・保存済み計画は変更しない。通常CIにはCodex CLIを要求せず、共有配布処理と構成・MCP E2Eを実行する。
