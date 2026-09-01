"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  SESSION_AUTH_STATUS_EVENT,
  type SessionAuthStatus,
} from "@/lib/session-keepalive";

type AuthStatus = SessionAuthStatus;

/** AuthGate 的三种界面状态。 */
type AuthView = "loading" | "setup" | "login" | "app";

/** 认证状态检查结果。 */
interface AuthResult {
  view: AuthView;
  /** 未初始化时是否需要展示 setup token 提示。 */
  setupRequired: boolean;
}

/** 解析服务端认证状态为界面视图。 */
function resolveView(status: AuthStatus | null): AuthResult {
  if (!status) return { view: "loading", setupRequired: false };
  if (!status.initialized) return { view: "setup", setupRequired: true };
  if (!status.authenticated) return { view: "login", setupRequired: false };
  return { view: "app", setupRequired: false };
}

/** 认证墙属性。 */
export interface AuthGateProps {
  /** 通过认证后渲染的应用主体。 */
  children: React.ReactNode;
  /** 会话失效（登出/改密）时的回调，用于通知外层刷新。 */
  onSessionChanged?: () => void;
}

/**
 * Web 访问认证墙：未初始化渲染 setup 表单，未认证渲染登录表单，
 * 认证通过后渲染应用主体（children）。
 *
 * @param props 组件属性
 * @param props.children 认证通过后渲染的应用主体
 * @param props.onSessionChanged 会话失效时的回调
 * @returns 认证墙或应用主体
 */
export function AuthGate({ children, onSessionChanged }: AuthGateProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [checkToken, setCheckToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 重新检查认证状态（登出/登录成功后调用）。 */
  const refresh = useCallback(() => setCheckToken((token) => token + 1), []);

  useEffect(() => {
    const onAuthStatus = (event: Event) => {
      const detail = (event as CustomEvent<SessionAuthStatus>).detail;
      if (
        typeof detail?.initialized !== "boolean" ||
        typeof detail.authenticated !== "boolean"
      ) {
        return;
      }
      setError(null);
      setStatus(detail);
      onSessionChanged?.();
    };
    window.addEventListener(SESSION_AUTH_STATUS_EVENT, onAuthStatus);
    return () =>
      window.removeEventListener(SESSION_AUTH_STATUS_EVENT, onAuthStatus);
  }, [onSessionChanged]);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    fetch("/api/auth/status")
      .then((res) => (res.ok ? (res.json() as Promise<AuthStatus>) : null))
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [checkToken]);

  const view = resolveView(status);

  // 认证通过：渲染应用主体
  if (view.view === "app") return <>{children}</>;

  const submitSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.password !== values.confirmPassword) {
      setError(t("auth.error.AUTH_PASSWORD_MISMATCH"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          errorCode?: string;
        };
        setError(t(`auth.error.${body.errorCode ?? "AUTH_SETUP_FAILED"}`));
        return;
      }
      form.reset();
      refresh();
    } catch {
      setError(t("auth.error.AUTH_NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (typeof values.password !== "string" || !values.password) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          errorCode?: string;
        };
        setError(t(`auth.error.${body.errorCode ?? "AUTH_LOGIN_FAILED"}`));
        return;
      }
      form.reset();
      onSessionChanged?.();
      refresh();
    } catch {
      setError(t("auth.error.AUTH_NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  };

  const isSetup = view.view === "setup";
  return (
    <div className="auth-wall">
      <div className="auth-card">
        <h1 className="auth-title">{t("common.appName")}</h1>
        <h2 className="auth-subtitle">
          {isSetup ? t("auth.setupTitle") : t("auth.loginTitle")}
        </h2>
        {isSetup && (
          <p className="auth-description">{t("auth.setupDescription")}</p>
        )}
        {error && (
          <div className="auth-form-error" role="alert">
            {error}
          </div>
        )}
        <form
          className="auth-form"
          onSubmit={isSetup ? submitSetup : submitLogin}
        >
          {isSetup && (
            <>
              <label>
                {t("auth.setupToken")}
                <input
                  name="token"
                  type="text"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <label>
                {t("auth.newPassword")}
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label>
                {t("auth.confirmNewPassword")}
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </label>
            </>
          )}
          {!isSetup && (
            <label>
              {t("auth.password")}
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
          )}
          <button className="auth-form-submit" type="submit" disabled={busy}>
            {busy ? t("auth.processing") : t("auth.submit")}
          </button>
        </form>
        {isSetup && <p className="auth-hint">{t("auth.setupHint")}</p>}
        {!status && !isSetup && (
          <p className="auth-hint">{t("auth.loading")}</p>
        )}
      </div>
    </div>
  );
}
