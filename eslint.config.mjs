import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/** 构建产物、缓存与测试输出目录，不参与 lint。 */
const ignores = [
  "dist/**",
  "node_modules/**",
  ".next/**",
  ".build/**",
  "coverage/**",
  "test-results/**",
  "playwright-report/**",
  "**/*.tsbuildinfo",
];

export default tseslint.config(
  { ignores },
  ...tseslint.configs.recommended,
  {
    // React hooks 规则：仅作用于 ts/tsx（组件与 hooks 文件）
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // bin/: 发布用 CommonJS 启动器，必须使用 require
    files: ["bin/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      // 项目代码允许显式 any 用于防御性边界（后续按模块逐个收紧）
      "@typescript-eslint/no-explicit-any": "off",
      // React 事件回调常用下划线参数占位
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);