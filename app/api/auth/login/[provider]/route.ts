import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks:
    | Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>
    | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as {
    token?: string;
    code?: string;
  };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json(
      { error: "No pending login for token" },
      { status: 404 },
    );
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json(
      { error: "Token does not match provider" },
      { status: 400 },
    );
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const encoder = new TextEncoder();

  // SSE 注释帧（":" 开头）会被 EventSource 忽略，仅用于保活：Bun.serve
  // 默认 idleTimeout 为 10 秒，空闲 SSE 连接会被强制断开（客户端表现为
  // "Connection lost"）。心跳间隔必须小于该超时值。
  const HEARTBEAT_INTERVAL_MS = 5_000;

  // AbortController propagates client disconnect into ModelRuntime.login().
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const stopHeartbeat = () => {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const enqueueSse = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // 流已被取消或关闭，停止心跳与后续写入
          closed = true;
          stopHeartbeat();
        }
      };

      const send = (data: unknown) => {
        enqueueSse(`data: ${JSON.stringify(data)}\n\n`);
      };

      const closeStream = () => {
        closed = true;
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          /* stream already closed */
        }
      };

      // 定时发送 SSE 注释帧，防止空闲连接被 Bun 的 idleTimeout 断开
      heartbeat = setInterval(() => enqueueSse(":\n\n"), HEARTBEAT_INTERVAL_MS);

      const modelRuntime = await ModelRuntime.create();
      if (!modelRuntime.getProvider(provider)?.auth.oauth) {
        send({
          type: "error",
          message: `Unknown provider: ${provider}`,
        });
        closeStream();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest:
        | { token: string; promise: Promise<string> }
        | undefined;

      const createClientInputRequest = () => {
        // crypto.randomUUID：与 Math.random 不同，具备加密强度，避免规则告警
        const token = `${provider}-${Date.now()}-${crypto.randomUUID()}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        await modelRuntime.login(provider, "oauth", {
          prompt: async (prompt: AuthPrompt) => {
            const request =
              prompt.type === "manual_code"
                ? getManualInputRequest()
                : createClientInputRequest();
            if (prompt.type === "select") {
              send({
                type: "select_request",
                message: prompt.message,
                options: prompt.options,
                token: request.token,
              });
            } else {
              send({
                type: "prompt_request",
                message: prompt.message,
                placeholder: prompt.placeholder ?? null,
                token: request.token,
              });
            }
            return request.promise;
          },
          notify: (event: AuthEvent) => {
            if (event.type === "auth_url") {
              const request = getManualInputRequest();
              send({
                type: "auth",
                url: event.url,
                instructions: event.instructions ?? null,
                token: request.token,
              });
            } else if (event.type === "device_code") {
              send({
                type: "device_code",
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds ?? null,
                expiresInSeconds: event.expiresInSeconds ?? null,
              });
            } else {
              send({ type: "progress", message: event.message });
            }
          },
          signal: abort.signal,
        });

        invalidateModelsCache();
        send({ type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send({ type: "error", message: msg });
        } else {
          send({ type: "cancelled" });
        }
      } finally {
        cleanup();
        closeStream();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
