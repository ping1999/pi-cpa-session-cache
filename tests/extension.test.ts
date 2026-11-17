import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension, { HEADER, parseConfig, matches, setSessionHeader } from "../src/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const model = { provider: "cpa", api: "openai-completions", baseUrl: "http://localhost:8317/v1" };
test("explicit allowlist and exact endpoint matching", () => {
  assert.throws(() => parseConfig({}));
  assert.throws(() => parseConfig({ providers: "cpa" }));
  assert.throws(() => parseConfig({ providers: ["cpa"], typo: true }));
  assert.throws(() => parseConfig({ baseUrls: ["https://user:pass@example.com/v1"] }));
  const c = parseConfig({ providers: ["cpa"], baseUrls: [model.baseUrl + "/"] });
  assert.equal(matches(c, model), true);
  assert.equal(matches(c, { ...model, provider: "other" }), false);
  assert.equal(matches(c, { ...model, baseUrl: model.baseUrl + "/other" }), false);
  assert.equal(matches(c, { ...model, api: "anthropic-messages" }), false);
  assert.equal(matches(parseConfig({ enabled: false }), model), false);
});
test("replace stale header regardless of casing; validate IDs", () => {
  const headers = { "x-pi-cache-session": "old", Authorization: "untouched" };
  setSessionHeader(headers, "new-uuid");
  assert.deepEqual(headers, { Authorization: "untouched", [HEADER]: "new-uuid" });
  assert.throws(() => setSessionHeader(headers, "bad\r\nheader"));
});
test("real extension hook: project scope, fork/resume, config reload, concurrent sessions", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-cpa-test-"));
  const other = mkdtempSync(join(tmpdir(), "pi-cpa-other-"));
  try {
    mkdirSync(join(cwd, ".pi"));
    const configPath = join(cwd, ".pi/cpa-cache-session.json");
    writeFileSync(configPath, JSON.stringify({ providers: ["cpa"] }));
    let hook: (event: any, ctx: any) => void = () => { throw new Error("not registered"); };
    extension({ on(name: string, handler: typeof hook) {
      assert.equal(name, "before_provider_headers"); hook = handler;
    } } as unknown as ExtensionAPI);
    const run = (id: string, dir = cwd, trusted = true) => {
      const event = { headers: { Authorization: "unchanged" } };
      const ctx = { cwd: dir, model, hasUI: false, isProjectTrusted: () => trusted, sessionManager: { getSessionId: () => id } };
      hook(event, ctx); return event.headers as Record<string, string>;
    };
    assert.equal(run("parent")[HEADER], "parent");
    assert.equal(run("child")[HEADER], "child");
    assert.equal(run("parent")[HEADER], "parent");
    assert.equal(run("other", other)[HEADER], undefined);
    assert.equal(run("untrusted", cwd, false)[HEADER], undefined);
    for (let i = 0; i < 50; i++) assert.equal(run(`concurrent-${i}`)[HEADER], `concurrent-${i}`);
    writeFileSync(configPath, JSON.stringify({ enabled: false }));
    assert.equal(run("disabled")[HEADER], undefined);
    writeFileSync(configPath, "invalid");
    assert.equal(run("invalid-config")[HEADER], undefined);
  } finally { rmSync(cwd, { recursive: true }); rmSync(other, { recursive: true }); }
});
