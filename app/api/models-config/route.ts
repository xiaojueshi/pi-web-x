import { HttpResponse } from "@/src/server/http";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";


export async function GET() {
  return HttpResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    writeModelsConfig(body);
    return HttpResponse.json({ success: true });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}
