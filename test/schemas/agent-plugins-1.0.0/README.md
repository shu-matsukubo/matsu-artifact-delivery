# Agent Plugins 1.0.0 のスキーマ

このディレクトリには Agent Plugins 1.0.0 の JSON Schema を格納する。各ファイルは公式のバージョン付き URL を出典とし、変更せずに管理する。整形の対象外とし、テストでは Ajv（JSON Schema 2020-12）を使ってローカルのコピーを読み込む。実行時にスキーマを取得しない。

| 出典 | SHA-256 |
| --- | --- |
| [plugin.schema.json](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) | `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883` |
| [mcp.schema.json](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) | `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb` |

別の仕様バージョンへ更新する場合は、スキーマファイル、出典 URL、ハッシュ値、対応するスキーマ ID、否定テストをまとめて更新する。Codex 互換マニフェストは別の検証契約を使う。
