# Issue #112 実モデル受け入れ記録

2026-11-02 に、書き込み可能な親から標準 subagent へ独立レビューを委任する限定試験を実施した。通常の手順は[実モデル受け入れ手順](../model-acceptance.md)を参照。

## 対象と環境

- 基底 SHA: `83df6000d02fdd8f67bb721aa057071e0a8e9dc0`。`artifact-workflow 0.5.0` の正本に Issue #112 の変更を適用した作業ツリーを使用した。
- Windows x64、OS build `10.0.26300.0`、Node.js `26.13.0`、この Codex セッションの `collaboration.spawn_agent` を使用した。client build と実効 model / reasoning effort は起動応答に含まれず、未確認。
- 親の環境は `workspace-write`、承認 reviewer は `auto_review`。親による試験成果物の書き込みを実測した。通常の設定・cache・保存済み計画は変更していない。
- Reviewer は `agent_type: default`、`fork_turns: none` で起動した。`artifact-reviewer` Custom Agent は登録せず、子専用 Sandbox 設定も指定していない。この起動 API には Sandbox 設定欄がない。
- Reviewer の model / effort は明示指定を省略した。限定的なメモの独立確認に環境の既定・継承を使用し、要求値と未確認の実効値を区別した。生成・修正担当は既存の `issue_implementer`（要求設定 `gpt-6-luna` / `medium`）を使用した。
- 親 `/root`、session `issue112-in-session`、元タスク `issue112-note`。MCP と計画保存は試験入力で明示的に省略し、固定した `requirements.md` を親の snapshot として渡した。共通方針は該当なし。

Reviewer は導入済み cache ではなく、候補の次の実ファイルと共通5原則を読んだ。変更した入力を SHA-256 で固定し、両レビューの前後で一致を確認した。

| 入力（`plugins/artifact-workflow/skills/artifact-review/` 配下） | SHA-256 |
| --- | --- |
| `SKILL.md` | `B0261541B587DECB655F24249135676FBF8AF85229946C7AC515588AD1A5F4BC` |
| `assets/reviewer.md` | `A2496058F3F5678EA1E9D231BC7C2E95CA10017E244535B185BF24E2422CD387` |
| `references/independent-review.md` | `EF3EEEE2AEAC9E0E99A660A1719942F6C12F806C7439491938F928A3B49AD38F` |

## 生成・指摘・修正・再レビュー

試験専用領域は `C:/Users/docha/.codex/visualizations/2026/11/02/01a19a4f-3f4c-7b70-bc97-2ceac741e327/issue112-acceptance`。Git 管理外の `requirements.md` と `sales-note.md` だけを置いた。要件はタイトル「売上メモ」、入力 `A: 3` と `B: 5`、合計 `8`、余分な数値なし、外部公開不要とした。

1. 生成担当 `/root/issue112_implementation` が要件どおりの初版を作成し、セルフ確認した。
2. 親が合計 `8` を `9` に置換し、検出用の故障を注入した。自然発生したモデルの計算失敗ではない。
3. 別の標準 subagent `/root/issue112_reviewer1` を起動した。レビュー `issue112-r1` は `reviewed` と必須修正 `issue112-r1-F1` を返し、`sales-note.md:5` の合計が要件・再計算結果と違うことを指摘した。Custom Agent や子専用 Sandbox 不在による保留はなかった。
4. 親が指摘を採用し、同じ生成担当へ元タスク ID で戻した。生成担当は合計を `8` に修正して終了した。
5. さらに別の標準 subagent `/root/issue112_reviewer2` を起動した。レビュー `issue112-r2` は新版全文と共通5原則を確認し、`reviewed`、F1 解消、追加指摘なしを返した。旧版実物を渡していないため、合計行だけの変更であることの独立照合は未実施と明示した。
6. 親は最新版の実物を読み、タイトル・入力値・合計・数値一覧が要件どおりであることを再検証した。

| ファイル・版 | SHA-256 |
| --- | --- |
| 固定入力 `requirements.md` | `5B3DB67360E0A577D7BAC033ACB9E96894228CF2CD7A84066C586CE3D123B968` |
| 初版・修正版 `sales-note.md` | `A07C0CA056364BA5CF4234D8F1DD0072844D3553B78F76C3D2F88AC0154C85DA` |
| 故障注入版 `sales-note.md` | `F875DFEA77E6C3669E4E85EAC810CC71BB64097FFC61CD124A472932BD13CE36` |

親の前後照合は R1 が `03:39:42Z` / `03:41:15Z`、R2 が `03:41:57Z` / `03:43:41Z`（UTC）。各回で対象領域の全ファイル一覧・各 hash と、候補 Skill の hash が一致した。候補リポジトリに元からあった10ファイルの変更は開始状態として区別し、レビュー前後で Git status の一覧が同じことも確認した。Reviewer の返却した対象版も親の固定版と一致した。

## 自動検証と確認範囲

- Workflow 単体51件、構成 E2E 4件、infrastructure 単体120件、integration E2E 2件が成功した。
- `npm run check`、`npm run lint`、`npm run format:check`、`git diff --check` が成功した。
- 新契約 `WF-U37` が旧版の独立レビュー文書に対して失敗することを確認した。構成 E2E は登録済み Plugin Agent がない配布物にも新しい指示が含まれることを確認した。
- Sandbox 内では配布テストの symlink 作成が `EPERM` になったため、infrastructure は通常権限で再実行し全件成功した。

この試験で確認したのは、候補の指示を読み込んだ標準 subagent の実起動・返却、指摘から元 Worker の修正と別 Reviewer の再レビューへの進行、および親による対象版照合である。記録の根拠はこのスレッドの委任・返却と親の読み取り・hash 照合結果であり、別の raw event log は保存していない。

読み取り専用は行動制約であり、書き込みを技術的に防いだとは判定しない。前後照合は事後検証で、検査範囲外の書き込みや途中で変更して元に戻す操作まで検出する保証はない。Plugin の実インストール、MCP 保存、公開までの全体フロー、起動不能や強制隔離不足の実環境はこの限定試験の対象外。後者の保留・通常レビューへの切り替え禁止は契約テストで確認した。
