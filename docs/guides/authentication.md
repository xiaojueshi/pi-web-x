# Browser authentication

[Documentation index](../README.md) · [Configuration](./configuration.md) · [Security policy](../../SECURITY.md)

Pi Web X uses Web Access Authentication for browsers and keeps `PI_WEB_X_PASSWORD` as a Basic Auth fallback for programmatic clients. Loopback binding reduces network exposure but does not replace authentication.

## First-run setup

When no browser password has been initialized, startup prints a cryptographically random, one-time setup token to stderr. Configuring `PI_WEB_X_PASSWORD` does not suppress that local setup token; it only provides an additional request-authentication path while setup is incomplete.

1. Start `pi-web-x` and keep the terminal private.
2. Open the displayed local URL.
3. Enter the setup token on the Setup page.
4. Create a strong password.
5. Store the password in an appropriate password manager.

The setup token exists only in memory, is consumed once, and is never returned by an HTTP endpoint or written to disk. Restarting before setup creates a different token. Do not include it in screenshots, issue reports, terminal recordings, or collected logs.

## Browser sessions

After login, the browser receives a random HttpOnly, SameSite=Lax session Cookie. Browser JavaScript cannot read the Cookie. Sessions expire and are revoked when the password changes; users can also sign out the current browser.

Authentication data is stored in two private files:

```text
~/.pi-web-x/auth/pi-web-auth.json
~/.pi-web-x/auth/pi-web-sessions.json
```

The first contains password-verification state. The second contains hashed session identifiers and expiry/generation metadata, never raw Cookie values. Protect both as private user data. They are deliberately separate from pi's shared `~/.pi/agent` directory.

The Settings → Security page can:

- change the password and revoke all existing browser sessions;
- sign out the current browser;
- show the current authentication state.

## Basic Auth fallback

Set a long random environment password for scripts or a proxy integration:

```bash
PI_WEB_X_PASSWORD='long-random-secret' pi-web-x --no-open
curl -u 'pi:long-random-secret' http://127.0.0.1:30141/api/home
```

The username is always `pi`. Basic Auth credentials are sent with each request and provide no transport encryption. Use HTTPS or a trusted private tunnel outside loopback.

Before browser setup, Basic Auth checks `PI_WEB_X_PASSWORD`. After a browser password has been initialized, Basic Auth checks that stored browser password instead; the environment fallback no longer wins. Browser session authentication and Basic Auth share the same request-security boundary but remain distinct credential mechanisms. The setup token is still printed locally until browser authentication is initialized.

## Reverse proxy guidance

A reverse proxy must:

- terminate HTTPS;
- overwrite, rather than append, forwarded host/scheme headers;
- restrict direct access to the backend listener;
- preserve the original same-origin relationship;
- forward only an explicitly configured hostname listed by `PI_WEB_X_ALLOWED_HOSTS` when it differs from the listener.

Forwarded scheme evidence is used for Secure Cookie behavior, so the proxy must overwrite forwarded headers and prevent direct untrusted backend access. Set `PI_WEB_X_TRUSTED_PROXY=true` only when those conditions hold and per-client login rate limiting should use `X-Forwarded-For`/`X-Real-IP`. This variable does not enable proxy scheme handling and does not disable Host or Origin validation.

## Rate limiting and recovery

Repeated failed logins are rate-limited. Do not automate password guessing or retry loops. If credentials are lost, stop the service, back up the authentication file, remove/reset it using an administrator-approved local process, and repeat first-run setup. Removing authentication state revokes existing sessions.

## SSE and running work

Authentication is checked when an SSE connection is established. A successfully established Agent stream is not interrupted solely to revalidate credentials mid-stream. New requests and reconnects must authenticate normally.

## Reporting authentication issues

Never open a public issue containing a setup token, password, session Cookie, authentication file, provider credential, or unredacted `~/.pi/agent` content. Follow [SECURITY.md](../../SECURITY.md) for suspected bypasses or credential exposure.
