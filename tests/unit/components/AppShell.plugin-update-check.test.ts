import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const source = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);

test("the app shells in a background plugin update check per page load", () => {
  // 页面加载或切换项目 cwd 后触发一次只读的后台检查，结果进入全局 store
  assert.match(
    source,
    /import \{ requestPluginUpdateCheck \} from "@\/lib\/plugin-update-store";/,
  );
  const effect = source.slice(
    source.indexOf(
      "const [activeCwd, setActiveCwd] = useState<string | null>(null);",
    ),
    source.indexOf(
      "const [activeCwd, setActiveCwd] = useState<string | null>(null);",
    ) + 700,
  );
  assert.match(effect, /useEffect\(\(\) => \{/);
  assert.match(
    effect,
    /requestPluginUpdateCheck\(activeCwd, \{ silent: true \}\)/,
  );
  // 检查依赖 activeCwd：页面加载后 cwd 就绪即触发，切换项目也会重新检查
  assert.match(effect, /\}, \[activeCwd\]\);/);
});
