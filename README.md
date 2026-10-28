English | [日本語](README.ja.md)

# matsu-artifact-delivery

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![artifact-workflow version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fartifact-workflow%2Fplugin.json&query=%24.version&label=artifact-workflow)](plugins/artifact-workflow/plugin.json)
[![expert-escalation version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fexpert-escalation%2Fplugin.json&query=%24.version&label=expert-escalation)](plugins/expert-escalation/plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)
[![MCP: Windows x64 only](https://img.shields.io/badge/MCP-Windows%20x64%20only-lightgrey.svg)](plugins/artifact-workflow/README.md#mcp-runtime)

A collection of Codex plugins for artifact workflows and focused, read-only consultation on design, security, and change impact.

## Plugins

| Plugin                                                   | Purpose                                                                                                          | Documentation                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [artifact-workflow](plugins/artifact-workflow/README.md) | Plans work, then coordinates approval, artifact generation, independent review, and verification.                | [README](plugins/artifact-workflow/README.md) |
| [expert-escalation](plugins/expert-escalation/README.md) | Routes explicitly requested questions to a read-only advisor while the original worker continues implementation. | [README](plugins/expert-escalation/README.md) |

## Install with Codex

Add the GitHub marketplace; Codex fetches the repository. Install either or both plugins:

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
# Or:
codex plugin add expert-escalation@matsu-artifact-delivery
```

`artifact-workflow` includes an MCP runtime for Windows x64. This platform requirement applies to that bundled MCP runtime; it does not apply to `expert-escalation`.

## Development and distribution

See [AGENTS.md](AGENTS.md) for development guidance and [Distribution and updates](docs/distribution.md) for build, package, and public Plugins Directory submission details. Review [Manufacturing and review](docs/manufacturing-review.md), [Testing review](docs/testing-review.md), and [Tests and change-based CI](docs/testing.md) as needed.

## License

The plugins are provided under the MIT License. See [LICENSE](LICENSE) for terms.
