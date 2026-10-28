English | [日本語](README.ja.md)

# expert-escalation

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fexpert-escalation%2Fplugin.json&query=%24.version&label=version)](plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)

A standalone plugin that routes explicitly requested questions about design, security, or change impact to a read-only advisor. The original worker continues implementation and verification. It has no cumulative call limit; the parent that requests advice manages budgets, retries, and whether work continues or stops.

## Contents

| Topic                                  | Source                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Invocation steps and boundaries        | [SKILL.md](skills/expert-escalation/SKILL.md)                                                  |
| Examples of questions to escalate      | [triggers.md](skills/expert-escalation/references/triggers.md)                                 |
| Principles and caller responsibilities | [principles.md](skills/expert-escalation/references/principles.md)                             |
| Advisor role, inputs, and response     | [advisor-contract.md](skills/expert-escalation/references/advisor-contract.md)                 |
| Response and parent decision template  | [escalation-result-template.md](skills/expert-escalation/assets/escalation-result-template.md) |

## Use from a parent or worker

For example: “Use `$expert-escalation` to check whether this design meets the required conditions.” Start it only when the user or calling parent explicitly requests it. The Skill is listed by Codex with `allow_implicit_invocation: true`, but its description and instructions still require an explicit request. Listing or reading it does not start a consultation. See [the official invocation setting](https://learn.chatgpt.com/docs/build-skills#optional-metadata).

The parent reads the installed Skill and starts one advisor according to its contract. See [the advisor contract](skills/expert-escalation/references/advisor-contract.md) for the role, inputs, and response, and [principles](skills/expert-escalation/references/principles.md) for caller responsibilities and handling unavailable advisors. The discovery and invocation policy for `artifact-workflow` is documented [here](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/plugins/artifact-workflow/skills/artifact-workflow/references/escalation.md#発見起動).

## Standards and Codex compatibility

The [Agent Plugins Specification](https://agent-plugins.org/specification) and [Agent Skills Specification](https://agentskills.io/specification) define the shared format.

| Path                                                                                       | Purpose                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [plugin.json](plugin.json)                                                                 | Canonical shared metadata and release version, including the target schema                                                   |
| `skills/expert-escalation/`                                                                | Shared Skill location for instructions and references                                                                        |
| [.codex-plugin/plugin.json](.codex-plugin/plugin.json)                                     | Generated Codex-compatible manifest with Skill location and display information                                              |
| [skills/expert-escalation/agents/openai.yaml](skills/expert-escalation/agents/openai.yaml) | Codex display information and `allow_implicit_invocation: true`; the Skill description and body set the invocation condition |

`.codex-plugin/plugin.json` and `agents/openai.yaml` preserve Codex's existing loading locations. They are Codex-specific compatibility settings, not custom discovery mechanisms in the shared specification. See [Plugin packaging](https://developers.openai.com/plugins/build/plugins) and [optional Skill metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata). The root `plugin.json` is authoritative for shared fields; after changes, run `npm run sync:manifests` from the repository root to update the compatibility manifest.

Custom Agents, model selection, sandbox, and concurrency settings are not part of the shared Agent Plugins specification. The top-level parent selects a model and reasoning level available in the active client or API. If unavailable, use that client's or parent's defaults. Other clients should provide an equivalent advisor role and explicit invocation path.

## Install and update with Codex

Codex fetches the repository from the GitHub marketplace:

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add expert-escalation@matsu-artifact-delivery
```

Install the marketplace plugin in Codex and start a new task. See [Distribution and updates](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md) for development builds and package checks.

To update installed files, upgrade the marketplace:

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

Restart Codex and start a new task after updating. See [Distribution and updates](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認) for startup configuration errors.

## License

The plugin's source, configuration, and documentation are provided under the [MIT License](LICENSE). Redistribution must include the bundled `LICENSE`, with its copyright notice and license text.
