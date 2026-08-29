# Pi Web X

Pi Web X は [pi coding agent](https://github.com/earendil-works/pi) 用の Bun ネイティブなローカル Web UI です。単一バイナリとして実行され、pi の共通セッション、モデル、認証、拡張データを使用します。

## 実行

GitHub Release から対象プラットフォームのバイナリを取得してください。

```bash
./pi-web-x
# http://127.0.0.1:30141
```

バイナリの実行には Node.js/Bun は不要です。plugin、skill のインストール、worktree の一部機能には git、npm/npx が必要です。

`PI_WEB_X_PASSWORD`、`PI_WEB_X_HOSTNAME`、`PI_WEB_X_ALLOWED_HOSTS` を使用して設定します。loopback 以外へ公開する場合は、長いランダムなパスワードと HTTPS または信頼済み VPN を必ず使用してください。

詳細は [English documentation](./README.md) と [MIGRATION.md](./MIGRATION.md) を参照してください。

## License

[MIT](./LICENSE)。上流 pi-web の著作権表示とライセンスを保持します。
