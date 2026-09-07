export interface DiscoveredModel {
  id: string;
  name?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId =
    cleanString(value.id) ??
    cleanString(value.model) ??
    cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/")
    ? rawId.slice("models/".length)
    : rawId;
  if (!id) return null;
  const name =
    cleanString(value.display_name) ??
    cleanString(value.displayName) ??
    (cleanString(value.id) || cleanString(value.model)
      ? cleanString(value.name)
      : undefined);
  return name && name !== id ? { id, name } : { id };
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch (cause) {
    // 保持抛出契约，但带上更明确的错误信息。
    throw new Error(`Invalid base URL: ${baseUrl.trim()}`, { cause });
  }
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path))
      path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path))
      path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}
