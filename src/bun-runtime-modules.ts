import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/compat";

/**
 * 为 Bun 单文件二进制静态注册无法由变量形式 dynamic import 收集的运行时模块。
 *
 * @returns 无返回值。
 * @throws 不主动抛出异常；依赖模块若无法静态加载，会在本模块求值阶段失败。
 */
export function registerBunRuntimeModules(): void {
  registerBunOAuthFlows();
  setBedrockProviderModule(bedrockProviderModule);
}
