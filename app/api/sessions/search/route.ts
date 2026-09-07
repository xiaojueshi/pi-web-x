import { HttpResponse } from "@/src/server/http";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";


// GET /api/sessions/search?q=... - 会话 JSONL 字面全文搜索。
export async function GET(request: Request) {
  // pi-lens-ignore: unchecked-throwing-call — 服务端构造的 Request URL 恒为合法 URL
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200) {
    return HttpResponse.json(
      { error: "Search query exceeds 200 characters" },
      { status: 400, headers },
    );
  }
  try {
    // 路径仅来自侧边栏使用的同一会话目录。
    const sessions =
      query && !request.signal.aborted ? await listAllSessions() : [];
    return HttpResponse.json(
      await searchSessionContents(sessions, query, request.signal),
      { headers },
    );
  } catch (error) {
    return HttpResponse.json(
      { error: String(error) },
      { status: 500, headers },
    );
  }
}
