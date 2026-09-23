# 試験と差分 CI

Issue #19 の品質基盤。実装・設定・自然言語の契約をコンポーネント単位で検証し、変更した領域とその依存先だけを CI で実行する。試験ジョブの種類は **単体（Unit）** と **E2E** の 2 つとし、差分から選んだ対象を共通コマンドへ引数で渡す。

## 実行方法

Node.js 22.19.0 以降と Git を使う。リポジトリルートと MCP の依存は独立している。skills の試験だけなら MCP の `npm ci` は不要。

```sh
# skills・Plugin構成・CI基盤の依存
npm ci --ignore-scripts

# MCP の依存（全試験または MCP 試験の場合）
npm --prefix plugins/artifact-workflow ci

# すべての単体・E2E
npm test

# 対象を指定しなければ、その層の全試験（MCP を含む）
npm run test:unit
npm run test:e2e

# コンポーネントを指定する。CI も同じコマンドを使う
npm run test:unit -- --targets workflow,mcp
npm run test:e2e -- --targets workflow,integration

# 実行せず、対象と実行コマンドを確認する
npm run test:unit -- --targets workflow --dry-run

# CI と同じコード品質チェック
npm run format:check
npm --prefix plugins/artifact-workflow run check
npm --prefix plugins/artifact-workflow run lint
npm --prefix plugins/artifact-workflow run format:check
```

引数は `--targets` にカンマ区切り、または `--targets-json` に JSON 配列を渡す。CI は差分判定の JSON を環境変数に入れ、`npm run test:unit -- --targets-json "$TEST_TARGETS"` のように引用して渡す。未知・重複・空の対象、不正な引数、指定した層に試験がない組み合わせは失敗にする。手動で `--targets` を指定したときは依存先を自動追加しない。必要なら `workflow,integration` のように明示する。

| 対象名           | 単体の枠                                               | E2E の枠                                |
| ---------------- | ------------------------------------------------------ | --------------------------------------- |
| `mcp`            | MCP ロジック、保存のコンポーネント統合、ビルド検証     | 配布済み MCP の実プロセス・stdio 通信   |
| `workflow`       | Workflow の Skill・Agent・manifest 契約                | Workflow の単独配布・参照グラフ         |
| `escalation`     | Escalation の Skill・Agent・manifest 契約              | Escalation の単独配布・参照グラフ       |
| `integration`    | なし                                                   | Workflow と任意の Escalation の連携契約 |
| `infrastructure` | 差分判定、実行コマンド、集約チェック、共通検証器・構成 | なし                                    |

連携 E2E も同じ E2E ジョブに含める。MCP を選んだ場合は、どちらの層でも最初に `test/` 配下の全 `.test.ts`（サブディレクトリを含む）が対象一覧へ一度だけ登録されていることを検査する。未登録・重複登録・登録先ファイルの欠落があれば、対象名と理由を出して失敗する。MCP だけの差分 CI や `--dry-run` でもこの検査を行い、`infrastructure` の選択には依存しない。その後、配布物の一致確認・古いテスト出力の削除・TypeScript コンパイルを行ってから該当層の試験を起動する。`npm test` ではこの準備を一度だけ行う。

既存のコンポーネント別コマンドも利用できる。

| コマンド                                               | 対象                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `npm run test:workflow`                                | Workflow の単体・構成 E2E。MCP プロセスは起動しない    |
| `npm run test:workflow:unit` / `test:workflow:e2e`     | 上記を個別実行                                         |
| `npm run test:escalation`                              | Escalation の単体・構成 E2E                            |
| `npm run test:escalation:unit` / `test:escalation:e2e` | 上記を個別実行                                         |
| `npm run test:integration`                             | Workflow と任意の Escalation の連携契約                |
| `npm run test:infrastructure`                          | 差分判定、実行コマンド、集約チェック、検証器、共通構成 |
| `npm run test:contracts`                               | MCP 以外の全試験                                       |
| `npm run test:mcp`                                     | MCP の単体・E2E                                        |
| `npm run test:mcp:unit` / `test:mcp:e2e`               | 上記を個別実行                                         |

## CI の選択

[Actions 定義](../.github/workflows/artifact-workflow-ci.yml)は全 PR と `main` push で差分を分類する。`workflow_dispatch` は差分にかかわらず全試験を実行する。PR では base と head の merge-base からの差分、push では before と after の差分を使う。

| 変更対象                                                                                                          | 選択する対象                                                   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Workflow の `skills/`・`com.openai/`、`test/workflow/`                                                            | `workflow` と `integration`                                    |
| MCP の `mcp/`・`test/`、TypeScript / lint / format 設定                                                           | `mcp`                                                          |
| Workflow の manifest・MCP 設定・package / lockfile・ビルドスクリプト                                              | `mcp`、`workflow`、`integration`。配布 metadata への影響も検証 |
| Escalation の既存構成・`skills/`・Agent 定義、`test/escalation/`                                                  | `escalation` と `integration`                                  |
| `test/integration/`                                                                                               | `integration`                                                  |
| 各 Plugin の README / LICENSE                                                                                     | その Plugin と連携 E2E                                         |
| ルート README・この試験ガイド                                                                                     | `infrastructure`                                               |
| CI、判定・実行スクリプト、共通テスト helper、ルート package / lockfile、marketplace、Agent 登録、その他の共通設定 | 全対象                                                         |
| 未知のパス・新しい Plugin / 実装領域、差分なし、イベント不正、Git 履歴不足・取得失敗                              | 全対象にフォールバック                                         |

複数領域の変更は和集合にする。rename は旧・新の両パス、削除は旧パスを含む。完全な Git diff を NUL 区切りで取得し、300 ファイル等の API / paths filter の打ち切りに依存しない。ファイル名をシェルコードへ展開しない。

差分判定の出力は `unit_targets`、`e2e_targets` と環境の `matrix`。GitHub Actions の [JSON 出力による matrix](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#example-returning-a-json-object)を使って次のように実行する。

| PR の変更例              | 単体に渡す対象                           | E2E に渡す対象                        | 環境                                |
| ------------------------ | ---------------------------------------- | ------------------------------------- | ----------------------------------- |
| Workflow の Skill だけ   | `workflow`                               | `workflow,integration`                | 各 1 環境                           |
| Escalation の Skill だけ | `escalation`                             | `escalation,integration`              | 各 1 環境                           |
| MCP のソースだけ         | `mcp`                                    | `mcp`                                 | 各 6 環境                           |
| Workflow の Skill と MCP | `mcp,workflow`                           | `mcp,workflow,integration`            | 各 6 環境。追加 5 環境は `mcp` のみ |
| 連携 E2E だけ            | なし（スキップ）                         | `integration`                         | E2E の 1 環境                       |
| この試験ガイドだけ       | `infrastructure`                         | なし（スキップ）                      | 単体の 1 環境                       |
| CI・共通基盤             | `mcp,workflow,escalation,infrastructure` | `mcp,workflow,escalation,integration` | 各 6 環境。追加 5 環境は `mcp` のみ |

基準の Linux / Node.js 22.19.0 で選択した全対象をまとめて実行する。MCP を含むときは Linux / Windows / macOS × Node.js 22.19.0 / 24 の 6 環境を単体・E2E の両方で維持し、追加 5 環境では MCP のみ実行する。Skills や連携の構成 E2E は基準環境だけで実行する。対象のない層のジョブはスキップする。Unit と E2E はどちらも差分判定にだけ依存し、互いの成功を待たず並列に実行する。

試験ジョブの種類は 2 つだが、MCP 変更時には `Unit / OS / Node` と `E2E / OS / Node` が各 6 件並ぶ。別途、差分判定と集約のジョブがある。**CI 自体を変更する PR は引き続き全対象を実行する**。PR の判定は最新コミットだけでなく PR 全体の差分なので、同じ PR に Skill の変更を追加しても CI 基盤の差分が残る間は全対象になる。

```sh
# CI の選択内容を変更前に確認する
npm run ci:select -- --files plugins/artifact-workflow/skills/artifact-workflow/SKILL.md
npm run ci:select -- --all
```

必須チェックに設定する名前は **Quality gate**。分類と選択した全ジョブの成功を要求し、必要なジョブの failure / cancelled / skipped を成功にしない。対象外の層の skipped は許容する。判定ジョブ自体が失敗した場合も両層は全対象・全環境で実行を試み、集約チェックは失敗する。ブランチ保護の設定はリポジトリ管理者がこの名前を登録する。動的な matrix の個別ジョブをすべて必須にすると、対象外の変更を待ち続ける構成になるため避ける。

## 単体試験の観点

自然言語部分の試験データは [Workflow 契約一覧](../test/workflow/contracts.json)と [Escalation 契約一覧](../test/escalation/contracts.json)。安定 ID・観点名・対象ファイル・必要な契約文を持ち、実行結果にも ID を表示する。構造試験は全 Skill の Markdown と全 Agent 定義に契約項目があることを要求する。新しい実装形式を Skill 配下へ追加するときも、対応する単体試験を追加する。各部品の必須指示・返却項目・フォールバック方針は単体で保証する。構成 E2E では、配布後の到達性と複数部品にまたがる契約の整合を確認する。

| ID                       | 観点                                                                                                           | 実装                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| WF-U01 / WF-U02          | manifest 整合、Skill / Agent 検出、呼び出し policy、read-only 設定、参照ファイルとアンカー、契約の網羅         | [Workflow unit](../test/workflow/unit.test.mjs)、[共通検証](../test/lib/contract-suite.mjs) |
| WF-U03                   | 明示呼び出し、必須役割、承認、9 工程の順序                                                                     | Workflow 契約一覧                                                                           |
| WF-U04 / WF-U05          | タスクの境界、生成入力、担当範囲、相談の親返却                                                                 | Workflow 契約一覧                                                                           |
| WF-U06 / WF-U07          | Self Review の責務・返却、共通 5 原則                                                                          | Workflow 契約一覧                                                                           |
| WF-U08 / WF-U09 / WF-U10 | Independent Review の入力・返却・再レビュー、特化観点 0〜3 件、security の限界                                 | Workflow 契約一覧                                                                           |
| WF-U11 / WF-U12          | 親のタスク・全体検証、引き渡しと完了、後日の修正                                                               | Workflow 契約一覧                                                                           |
| WF-U13 / WF-U14          | MCP の親限定更新・保存失敗、任意相談の発見・失敗・回数・フォールバック                                         | Workflow 契約一覧                                                                           |
| WF-U15 / WF-U16 / WF-U17 | 計画テンプレート、Worker / Reviewer の責務・入出力・再委任禁止                                                 | Workflow 契約一覧                                                                           |
| WF-U18                   | package metadata と MCP 正本・互換設定・配布先の整合                                                           | Workflow unit                                                                               |
| EX-U01 / EX-U02          | manifest、Skill 発見 policy、両相談役の read-only・承認禁止・子起動禁止、参照・契約網羅                        | [Escalation unit](../test/escalation/unit.test.mjs)、共通検証                               |
| EX-U03 / EX-U04          | 親の明示依頼、単発起動、回数・枠管理、失敗時の返却                                                             | Escalation 契約一覧                                                                         |
| EX-U05 / EX-U06 / EX-U07 | 入出力契約・実行状態、相談例の非自動性、結果テンプレート                                                       | Escalation 契約一覧                                                                         |
| EX-U08 / EX-U09 / EX-U10 | 両相談役の責務と禁止事項、Workflow / MCP への必須依存なし                                                      | Escalation 契約一覧、Escalation unit                                                        |
| WF-U19                   | 導入・環境変更を要求しない指示とフォールバックの欠落を、Workflow 単体契約で検出                                | Workflow unit                                                                               |
| EX-U11                   | 両相談役の返却指示から親識別子などの必須項目だけを削除しても、単体契約で検出                                   | Escalation unit                                                                             |
| CI-U01〜CI-U08           | パス対応、未知・共通変更、和集合、イベント不正、merge-base、rename・削除、300 件超・Unicode、CLI 出力          | [差分判定試験](../test/infrastructure/selection.test.mjs)                                   |
| CI-U09〜CI-U11           | 必須 job の集約判定、CLI 終了コード、Actions と npm コマンドの配線                                             | [CI 試験](../test/infrastructure/ci.test.mjs)                                               |
| RUN-U01〜RUN-U08         | 引数、層別実行、MCP 登録の網羅性・欠落・重複・入れ子、MCP 限定 CLI の登録漏れ拒否、環境選択、失敗伝搬、dry-run | [実行コマンドの単体試験](../test/infrastructure/runner.test.mjs)                            |
| HAR-U01〜HAR-U08         | YAML / TOML / Markdown、相対パス、参照循環・切断、metadata 不整合、権限制約、契約欠落・順序変更を拒否          | [検証器の単体試験](../test/infrastructure/harness.test.mjs)                                 |
| PKG-U01〜PKG-U04         | marketplace、全 Agent 登録、README の参照、試験 ID とガイドの対応                                              | [共通構成試験](../test/infrastructure/package.test.mjs)                                     |

### 既存 MCP の対応表

既存の試験名とファイル名を識別子として維持する。MCP 実装・ビルドスクリプトの単体・統合試験と、配布実行ファイルの E2E は [既存 test/](../plugins/artifact-workflow/test/) に残す。`mcp.test.ts` を E2E、それ以外を単体の枠に登録する。[対象一覧](../scripts/test-targets.mjs)の網羅性を MCP 実行の前提として検査し、新規試験の追加だけでも登録漏れを検出する。

| 対象実装                                       | 試験ファイル                                           | 主な確認                                                      |
| ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `config.ts`                                    | `config.test.ts`                                       | 保存先の既定値・絶対パス・優先順位                            |
| `schema.ts` / `task-dependencies.ts`           | `schema.test.ts` / `task-dependencies.test.ts`         | 承認済み計画、入力不正、依存グラフ・循環・境界                |
| `session.ts`                                   | `session.test.ts`                                      | 初期化・置換・完了、revision、状態遷移                        |
| `snapshot.ts`                                  | `snapshot.test.ts`                                     | JSON、旧形式、サイズ上限、破損                                |
| `snapshot-files.ts`                            | `snapshot-files.test.ts`                               | 保存・読込・ロック・I/O 失敗・後始末                          |
| `store.ts` / `repository.ts` / `cleanup.ts`    | `store.test.ts` / `server.test.ts` / `cleanup.test.ts` | Repository 契約、保存の統合、競合、完了済みだけの回収         |
| `server.ts` / `errors.ts`                      | `server.test.ts`                                       | ツール入出力、既知・OS・未知のエラー契約                      |
| `scripts/build.mjs` / `scripts/clean-test.mjs` | `build.test.ts`                                        | 配布物の欠落・更新漏れ、型エラー、古いコンパイル結果の削除    |
| `index.ts` / 配布 bundle / MCP 接続            | `mcp.test.ts`                                          | 実プロセスの起動・通信・再起動・分離・完了・競合・出力 schema |

## 構成 E2E の観点と限界

配布時に必要な manifest・Skill・参照資料・Agent 定義・MCP bundle だけを OS の一時ディレクトリへ配置する。元リポジトリの Agent 登録、テスト、`node_modules` に依存せず、そこから metadata を解析して参照グラフをたどる。実 Codex のインストール処理やモデル出力は再現しない。

| ID                | シナリオ                                                                                    | 実装                                                  |
| ----------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| WF-E01 / WF-E02   | 単体パッケージの発見、9 工程、Self Review → Independent Review → 親の検証・引き渡しへの参照 | [Workflow E2E](../test/workflow/e2e.test.mjs)         |
| WF-E03            | 特化観点なし／security ありの双方で共通 5 原則と返却契約が参照できる                        | Workflow E2E                                          |
| WF-E04            | Escalation 未導入の単独配布で、任意相談の参照先へ到達できる                                 | Workflow E2E                                          |
| EX-E01 / EX-E02   | Escalation 単独配布、両相談役とテンプレートの識別子・状態整合                               | [Escalation E2E](../test/escalation/e2e.test.mjs)     |
| INT-E01 / INT-E02 | 任意相談先の発見と入出力の一致、Reviewer → Parent → Advisor → Worker / Reviewer の責務整合  | [連携 E2E](../test/integration/consultation.test.mjs) |

参照切れ・権限退行の負例は検証器の単体試験 `HAR-U04` / `HAR-U06` に集約する。従来の `WF-E05` / `EX-E03` は廃止し、ID を再利用しない。

契約文の検査は「重要な指示が消えていない」ことの回帰検出であり、自然言語の意味全体・矛盾の不存在・モデルの遵守は証明しない。単語を含むだけでエージェント動作が成功したとみなさない。API キー・モデル課金・実ユーザー環境へのインストールを CI 必須条件にしない。

実モデルの動作 E2E / AI RV を行う場合は、別の検証用タスクで次のケースを実行し、利用した client・モデル・Plugin の版、入力、実際の委任・ツール呼び出しと返却、未確認事項を記録する。以下は準備済みの観点であり、CI で実施済みとは扱わない。

1. 公開文章の生成：承認済み計画 → Worker の生成・Self Review → 特化観点 0 件の独立レビュー → 親の実物検証 → 引き渡し。
2. security が必要な設定成果物：親が選ぶ 1 観点でレビューし、指摘を親が元タスクの Worker へ戻し、変更版を再レビューする。
3. Reviewer から相談依頼：子が直接相談役を起動せず、親が利用判断し、実装は Worker、再レビューは Reviewer に戻る。
4. Escalation の未導入・無効・曖昧・読み込み不能・起動失敗：未取得の助言を成功とせず、影響する作業だけを親が判断する。
5. 両相談役：入力不足、人間判断が必要なケース、タイムアウトで実行状態が不明なケースを正しく返す。

## 追加・変更の手順

1. 該当コンポーネントの契約一覧に ID・観点・対象を追加する。文言の意図的な変更では旧契約の削除理由もレビューする。
2. metadata・権限・参照は構文解析と実ファイルで検証する。参照を追加したら配布グラフ E2E でも到達を確認する。
3. 実装コード・検証器・差分判定を追加したら正常系と失敗系の単体試験を追加する。新パスの CI 分類を [select-tests.mjs](../scripts/select-tests.mjs) とその試験で固定する。
4. 新しい MCP 試験は [対象一覧](../scripts/test-targets.mjs)で単体または E2E に登録する。この対応表を更新し、該当対象と連携 E2E を実行する。共通基盤の変更では `npm test` と各品質チェックを実行する。
5. 全体 RV ではこれらの再現可能な試験結果を基礎にし、自然言語の意味・実モデルの遵守・未確認環境は別途レビューする。Issue #19 では全体 RV 自体は実施しない。
