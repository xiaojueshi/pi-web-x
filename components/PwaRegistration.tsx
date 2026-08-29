import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      const appVersion = document.documentElement.dataset.appVersion ?? "dev";
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker
        .register(scriptUrl, {
          scope: "/",
          updateViaCache: "none",
        })
        .catch((error: unknown) => {
          console.error(
            "Failed to register the Pi Web X service worker:",
            error,
          );
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
