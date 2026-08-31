import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isPushSupported, setupPushSubscription } from "@/lib/push-client";
import {
  getPwaConnectionStatus,
  type PwaConnectionStatus,
} from "@/lib/pwa-client";

type AuthStatus = {
  initialized: boolean;
  authenticated: boolean;
};

const NOTIFICATION_OFFER_EVENT = "pi-web-x:offer-notifications";

function getConnectionStatus(): PwaConnectionStatus | null {
  try {
    return getPwaConnectionStatus(
      new URL(window.location.href),
      window.isSecureContext,
    );
  } catch {
    return null;
  }
}

/**
 * 注册 Service Worker，并以用户确认的方式应用更新、引导通知权限与提示不安全连接。
 * @returns PWA 运行状态提示组件
 */
export function PwaRegistration() {
  const { locale, t } = useI18n();
  // 当前应用版本（用于 SW 脚本 URL 与升级完成提示的版本号展示）。
  const appVersion = document.documentElement.dataset.appVersion ?? "dev";
  const [updateReady, setUpdateReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [notificationOffer, setNotificationOffer] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [connectionNoticeDismissed, setConnectionNoticeDismissed] =
    useState(false);
  const [connection, setConnection] = useState<PwaConnectionStatus | null>(
    null,
  );
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    setConnection(getConnectionStatus());
    void fetch("/api/auth/status")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AuthStatus;
      })
      .then(setAuthStatus)
      .catch(() => setAuthStatus(null));
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let reloadAfterControllerChange = false;

    const showWaitingUpdate = () => {
      if (navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const handleControllerChange = () => {
      if (reloadAfterControllerChange) window.location.reload();
    };
    const observeRegistration = (nextRegistration: ServiceWorkerRegistration) => {
      registration = nextRegistration;
      if (nextRegistration.waiting) showWaitingUpdate();
      nextRegistration.addEventListener("updatefound", () => {
        const worker = nextRegistration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") showWaitingUpdate();
        });
      });
    };

    const register = () => {
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;
      void navigator.serviceWorker
        .register(scriptUrl, { scope: "/", updateViaCache: "none" })
        .then((nextRegistration) => {
          if (!disposed) observeRegistration(nextRegistration);
        })
        .catch((error: unknown) => {
          console.error("Failed to register the Pi Web X service worker:", error);
        });
    };

    const applyUpdate = () => {
      if (!registration?.waiting) return;
      reloadAfterControllerChange = true;
      setApplyingUpdate(true);
      registration.waiting.postMessage({ type: "PI_WEB_X_SKIP_WAITING" });
    };
    const handleApplyUpdate = () => applyUpdate();

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    window.addEventListener("pi-web-x:apply-update", handleApplyUpdate);

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      window.removeEventListener("pi-web-x:apply-update", handleApplyUpdate);
    };
  }, []);

  useEffect(() => {
    const dismissed = window.sessionStorage.getItem(
      "pi-web-x:notification-offer-dismissed",
    );
    const handleOffer = () => {
      if (
        dismissed ||
        !isPushSupported() ||
        Notification.permission !== "default"
      ) {
        return;
      }
      setNotificationOffer(true);
    };
    window.addEventListener(NOTIFICATION_OFFER_EVENT, handleOffer);
    return () =>
      window.removeEventListener(NOTIFICATION_OFFER_EVENT, handleOffer);
  }, []);

  const dismissNotificationOffer = useCallback(() => {
    try {
      window.sessionStorage.setItem(
        "pi-web-x:notification-offer-dismissed",
        "true",
      );
    } catch {
      // 存储不可用时仅在当前组件生命周期内关闭提示。
    }
    setNotificationOffer(false);
  }, []);

  const enableNotifications = useCallback(async () => {
    if (!isPushSupported() || Notification.permission !== "default") return;
    setNotificationBusy(true);
    try {
      if ((await Notification.requestPermission()) === "granted") {
        await setupPushSubscription(locale);
      }
    } finally {
      setNotificationBusy(false);
      setNotificationOffer(false);
    }
  }, [locale]);

  const connectionNotice =
    !connectionNoticeDismissed &&
    connection &&
    (!connection.pwaCapabilitiesAvailable || !authStatus?.authenticated);

  return (
    <div aria-live="polite" className="pwa-notices">
      {connectionNotice && (
        <section
          role="status"
          data-pwa-notice="connection"
          className="pwa-notice pwa-notice-security"
        >
          <div className="pwa-notice-header">
            <strong>{t("pwa.connectionSafetyTitle")}</strong>
            <button
              type="button"
              data-pwa-notice-close="connection"
              className="pwa-notice-close"
              aria-label={t("i18n.close")}
              title={t("i18n.close")}
              onClick={() => setConnectionNoticeDismissed(true)}
            >
              ×
            </button>
          </div>
          <p className="pwa-notice-description">
            {!connection.pwaCapabilitiesAvailable
              ? t("pwa.insecureConnection")
              : t("pwa.authenticationUnavailable")}
          </p>
          <p className="pwa-notice-description">
            {t("pwa.connectionKind", {
              kind: t(`pwa.connectionKind.${connection.kind}`),
            })}
          </p>
          <p className="pwa-notice-description">
            {t("pwa.connectionSafetyAdvice")}
          </p>
        </section>
      )}

      {notificationOffer && (
        <section
          role="status"
          data-pwa-notice="notification"
          className="pwa-notice pwa-notice-action"
        >
          <div className="pwa-notice-header">
            <strong>{t("pwa.notificationTitle")}</strong>
            <button
              type="button"
              data-pwa-notice-close="notification"
              className="pwa-notice-close"
              aria-label={t("i18n.close")}
              title={t("i18n.close")}
              onClick={dismissNotificationOffer}
            >
              ×
            </button>
          </div>
          <p className="pwa-notice-description pwa-notice-description-action">
            {t("pwa.notificationDescription")}
          </p>
          <div className="pwa-notice-actions">
            <button
              type="button"
              className="pwa-notice-button"
              onClick={dismissNotificationOffer}
            >
              {t("pwa.notNow")}
            </button>
            <button
              type="button"
              disabled={notificationBusy}
              className="pwa-notice-button"
              onClick={() => void enableNotifications()}
            >
              {notificationBusy ? t("pwa.enabling") : t("pwa.enableNotifications")}
            </button>
          </div>
        </section>
      )}

      {updateReady && (
        <section
          role="status"
          data-pwa-notice="update"
          className="pwa-notice pwa-notice-action"
        >
          <div className="pwa-notice-header">
            <strong>{t("pwa.updateReadyTitle")}</strong>
            <button
              type="button"
              data-pwa-notice-close="update"
              className="pwa-notice-close"
              aria-label={t("i18n.close")}
              title={t("i18n.close")}
              onClick={() => setUpdateReady(false)}
            >
              ×
            </button>
          </div>
          <p className="pwa-notice-description pwa-notice-description-action">
            {t("pwa.updateReadyDescription", { version: appVersion })}
          </p>
          <button
            type="button"
            disabled={applyingUpdate}
            className="pwa-notice-button"
            onClick={() => window.dispatchEvent(new Event("pi-web-x:apply-update"))}
          >
            {applyingUpdate ? t("pwa.updating") : t("pwa.applyUpdate")}
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * 在后台任务首次结束时请求非侵入式通知授权入口。
 * @returns 无返回值
 */
export function offerPwaNotifications(): void {
  window.dispatchEvent(new Event(NOTIFICATION_OFFER_EVENT));
}
