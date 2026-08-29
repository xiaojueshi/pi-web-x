import { HttpResponse } from "@/src/server/http";
import { homedir } from "os";

export async function GET() {
  return HttpResponse.json({ home: homedir() });
}
