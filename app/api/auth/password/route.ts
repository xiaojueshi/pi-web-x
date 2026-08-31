import { changePassword } from "@/lib/pi-web-auth";
import {
  authError,
  getAuthenticatedSession,
  readAuthJson,
  sessionCookie,
} from "@/lib/pi-web-auth-route";

/** 修改密码并作废全部既有会话。
 * @param request 当前 HTTP 请求
 * @returns 改密结果响应（成功时清除当前会话 cookie）
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    const session = getAuthenticatedSession(request);
    if (!session.valid) {
      return authError("AUTH_UNAUTHORIZED", "Not authenticated", 401);
    }
    if (
      typeof body.currentPassword !== "string" ||
      typeof body.newPassword !== "string" ||
      typeof body.confirmPassword !== "string"
    ) {
      return authError(
        "AUTH_INVALID_PARAMETERS",
        "Invalid request parameters",
        400,
      );
    }
    if (body.newPassword !== body.confirmPassword) {
      return authError("AUTH_PASSWORD_MISMATCH", "Passwords do not match", 400);
    }
    await changePassword(body.currentPassword, body.newPassword);
    const response = Response.json({ success: true });
    response.headers.set("Set-Cookie", sessionCookie(request, null));
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) {
      return authError(
        "AUTH_PASSWORD_CHANGE_FAILED",
        (error as Error).message,
        status,
      );
    }
    const message =
      error instanceof Error ? error.message : "Password change failed";
    if (
      message === "Invalid password length" ||
      message === "Invalid password format"
    ) {
      return authError("AUTH_PASSWORD_INVALID", "Invalid password format", 400);
    }
    return authError(
      "AUTH_PASSWORD_CHANGE_FAILED",
      "Password change failed",
      message === "Current password is incorrect" ? 401 : 500,
    );
  }
}