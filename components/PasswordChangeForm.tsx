"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";

/** 改密表单属性。 */
export interface PasswordChangeFormProps {
  /** 改密成功后的回调（外层负责登出重定向）。 */
  onSuccess: () => void;
}

/**
 * 访问密码修改表单：提交到 /api/auth/password，成功后全量会话作废。
 *
 * @param props 组件属性
 * @param props.onSuccess 改密成功后的回调
 * @returns 改密表单
 */
export function PasswordChangeForm({ onSuccess }: PasswordChangeFormProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.newPassword !== values.confirmPassword) {
      setError(t("auth.error.AUTH_PASSWORD_MISMATCH"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          errorCode?: string;
        };
        setError(
          t(
            `auth.error.${body.errorCode ?? "AUTH_PASSWORD_CHANGE_FAILED"}`,
          ),
        );
        return;
      }
      form.reset();
      onSuccess();
    } catch {
      setError(t("auth.error.AUTH_NETWORK_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        {t("auth.currentPassword")}
        <input
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </label>
      <label>
        {t("auth.newPassword")}
        <input
          name="newPassword"
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
      {error && (
        <div className="auth-form-error" role="alert">
          {error}
        </div>
      )}
      <button className="auth-form-submit" type="submit" disabled={busy}>
        {busy ? t("auth.processing") : t("auth.saveAndRelogin")}
      </button>
    </form>
  );
}