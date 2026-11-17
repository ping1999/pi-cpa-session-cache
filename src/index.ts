import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const HEADER = "X-Pi-Cache-Session";
export const CONFIG_FILE = ".pi/cpa-cache-session.json";

type Model = { provider: string; api: string; baseUrl: string };
export type Config = { enabled: boolean; providers: string[]; baseUrls: string[] };

export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是 JSON 对象");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!["enabled", "providers", "baseUrls"].includes(key)) throw new Error(`未知配置项: ${key}`);
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("enabled 必须是 boolean");
  const list = (key: string): string[] => {
    const value = input[key] ?? [];
    if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || !x.trim())) throw new Error(`${key} 必须是非空字符串数组`);
    return [...new Set(value.map((x: string) => x.trim()))];
  };
  const config = { enabled: input.enabled !== false, providers: list("providers"), baseUrls: list("baseUrls") };
  config.baseUrls = config.baseUrls.map(normalizeBaseUrl);
  if (config.enabled && config.providers.length === 0 && config.baseUrls.length === 0) throw new Error("必须配置 providers 或 baseUrls，默认不向所有模型发送会话 ID");
  return config;
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("baseUrls 必须是无凭据、查询或片段的 HTTP(S) 地址");
  return url.toString().replace(/\/+$/, "");
}

export function matches(config: Config, model: Model | undefined): boolean {
  // The paired CPA plugin deliberately supports this input protocol only.
  if (!config.enabled || !model || model.api !== "openai-completions") return false;
  if (config.providers.length && !config.providers.includes(model.provider)) return false;
  if (config.baseUrls.length) {
    try { if (!config.baseUrls.includes(normalizeBaseUrl(model.baseUrl))) return false; }
    catch { return false; }
  }
  return true;
}

export function setSessionHeader(headers: Record<string, string | null | undefined>, sessionId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) throw new Error("Pi Session ID 不符合 CPA 插件的 1–128 字节标识格式");
  // HTTP names are case-insensitive; avoid retaining a differently cased stale ID.
  for (const name of Object.keys(headers)) if (name.toLowerCase() === HEADER.toLowerCase()) delete headers[name];
  headers[HEADER] = sessionId;
}

export default function cpaCacheSession(pi: ExtensionAPI): void {
  // Cache by cwd and contents, not just process-global state: several Pi Web
  // sessions can run concurrently. The session ID is always read from this ctx.
  let lastPath: string | undefined;
  let lastRaw: string | undefined;
  let lastConfig: Config | undefined;
  let lastWarning: string | undefined;
  pi.on("before_provider_headers", (event, ctx) => {
    const path = join(ctx.cwd, CONFIG_FILE);
    try {
      if (!ctx.isProjectTrusted()) return;
      let raw: string;
      try { raw = readFileSync(path, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (lastPath !== path || lastRaw !== raw || !lastConfig) {
        lastConfig = parseConfig(JSON.parse(raw));
        lastPath = path;
        lastRaw = raw;
      }
      if (matches(lastConfig, ctx.model)) setSessionHeader(event.headers, ctx.sessionManager.getSessionId());
      lastWarning = undefined;
    } catch (error) {
      const message = `CPA cache session: ${error instanceof Error ? error.message : String(error)} (${path})`;
      // Configuration problems disable this extension's header, not the run.
      if (message !== lastWarning) {
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        lastWarning = message;
      }
    }
  });
}
