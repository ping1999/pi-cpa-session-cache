# Pi CPA Session Cache（项目级）

只向选定的 CPA 模型请求添加 `X-Pi-Cache-Session: <Pi Session ID>`，不修改 user、system、消息历史或请求体。需要配套的 [CPA 插件](https://github.com/ping1999/cpa-pi-session-cache)。

## 项目级安装

在**要启用的项目目录**运行：

```bash
pi install --local git:github.com/ping1999/pi-cpa-session-cache
```

这会写入该项目的 `.pi/settings.json`，不是 `~/.pi/agent/settings.json`。也可手动合并配置，保留已有字段：

```json
{
  "packages": ["git:github.com/ping1999/pi-cpa-session-cache"]
}
```

然后创建该项目的 `.pi/cpa-cache-session.json`：

```json
{
  "enabled": true,
  "providers": ["你的CPA provider名称"],
  "baseUrls": ["http://127.0.0.1:8317/v1"]
}
```

- `providers` 精确匹配 provider 名；`baseUrls` 精确匹配 base URL（忽略末尾 `/`）。可只填一个数组；两者都填时须同时匹配。
- 没有配置文件、未信任项目、`enabled: false`、目标不匹配：不处理。
- 没有目标白名单或配置错误：不发送 header；有 UI 时提示一次警告。
- 不写入 Authorization，不修改已有的 CPA/Codex/Claude 会话头。
- 配置每次请求检查，修改后下一次请求生效；安装后在 Pi / Pi Web 中 `/reload` 或重开会话加载扩展。
- 只支持 `openai-completions`，因为配套 CPA 插件的桥接目前只验证了 OpenAI Chat Completions 入口。

## 行为和边界

- Pi Web 消息下方“新会话”、Pi `/fork`、`/clone`：新 Pi ID → 新 Antigravity ID。
- 同一会话继续、恢复、重试、刷新页面：保持原 ID。
- “从这里编辑”、`/tree`：Pi ID 不变，**不会**自动分配新 namespace。
- Pi Web Chat only 不加载普通扩展；请使用普通/只读工具模式。
- 子代理或 SDK 自行发起的请求不一定经过该主会话钩子；不保证覆盖。
- 传送的是真实 Pi Session ID，仅发给白名单目标；它不是密码或鉴权手段。
- 改上游 sessionId 不保证 Google 内部所有缓存清空，也不保证计费变化。

## 更新、卸载

```bash
# 在该项目中执行；Git 来源不固定 tag，更新时跟随默认分支
pi update --extensions
# 更新后 /reload 或重开会话
pi remove --local git:github.com/ping1999/pi-cpa-session-cache
```

也可以在 Pi Web 的项目包配置里管理同一个 Git 来源。不要同时装全局副本和项目副本。需要固定版本时把来源改成 `git:github.com/ping1999/pi-cpa-session-cache@v0.1.0`。

## 开发

```bash
npm install --ignore-scripts --legacy-peer-deps
npm test
```

扩展运行时由 Pi 提供 `@earendil-works/pi-coding-agent`，不打包宿主。类型检查需要该 peer 在本机可解析（开发时可安装匹配版本或链接 Pi 自带的包），然后 `npm run typecheck`。Node 22 需要支持 `--experimental-strip-types` 的版本；Node 26 已验证。

测试覆盖：白名单、项目隔离、未信任项目、错误配置、fork/resume ID、并发上下文、大小写重复头和无效 ID。验证基线：Pi 1.5.2 / Pi Web 0.17.0。
