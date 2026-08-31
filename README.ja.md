# Pi Web X

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

Pi Web X は [pi coding agent](https://github.com/earendil-works/pi) 用の Bun ネイティブなローカル Web UI です。プラットフォーム固有の実行ファイルとして動作し、pi の既存セッション、モデル、認証情報、拡張、skills、prompts、themes を使用します。

> Pi Web X は `pi-web@0.8.11`（`28bab3c`）を基にした独立実装です。製品名前空間は分離されており、旧 `pi-web:*` のブラウザー設定や session custom entries は読み込み・移行しません。

## 主な機能

- macOS、Linux（glibc/musl）、Windows の x64/arm64 向け単一ネイティブ実行ファイル。
- ブラウザーで React 19 CSR を実行。Next.js、RSC、SSR、Node.js サーバー runtime は使用しません。
- セッション、Agent streaming、ファイル、Git/worktree、モデルと認証情報、plugins、skills、prompts、themes、subagents、PWA をサポート。
- 既定では loopback のみを listen し、Host/Origin 検証とブラウザーパスワード認証を実施。
- pi 共有データは `~/.pi/agent`、Pi Web X 固有データは `~/.pi-web-x` に保存。

## インストール

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Windows PowerShell 5.1 以降：

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

スクリプトは OS、CPU、Linux libc を検出し、一致する GitHub Release をダウンロードして `SHA256SUMS` を検証します。必要に応じて、shell に渡す前にスクリプトを確認してください。

手動の場合は [GitHub Releases](https://github.com/xiaojueshi/pi-web-x/releases) から実行ファイルを取得します：

```bash
./pi-web-x
# http://127.0.0.1:30141 を開く
```

| 利用方法 | Bun | Node.js |
| --- | --- | --- |
| GitHub Release の実行ファイル | 不要 | 不要 |
| ソースから開発・ビルド | Bun 1.4.0 | 不要 |
| オプションの npm launcher | 不要 | launcher のみ必要 |
| plugin/skill の導入、一部 worktree 操作 | 不要 | 呼び出す機能により `git` と `npm`/`npx` が必要 |

コンパイル済み実行ファイルには Bun runtime が組み込まれています。`node:path` などは Bun の Node.js compatibility API であり、Node.js サーバーを意味しません。詳しくは[インストールと更新](./docs/guides/installation.md)を参照してください。

## 初回起動とセキュリティ

初回起動時、サーバーは一度だけ使用できる setup token を stderr に出力します。ブラウザーで token を入力してパスワードを作成してください。その後は HttpOnly session Cookie を使用します。認証データは `~/.pi-web-x/auth/` に保存され、`~/.pi/agent` の pi データとは分離されます。

既定の listen 先は `127.0.0.1` です。`-H 0.0.0.0` は高権限のプロジェクト操作をネットワークに公開します。ブラウザー認証または長いランダムな `PI_WEB_X_PASSWORD` と、HTTPS または信頼できる VPN を使用してください。ネットワーク公開前に [SECURITY.md](./SECURITY.md) を確認してください。

## 実行と設定

```text
pi-web-x [-p <port>] [-H <hostname>] [--no-open]
pi-web-x service install|uninstall
pi-web-x update [--check]
pi-web-x assets status
pi-web-x assets install <archive>
```

主な環境変数：

| 変数 | 用途 |
| --- | --- |
| `PORT` | ポート。既定値 `30141` |
| `PI_WEB_X_HOSTNAME` | listen アドレス。既定値 `127.0.0.1` |
| `PI_WEB_X_NO_OPEN` | `1/true/yes/on` でブラウザーを開かない |
| `PI_WEB_X_PASSWORD` | ユーザー名 `pi` の HTTP Basic Auth fallback |
| `PI_WEB_X_ALLOWED_HOSTS` | 追加で信頼する Host（カンマ区切り） |
| `PI_WEB_X_SKIP_VERSION_CHECK` | 更新確認を無効化 |

詳細は[設定](./docs/guides/configuration.md)、[ブラウザー認証](./docs/guides/authentication.md)、[システムサービス](./docs/guides/system-service.md)、[PWA](./docs/guides/pwa.md)、[Git worktree](./docs/guides/worktrees.md) を参照してください。

## 開発

開発、テスト、Release build には **Bun 1.4.0** を使用します：

```bash
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run lint
bun run build
```

TypeScript は `bun` と `node` の型宣言を明示的に読み込みます。Bun 型は実際の runtime を、Node 型は Bun 互換の `node:*` modules を表します。オプションの npm launcher は、プロジェクト内で実際に Node.js 上で動作する唯一の経路です。

変更前に [CONTRIBUTING.md](./CONTRIBUTING.md)、[architecture](./docs/development/architecture.md)、[Bun/Node boundary](./docs/development/bun-and-node.md)、[testing](./docs/development/testing.md) を確認してください。

## ドキュメントとサポート

[ドキュメント索引](./docs/README.md)には、ユーザーガイド、開発資料、architecture decisions、移行履歴、メンテナー手順があります。

- 質問と再現可能な不具合：[GitHub Issues](https://github.com/xiaojueshi/pi-web-x/issues)
- コントリビューション：[CONTRIBUTING.md](./CONTRIBUTING.md)
- セキュリティ脆弱性：[SECURITY.md](./SECURITY.md)
- 変更履歴：[CHANGELOG.md](./CHANGELOG.md)
- 行動規範：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## ライセンスと由来

[MIT](./LICENSE)。上流 pi-web の著作権とライセンス表示を保持しています。移行履歴は [`docs/history/bun-migration.md`](./docs/history/bun-migration.md)、現在の依存関係判断と一時的 workaround は [`docs/maintainers/`](./docs/maintainers/) にあります。
