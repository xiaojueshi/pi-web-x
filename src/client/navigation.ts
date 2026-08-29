import { useCallback, useSyncExternalStore } from "react";

const NAVIGATION_EVENT = "pi-web-x:navigation";

/** 通知 location store 当前 URL 已被程序化更新。 */
export function notifyNavigation(): void {
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

/** 以 replaceState 更新地址并同步通知 React 订阅者。 */
export function replace(url: string): void {
  window.history.replaceState(null, "", url);
  notifyNavigation();
}

/** 返回与 Next useRouter 兼容的最小 replace API，并忽略仅影响 Next 滚动行为的选项。 */
export function useRouter(): {
  replace: (url: string, options?: { scroll?: boolean }) => void;
} {
  return {
    replace: useCallback((url: string, options?: { scroll?: boolean }) => {
      void options;
      replace(url);
    }, []),
  };
}

/** 返回随 popstate 和程序化导航更新的查询参数。 */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    (listener) => {
      window.addEventListener("popstate", listener);
      window.addEventListener(NAVIGATION_EVENT, listener);
      return () => {
        window.removeEventListener("popstate", listener);
        window.removeEventListener(NAVIGATION_EVENT, listener);
      };
    },
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search);
}
