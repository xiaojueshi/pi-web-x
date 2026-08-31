import { getAuthState } from "@/lib/pi-web-auth";
import {
  getAuthenticatedSession,
  touchAuthenticatedSession,
} from "@/lib/pi-web-auth-route";

/** 返回认证初始化状态与当前会话状态。
 * @param request 当前 HTTP 请求
 * @returns 认证状态 JSON 响应
 */
export async function GET(request: Request) {
  try {
    // 有效会话在此顺带滑动续期（页面保活端点）
    touchAuthenticatedSession(request);
    const state = await getAuthState();
    return Response.json({
      initialized: state.initialized,
      authenticated:
        state.initialized && getAuthenticatedSession(request).valid,
    });
  } catch {
    return Response.json(
      { error: "Failed to read authentication status" },
      { status: 500 },
    );
  }
}