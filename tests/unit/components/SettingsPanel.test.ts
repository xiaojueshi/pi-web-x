import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const panelSource = await readFile(
  new URL("../../../components/SettingsPanel.tsx", import.meta.url),
  "utf8",
);
const cssSource = await readFile(
  new URL("../../../app/settings.css", import.meta.url),
  "utf8",
);
const shellSource = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const sidebarSource = await readFile(
  new URL("../../../components/SessionSidebar.tsx", import.meta.url),
  "utf8",
);
const themeSource = await readFile(
  new URL("../../../hooks/useTheme.ts", import.meta.url),
  "utf8",
);
const enSource = await readFile(
  new URL("../../../lib/i18n/messages/en.ts", import.meta.url),
  "utf8",
);
const zhSource = await readFile(
  new URL("../../../lib/i18n/messages/zh-CN.ts", import.meta.url),
  "utf8",
);

test("opens one settings panel from direct sidebar shortcuts", () => {
  assert.match(shellSource, /<SettingsPanel/);
  assert.match(shellSource, /setSettingsSection\(section\)/);
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.match(shellSource, /translate\("common\.settings"\)/);
  assert.match(
    shellSource,
    /<SettingsSectionIcon[\s\S]*?section=\{section\}[\s\S]*?size=\{14\}[\s\S]*?strokeWidth=\{2\}[\s\S]*?\/>\s*<span>\{label\}<\/span>/,
  );
  assert.match(
    shellSource,
    /<SettingsSectionIcon section="general" size=\{14\} strokeWidth=\{2\} \/>/,
  );
  assert.doesNotMatch(
    shellSource,
    /\["plugins", translate\("common\.plugins"\)\]/,
  );
  assert.doesNotMatch(
    shellSource,
    /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/,
  );
});

test("keeps enabled configuration surfaces inside the settings panel", () => {
  for (const section of ["general", "models", "agents", "skills", "plugins"]) {
    assert.ok(panelSource.includes(`id: "${section}"`));
  }
  assert.match(panelSource, /<ModelsConfig[\s\S]*?embedded/);
  assert.match(panelSource, /<SkillsConfig[\s\S]*?embedded/);
  assert.match(panelSource, /<PluginsConfig[\s\S]*?embedded/);
  assert.match(panelSource, /<SubagentsConfig[\s\S]*?projectTrust=/);
  assert.doesNotMatch(panelSource, /<AgentsConfig embedded/);
});

test("restores the settings section and each list detail selection", async () => {
  assert.match(shellSource, /getLastSettingsSection\(projectTrustCwd\)/);
  assert.match(
    panelSource,
    /setLastSettingsSection\(\s*initialSection === "security" \? "general" : initialSection,?\s*\)/,
  );
  assert.match(panelSource, /setLastSettingsSection\(nextSection\)/);
  for (const name of ["ModelsConfig", "SkillsConfig", "PluginsConfig"]) {
    assert.match(
      await readFile(
        new URL(`../../../components/${name}.tsx`, import.meta.url),
        "utf8",
      ),
      /getLastSettingsSelection/,
    );
  }
});

test("keeps visited settings sections mounted and contains nested Escape handling", async () => {
  const modelsSource = await readFile(
    new URL("../../../components/ModelsConfig.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panelSource, /mountedSections\.has\(id\)/);
  assert.match(panelSource, /hidden=\{section !== id\}/);
  assert.match(panelSource, /event\.defaultPrevented/);
  assert.match(
    modelsSource,
    /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onClose\(\);/,
  );
});

test("offers direct light, dark, and system theme selection", () => {
  for (const preference of ["light", "dark", "auto"]) {
    assert.ok(panelSource.includes(`id: "${preference}"`));
  }
  assert.match(panelSource, /setThemePreference\(option\.id\)/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
});

test("keeps General free of divider rows", () => {
  assert.match(panelSource, /className="settings-dialog-header"/);
  assert.match(
    cssSource,
    /\.settings-dialog-header \{[\s\S]*?display: flex[\s\S]*?align-items: center[\s\S]*?min-height: 50px/,
  );
  assert.doesNotMatch(
    panelSource,
    /sections\.find\(\(item\) => item\.id === section\)/,
  );
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
});

test("将常规与安全设置放入模型风格的左侧分类菜单", () => {
  assert.match(panelSource, /<ConfigSplitView>/);
  assert.match(panelSource, /<ConfigSidebar>/);
  assert.match(panelSource, /<ConfigSidebarList>/);
  assert.match(panelSource, /<ConfigSidebarGroupLabel>/);
  assert.match(panelSource, /id: "security"/);
  assert.match(
    panelSource,
    /initialSection === "security" \? "general" : initialSection/,
  );
  assert.match(cssSource, /\.settings-section-host > \.config-split-view \{/);
  assert.match(panelSource, /<main className="settings-dialog-main">/);
  assert.doesNotMatch(panelSource, /<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
});

test("labels agent profiles as sub-agents", () => {
  assert.match(enSource, /"common\.agents": "Sub-agents"/);
  assert.match(enSource, /"agents\.new": "New sub-agent"/);
  assert.match(zhSource, /"common\.agents": "子代理"/);
  assert.match(zhSource, /"agents\.new": "新建子代理"/);
});

test("uses the child-session robot glyph for the sub-agents tab", () => {
  const robotGlyph =
    /<rect x="5" y="7" width="14" height="11" rx="2" \/>\s*<path d="M9 11h\.01M15 11h\.01M9 15h6M12 7V4M10 4h4" \/>/;
  assert.match(panelSource, robotGlyph);
  assert.match(sidebarSource, robotGlyph);
  assert.match(
    panelSource,
    /section === "agents"[\s\S]*?className="settings-section-icon is-agent"/,
  );
  assert.match(
    cssSource,
    /\.settings-section-icon\.is-agent \{[\s\S]*?transform: scale\(1\.25\)/,
  );
});

test("将安全操作放入常规设置的安全分类", () => {
  assert.match(
    panelSource,
    /id: "security"[\s\S]*?label: t\("settings\.security"\)[\s\S]*?group: t\("settings\.security"\)/,
  );
  assert.match(panelSource, /t\("auth\.changePassword"\)/);
  assert.match(panelSource, /t\("auth\.logout"\)/);
  assert.doesNotMatch(panelSource, /SecuritySettings/);
  assert.doesNotMatch(cssSource, /\.settings-security-card/);
});

test("exposes global idle session reaping controls in General", () => {
  assert.match(panelSource, /settings\.idleReaping/);
  assert.match(panelSource, /idleSessionReaping/);
  assert.match(panelSource, /min=\{5\}/);
  assert.match(panelSource, /max=\{1_440\}/);
  assert.match(panelSource, /method: "PUT"/);
  assert.match(panelSource, /settings\.idleReapingInvalidTimeout/);
  assert.match(cssSource, /\.settings-idle-timeout \{/);
});

test("保存系统提示词后重载当前会话", () => {
  assert.match(panelSource, /fetch\("\/api\/system-prompt"/);
  assert.match(panelSource, /method: "PUT"/);
  assert.match(
    panelSource,
    /sendAgentCommand\(sessionId, \{ type: "reload" \}\)/,
  );
  assert.match(panelSource, /settings\.systemPromptSaveReload/);
  assert.match(panelSource, /settings\.systemPromptEmptyHint/);
  assert.match(cssSource, /\.settings-system-prompt \{/);
});

test("uses the compact controls glyph for General", () => {
  assert.match(
    panelSource,
    /section === "general"[\s\S]*?<path d="M20 7h-9M14 17H5" \/>[\s\S]*?<circle cx="7" cy="7" r="3" \/>[\s\S]*?<circle cx="17" cy="17" r="3" \/>/,
  );
});
