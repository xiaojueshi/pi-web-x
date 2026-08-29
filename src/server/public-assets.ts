import { relative, resolve, sep } from "node:path";

const PUBLIC_ROOT = Bun.isStandaloneExecutable
  ? resolve(import.meta.dir, "public")
  : resolve(import.meta.dir, "../../public");

/** 从嵌入的 public 目录读取安全的静态资源响应；非资源路径返回 null。 */
export async function servePublicAsset(
  pathname: string,
): Promise<Response | null> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith("/") || decodedPath.includes("\0")) return null;
  const candidate = resolve(PUBLIC_ROOT, `.${decodedPath}`);
  const candidateRelative = relative(PUBLIC_ROOT, candidate);
  if (
    candidateRelative === "" ||
    candidateRelative === ".." ||
    candidateRelative.startsWith(`..${sep}`)
  )
    return null;
  const file = Bun.file(candidate);
  if (!(await file.exists())) return null;
  const headers = new Headers();
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  if (pathname === "/sw.js") headers.set("Service-Worker-Allowed", "/");
  return new Response(file, { headers });
}
