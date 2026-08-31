# Pi Web X documentation

This index is the entry point for all maintained project documentation. The root [README](../README.md) is the product overview; this directory contains task-oriented guides, development contracts, architecture decisions, history, and maintainer procedures.

## Documentation map

```text
docs/
├── README.md                     # This index
├── guides/                       # Installation and product usage
├── development/                  # Architecture, runtime, testing, i18n, docs rules
├── adr/                          # Existing Agent/architecture dependency records (unchanged)
├── history/                      # Completed migration records; not current plans
└── maintainers/                  # Release and dependency maintenance procedures
    └── release-notes/            # Frozen release documents
```

## User guides

- [Installation and updates](./guides/installation.md)
- [CLI and environment configuration](./guides/configuration.md)
- [Browser authentication](./guides/authentication.md)
- [System service registration](./guides/system-service.md)
- [PWA companion behavior](./guides/pwa.md)
- [Git worktrees](./guides/worktrees.md) · [简体中文](./guides/worktrees.zh-CN.md)

## Development

- [Architecture overview](./development/architecture.md)
- [Bun and Node.js runtime/type boundaries](./development/bun-and-node.md)
- [Testing and validation](./development/testing.md)
- [UI internationalization](./development/i18n.md)
- [Documentation conventions](./development/documentation.md)
- [Contributing guide](../CONTRIBUTING.md)

## Architecture and history

- [Agent/domain context](../CONTEXT.md) (kept at its established path)
- [Architecture Decision Records](./adr/) (Agent dependencies; not reorganized here)
- [Historical Bun migration](./history/bun-migration.md)

Operational instructions in user and development guides take precedence when a historical record describes an earlier implementation state.

## Maintainers

- [Maintainer index](./maintainers/README.md)
- [Release process](./maintainers/release.md)
- [Runtime substitution matrix](./maintainers/runtime-substitution-matrix.md)
- [Temporary upstream workarounds](./maintainers/upstream-workarounds.md)
- [Release notes index](./maintainers/release-notes/README.md)

## Root project policies

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Product overview, installation, and navigation |
| [CONTRIBUTING](../CONTRIBUTING.md) | Development and contribution workflow |
| [SECURITY](../SECURITY.md) | Supported versions, security model, private reporting |
| [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | Community behavior and enforcement |
| [SUPPORT](../SUPPORT.md) | Where to ask questions or report problems |
| [CHANGELOG](../CHANGELOG.md) | Concise user-visible version history |
| [LICENSE](../LICENSE) | MIT license and retained upstream notice |

## Language and status

- `README.md` is the canonical English project entry. Complete Chinese, Japanese, and Russian README translations are kept beside it.
- Deep technical documents retain their established language when translation would create duplicate sources of truth. The title and index must make the audience clear.
- A current guide describes supported behavior. A historical document must say that it is historical. Release notes are frozen after release. Existing Agent context and ADR files retain their established paths and are outside this documentation reorganization.
- Product text uses **Pi Web X** and the `pi-web-x` / `PI_WEB_X_*` / `pi-web-x:*` namespaces. “pi-web” is used only when referring to the upstream project or migration history.

When moving a public document, update all repository links and leave a small compatibility page at a well-known root path when external links are likely to exist. See [documentation conventions](./development/documentation.md).
