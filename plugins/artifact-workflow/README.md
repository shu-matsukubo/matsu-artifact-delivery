English | [日本語](README.ja.md)

# artifact-workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fartifact-workflow%2Fplugin.json&query=%24.version&label=version)](plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)
[![MCP: Windows x64 only](https://img.shields.io/badge/MCP-Windows%20x64%20only-lightgrey.svg)](#mcp-runtime)

Plans work, presents it for approval, then coordinates artifact generation, independent review, and completion checks. It presents the finished artifact and verification results to the parent.

## Install

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
```

After installation, start a new task and select **成果物生成ワークフロー** in Codex's `$` menu or Skill selector before entering your request. For example: “Create a one-page Markdown welcome guide for new employees.” Mentioning `artifact-workflow` or `$artifact-workflow` in a prompt is separate from selecting the Skill in the menu.

In CLI / IDE, select it from `/skills` or `$`. In App Server, use the formal `name` and `path` returned by `skills/list` as the `skill` input to `turn/start`. See [the reproducible App Server procedure](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/model-acceptance.md#app-server-を使う再現手順).

The parent should distinguish a request to create an artifact from approval of the presented plan, and should proceed only after explicit approval of that plan. Execution order also depends on higher-priority client instructions and capabilities, so this Skill cannot guarantee a pause when the client does not permit one. If you need approval to be awaited, explicitly ask the parent to present the plan and wait for your approval before saving it, delegating, or generating the artifact. To update the installed files, upgrade the marketplace:

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

Restart Codex and start a new task after updating. See [Distribution and updates](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認) for startup configuration errors.

## Workflow contents

| Path                                                                                                               | Responsibility                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [artifact-workflow](skills/artifact-workflow/SKILL.md)                                                             | Workflow coordination, approval, verification, and delivery             |
| [task-planning](skills/task-planning/SKILL.md)                                                                     | Scope, task breakdown, and planning                                     |
| [artifact-generation](skills/artifact-generation/SKILL.md)                                                         | Generation principles, worker delegation, creation, editing, and return |
| [artifact-review](skills/artifact-review/SKILL.md)                                                                 | Independent review and follow-up                                        |
| [task-plan-template.md](skills/task-planning/assets/task-plan-template.md)                                         | User-facing work plan                                                   |
| [worker.md](skills/artifact-generation/assets/worker.md)                                                           | Instructions for artifact workers                                       |
| [reviewer.md](skills/artifact-review/assets/reviewer.md)                                                           | Instructions for independent reviewers                                  |
| [mcp.json](mcp.json)                                                                                               | Launch configuration for `artifact-task-memory` MCP                     |
| [extension-management](skills/extension-management/SKILL.md)                                                       | Register and manage reusable artifact guidance                          |
| [MCP source](https://github.com/shu-matsukubo/matsu-artifact-delivery/tree/main/plugins/artifact-workflow/mcp/src) | TypeScript implementation for MCP maintenance                           |

The parent manages subagents and chooses models and reasoning settings for each task. Reviewer instructions request read-only work but do not change runtime permissions; see [reviewer guidance](skills/artifact-review/SKILL.md).

## MCP runtime

This plugin bundles an MCP dependency bundle, a Node.js runtime for Windows x64, and a launcher that extracts the runtime to user data on first launch. The bundled MCP runtime is Windows x64 only; the plugin's Skills may be used in other compatible clients. Confirm that client's subagent delegation support separately; identical delegation behavior across clients is not guaranteed.

Plan data is stored in `PLUGIN_DATA/task-memory/`. Registered extensions are stored separately in `PLUGIN_DATA/extensions/`; if `PLUGIN_DATA` is unavailable, extensions persist in the OS user state directory.

## Register reusable guidance

State clearly when guidance should be registered or applied to future work, for example, “Apply this convention to future React UI implementations.” The `extension-management` Skill manages reusable artifact guidance. It records the scope, conditions, summary, implementation instructions, related lint/type-check/run commands, and cautions, then uses the same guidance during generation and independent review. It checks existing entries and asks for explicit consent to the proposed difference before saving. It does not add commands or quality bars that were not requested.

You can also ask to list registered guidance, show an entry by ID, edit its summary, or delete it by name. If names are ambiguous, identify the entry by ID. If no relevant guidance exists, work continues from the request and shared principles. The MCP only stores, searches, and retrieves guidance; it does not execute Skills or commands. Proposals based on conversation context require the client to select and run `extension-management`; it does not monitor all conversations automatically. The completion suggestion is described in [delivery guidance](skills/artifact-workflow/references/delivery.md).

## Development and distribution

See [Distribution and updates](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md) for MCP type checks, tests, and package generation. Changes to shared infrastructure also require the repository checks and tests.

## License

The plugin's source, configuration, and documentation are licensed under the [MIT License](LICENSE). Redistribution must include `LICENSE`, `mcp/NODE_RUNTIME_LICENSES.txt`, and `mcp/THIRD_PARTY_LICENSES.txt`.
