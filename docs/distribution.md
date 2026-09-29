# 配布と更新

## 配布方針

Plugin の正本は Git で管理する `plugins/<plugin-name>/` とルートの `.agents/plugins/marketplace.json` である。`dist/` は `npm run package` が作る一時的な確認用ステージング出力であり、正本でも公開先でもない。生成し直せるためコミットせず、GitHub Release や別のバイナリ保管先も設けない。

`artifact-workflow` の MCP は `mcp/src/` をソースとし、依存をまとめた bundle と Windows x64 向け Node.js 22 runtime の圧縮ファイルを Plugin に同梱する。初回起動時に PowerShell ランチャーが runtime をユーザーデータ領域へ展開するため、利用者側の Node.js、npm、ネットワーク接続は不要である。bundle・runtime・ライセンス通知は配布に必要な生成物なので Git で管理し、更新時は試験して一緒にコミットする。`npm run package` は Plugin ごとに必要なファイルだけを `dist/` に集め、公開候補やインストール試験の内容を確認するために使う。

同梱 Node.js の更新は `npm --prefix plugins/artifact-workflow run runtime:update -- <version>` で行う。スクリプトは Node.js 公式 `SHASUMS256.txt` と照合して Windows x64 の `node.exe` を取得し、ZIP、バイナリ、ライセンスを生成してチェックサムを記録する。`npm --prefix plugins/artifact-workflow run runtime:verify` は配布前に ZIP 内のバイナリと記録済み公式チェックサム、ライセンスの一致を検証し、`npm run package` と MCP のテストでも自動実行される。更新では Node.js の公式配布元と同じ版の LICENSE を使う。

配布経路は目的で分ける。

- **開発・小規模な Git 配布:** `codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery` で GitHub marketplace を追加する。Codex がリポジトリを取得するため、利用者の手動 clone、npm install、`dist/` 生成は不要。MCP bundle と Windows x64 runtime はリポジトリに同梱済みである。
- **OpenAI の公開 Plugins Directory:** Platform の提出ポータルで Plugin ごとに提出し、審査後に公開する。公開後の利用者は Directory で検索して Install する。GitHub Release は不要。

Agent Plugins 仕様は `plugin.json`、`skills/`、任意の `mcp.json` などパッケージの構造とメタデータを定めるもので、公開レジストリや配布ホスティングを提供するものではない。[仕様](https://agent-plugins.org/specification)と[公式の Plugin packaging guide](https://developers.openai.com/plugins/build/plugins)を参照。

### 公開 Directory に提出する場合

公開提出は GitHub 上の marketplace 追加とは別の手続きである。[Plugin submission portal](https://developers.openai.com/plugins/deploy/submission)に Plugin のパッケージ、掲載情報、スタータープロンプト、正例・負例の試験、提供地域などを提出する。OpenAI の審査に通った後、発行者がポータルから公開すると ChatGPT と Codex 共通の Plugins Directory に載る。提出しただけでは公開されない。掲載済みの Plugin 更新も新しい版の提出・審査・公開が必要。

このリポジトリの `artifact-workflow` はローカル stdio MCP を同梱する。現行の公開手順では MCP を含む Plugin は安定した公開 HTTPS endpoint を提出する必要があり、ローカル MCP のままでは通常の公開提出要件を満たさない。公開したい場合は、まずローカル MCP サポートについて OpenAI に問い合わせるか、リモート MCP として運用する設計・ホスティングを別途判断する。MCP 機能を外した skills-only 版を検討する場合は、Skill が単独で正しく動作することを確認して別パッケージとして提出する。**この条件が解決するまでは公開 Directory に掲載済みとは案内しない。**

公開候補は `npm run package` で `dist/plugins/<plugin-name>/` に生成し、Plugin 単位でポータルへアップロードする候補としてレビューする。これを長期保管したり Git にコミットしたりする必要はない。手動公開を選ぶ段階でだけポータル用のアーカイブを作ればよく、リリース資産を自動生成・ホストする CI は追加しない。

公開前の版は root `plugin.json` で管理し、互換 manifest や Workflow の package/lockfile に同期する。公開された版とソースを対応付けるため、Git のタグは任意で付けてもよいが、配布に必須ではない。バージョンの更新方法は「正式版の確定」を参照。

## 配布物の生成

```sh
npm ci --ignore-scripts
npm --prefix plugins/artifact-workflow ci
npm run package
```

manifest検証・互換設定の同期確認・MCPの生成物一致確認に成功すると、専用出力先 `dist/` を作り直す。出力先に手作業のファイルは置かない。root manifest を変更した後、互換設定だけなら `npm run sync:manifests`、MCPソースも変えた場合は `npm --prefix plugins/artifact-workflow run build` で同梱 bundle を更新し、Git で管理するファイルとして差分を確認してから実行する。

[配布処理](../scripts/package-plugins.ts)がファイル一覧を管理する。README、LICENSE、共通・互換manifest、Skill一式、Workflowの役割テンプレート、MCP設定・bundle・Windows runtime・依存ライセンスを含む。開発用のpackage/lockfile、ソース、試験、スクリプト、`node_modules`、`.build`、`.test-build` は含めない。同梱ディレクトリ内のシンボリックリンクも拒否する。

`.agents/plugins/marketplace.json` は内容を変えず `dist/.agents/plugins/marketplace.json` にコピーする。`./plugins/<name>` は配布ルート `dist/` 基準の相対パスとなる。生成処理と構成E2Eは同じ配布処理を使い、READMEを含むローカルリンク・アンカーも配布物内で検証する。

## 開発時のパッケージ検証とインストール

[公式の marketplace 手順](https://developers.openai.com/plugins/build/plugins)に従う。開発者は MCP bundle を更新したあと、次のコマンドでステージング出力を作り、試験する。

```sh
npm ci --ignore-scripts
npm --prefix plugins/artifact-workflow ci
npm run package
npm run test:install
```

開発中の working tree を直接 marketplace に登録すると、`node_modules` などの開発用ファイルまでインストールされる可能性がある。ステージング出力は除外対象を取り除くので、開発時のインストール確認には `dist/` を使う。marketplace の登録は一度だけでよい。

```sh
codex plugin marketplace list
codex plugin marketplace add ./dist
codex plugin list --marketplace matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
codex plugin add expert-escalation@matsu-artifact-delivery
```

必要な Plugin だけインストールする。既に同名 marketplace が別の場所を指す場合は、一覧で場所を確認し、切り替えるときだけ `codex plugin marketplace remove matsu-artifact-delivery` を実行してから正しいソースを追加する。GitHub marketplace からの利用者向け導入では手動 clone や `dist/` 生成は不要だが、作業中のソースを試すときは上記の通り `dist/` を使う。

アプリとCLIで見える一覧が異なる場合は、アプリが選択しているmarketplaceとインストール元も確認する。配布物の再生成だけではインストール済みキャッシュは更新されない。再インストール後、アプリでPluginが有効であることを確認し、**新しいタスク**で試す。既存の実行中タスクへ更新が反映される前提にしない。

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

生成されたカタログについても `read_marketplace_name.py --marketplace-path dist/.agents/plugins/marketplace.json` で名前を確認する。上記の登録先確認・再インストール・新しいタスクでの確認までを一続きの更新手順とする。開発用cachebusterは正式リリースの版として扱わず、package.json / lockfileの基底バージョンは維持する。`WF-U18` は、標準helperが生成する形式の `+codex.<token>` だけを除いてpackage.jsonの版と照合し、lockfileの最上位と `packages[""]` も同じ版であることを確認する。通常版や無関係なsuffixは省略せず完全一致を要求する。

## 正式版の確定

各root `plugin.json` のversionを正式版に変更し、`npm run sync:manifests` で両Pluginの互換設定へ同期する。Workflowは `npm --prefix plugins/artifact-workflow version <正式版> --no-git-tag-version` でpackage.jsonとpackage-lock.jsonも同じ版へ更新する。root manifest・互換manifest・package.json・lockfileの最上位と `packages[""]` の版を照合し、MCPをビルドする。

型・lint・書式・全試験に成功した候補から配布物を生成し、`npm run test:install` でその配布物を検証する。候補を固定して実モデルによる生成・承認待ち・独立レビュー・相談を含む受け入れ試験を行い、その確認後に正式リリースを判断する。CLIとMCPの試験だけで実モデルの受け入れ試験を代替しない。

## スキーマの固定と試験

[公式plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)と[公式MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)の1.0.0版を [test/schemas/agent-plugins-1.0.0](../test/schemas/agent-plugins-1.0.0/) に保存する。取得元・日時・SHA-256は同ディレクトリのREADMEに記載する。AjvのJSON Schema 2020-12検証をCI・共通 `loadPlugin()`・配布前検証で実行し、試験時のダウンロードは行わない。規格更新時は公式ファイル・許可するschema ID・負例をまとめて更新する。

Codex互換manifestは共通schemaへ混ぜず、専用の整合性・パス検査とplugin-creatorの検証器で検証する。正本との同一性、MCPの実ファイルとパス包含、Node起動の契約はJSON Schema以外でも検査する。

`npm run test:install` はCodex CLIがPATHにある環境で実行する追加のリリース前試験。既に生成した `dist/` を空の一時Codexホームへインストールし、実キャッシュの全ファイル・内容・ローカルリンク・不要ディレクトリ不在と、Windows x64 では同梱ランチャー経由のMCP起動を検証する。子プロセスだけに一時 `CODEX_HOME` を渡し、実ユーザーの登録・インストール・保存済み計画は変更しない。通常CIにはCodex CLIを要求せず、共有配布処理と構成・MCP E2Eを実行する。
