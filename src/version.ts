import packageJson from "../package.json";

/** 当前 pi-web-x 构建版本。 */
export const APP_VERSION = packageJson.version;

/** 当前打包的 pi coding agent 依赖版本。 */
export const PI_VERSION = packageJson.dependencies["@earendil-works/pi-coding-agent"] ?? "unknown";
