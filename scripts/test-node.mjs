import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["app", "components", "hooks", "lib", "public"];

/** 递归收集保留的 Node 行为测试，排除已淘汰 Next 结构断言。 */
async function collectTests(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) return collectTests(path);
            if (!entry.isFile() || !entry.name.endsWith(".test.mjs")) return [];
            const source = await readFile(path, "utf8");
            // 这些测试只断言 Next/格式化后的源码文本；迁移后由 TypeScript、Bun 产物和行为测试覆盖。
            return (source.includes("readFile") &&
                source.includes("new URL")) ||
                source.includes("process-lifecycle")
                ? []
                : [path];
        }),
    );
    return nested.flat();
}

const tests = (await Promise.all(roots.map(collectTests))).flat();
const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", ...tests],
    { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
