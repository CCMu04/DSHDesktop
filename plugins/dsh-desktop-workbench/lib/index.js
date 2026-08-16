/**
 * dsh-desktop-workbench — host half.
 *
 * 工作台框架的服务端：
 *   - /api/desktop-workbench/config：框架总开关（enabled），与既有插件一致
 *     （默认值 ← 插件行 config ← $DSH_HOME/desktop-workbench.json）。
 *   - /api/desktop-workbench/layout：按会话持久化面板布局（打开状态、宽度、
 *     激活 tab、打开的文件），跨重启与跨设备一致，原子写入。
 *
 * 框架本身不承载任何功能逻辑（文件/终端/Git 等由独立功能插件提供），
 * 这里只负责开关与布局这两个持久化点。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Stable cordis plugin name (matches the bundle patch insert id). */
export const name = "dsh-desktop-workbench";

/** Services required before the routes can mount. */
export const inject = ["webServer"];

/** Framework switch default (on). */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
});

/** Layout bounds: width range, per-session entries and payload size. */
const LAYOUT_MIN_WIDTH = 240;
const LAYOUT_MAX_WIDTH = 720;
const LAYOUT_MAX_SESSIONS = 200;
const LAYOUT_MAX_BYTES = 32 * 1024;
const LAYOUT_MAX_SESSION_LENGTH = 128;

/**
 * Global preference schema (non-session state persisted across restarts):
 *   files.treeCollapsed — 文件面板目录树显隐
 *   files.treeWidth     — 文件面板目录树宽度
 *   git.listWidth       — Git 面板文件列表宽度
 *   git.historyHeight   — Git 面板历史区高度
 * Keys are whitelisted; unknown keys are dropped. localStorage is NOT usable
 * for these: the backend port changes every launch, so the web origin (and
 * with it the entire localStorage) changes too.
 */
const PREFS_SCHEMA = Object.freeze({
  "files.treeCollapsed": { type: "boolean" },
  "files.treeWidth": { type: "number", min: 100, max: 280 },
  "git.listWidth": { type: "number", min: 140, max: 420 },
  "git.historyHeight": { type: "number", min: 64, max: 320 },
});
const PREFS_MAX_BYTES = 4 * 1024;

/** Resolve the persistence directory ($DSH_HOME or ~/.dsh). */
function workbenchHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** Absolute path of the layout document. */
function layoutPath() {
  return join(workbenchHomeDir(), "desktop-workbench.json");
}

/** Tolerant read of the shared document: corrupt or absent file → {}. */
function readLayoutStore() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(layoutPath(), "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  return raw;
}

/**
 * Narrow an unknown layout payload to the fields we own. Null values are kept
 * and mean "clear this field" (merge semantics: the session layout is merged
 * with the incoming payload, so the workbench frame and feature plugins each
 * update only their own fields without clobbering each other).
 */
function narrowLayout(value) {
  if (typeof value !== "object" || value === null) return null;
  const out = {};
  if (typeof value.open === "boolean") out.open = value.open;
  if (typeof value.width === "number" && Number.isFinite(value.width)) {
    out.width = Math.min(
      LAYOUT_MAX_WIDTH,
      Math.max(LAYOUT_MIN_WIDTH, Math.round(value.width)),
    );
  }
  for (const field of ["activeTabId", "file", "repo"]) {
    if (value[field] === null) {
      out[field] = null;
    } else if (typeof value[field] === "string" && value[field].length > 0) {
      out[field] = value[field].slice(
        0,
        field === "file" ? 4096 : LAYOUT_MAX_SESSION_LENGTH,
      );
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Narrow a prefs payload against the whitelist schema; unknown keys dropped. */
function narrowPrefs(value) {
  if (typeof value !== "object" || value === null) return null;
  const out = {};
  for (const [key, spec] of Object.entries(PREFS_SCHEMA)) {
    const raw = value[key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === "boolean") {
      if (typeof raw === "boolean") out[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.min(spec.max, Math.max(spec.min, Math.round(raw)));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Atomic write of the layout document. */
function writeLayoutStore(store) {
  mkdirSync(workbenchHomeDir(), { recursive: true });
  const target = layoutPath();
  const temporaryPath = `${target}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporaryPath, target);
}

/** Write one JSON response. */
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Read a bounded JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("body-too-large"));
        queueMicrotask(() => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

/** Read a bounded query string parameter. */
function queryParam(url, key) {
  try {
    return new URL(url, "http://dsh.invalid").searchParams.get(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * 注册三条路由（都是 kind: exact，路径不同，无重复冲突）：
 *   /api/desktop-workbench/config   — 框架开关 GET/HEAD/POST
 *   /api/desktop-workbench/layout   — 会话布局 GET/HEAD/POST（merge 语义）
 *   /api/desktop-workbench/prefs    — 全局偏好 GET/HEAD/POST（文件/Git 插件状态）
 */
export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** Effective framework config: defaults ← patch layer ← user overrides. */
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readConfigOverrides() });

  /** Tolerant read of the switch document (same file as the layout store). */
  function readConfigOverrides() {
    let raw;
    try {
      raw = JSON.parse(readFileSync(layoutPath(), "utf8"));
    } catch {
      return {};
    }
    if (typeof raw !== "object" || raw === null) return {};
    return typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {};
  }

  const configRoute = {
    kind: "exact",
    path: "/api/desktop-workbench/config",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        const body = JSON.stringify(resolve());
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
          "cache-control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(body);
        return;
      }
      if (req.method === "POST") {
        readJsonBody(req).then(
          (body) => {
            if (typeof body?.enabled !== "boolean") {
              json(res, 400, { ok: false, error: "enabled-must-be-boolean" });
              return;
            }
            const store = readLayoutStore();
            writeLayoutStore({ ...store, enabled: body.enabled });
            json(res, 200, { ok: true, config: resolve() });
          },
          (error) => {
            json(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
        return;
      }
      json(res, 405, { ok: false, error: "method-not-allowed" });
    },
  };

  const layoutRoute = {
    kind: "exact",
    path: "/api/desktop-workbench/layout",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        const session = queryParam(req.url, "session");
        const store = readLayoutStore();
        const body = JSON.stringify({
          session,
          layout:
            typeof session === "string" && session.length > 0
              ? store.layouts?.[session] ?? null
              : null,
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
          "cache-control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(body);
        return;
      }
      if (req.method === "POST") {
        readJsonBody(req).then(
          (body) => {
            const session =
              typeof body?.session === "string" &&
              body.session.length > 0 &&
              body.session.length <= LAYOUT_MAX_SESSION_LENGTH
                ? body.session
                : null;
            const rawLayout = body?.layout;
            if (
              session === null ||
              typeof rawLayout !== "object" ||
              rawLayout === null
            ) {
              json(res, 400, {
                ok: false,
                error: "session-or-layout-invalid",
              });
              return;
            }
            // Size check on the raw payload before narrowing: narrowing must
            // never make an oversized body acceptable.
            if (Buffer.byteLength(JSON.stringify(rawLayout)) > LAYOUT_MAX_BYTES) {
              json(res, 400, { ok: false, error: "layout-too-large" });
              return;
            }
            const layout = narrowLayout(rawLayout);
            if (layout === null) {
              json(res, 400, {
                ok: false,
                error: "session-or-layout-invalid",
              });
              return;
            }
            const store = readLayoutStore();
            const layouts = { ...(store.layouts ?? {}) };
            // Merge semantics: the frame and feature plugins each persist their
            // own fields; null values clear the previous field.
            layouts[session] = { ...(layouts[session] ?? {}), ...layout };
            // Bound the store: drop oldest entries beyond the cap (insertion
            // order of a plain object is preserved for string keys).
            const keys = Object.keys(layouts);
            if (keys.length > LAYOUT_MAX_SESSIONS) {
              for (const key of keys.slice(0, keys.length - LAYOUT_MAX_SESSIONS)) {
                delete layouts[key];
              }
            }
            writeLayoutStore({ ...store, layouts });
            json(res, 200, { ok: true, layout: layouts[session] });
          },
          (error) => {
            json(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
        return;
      }
      json(res, 405, { ok: false, error: "method-not-allowed" });
    },
  };

  const prefsRoute = {
    kind: "exact",
    path: "/api/desktop-workbench/prefs",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        const store = readLayoutStore();
        const body = JSON.stringify({ prefs: store.prefs ?? {} });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
          "cache-control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(body);
        return;
      }
      if (req.method === "POST") {
        readJsonBody(req).then(
          (body) => {
            const rawPrefs = body?.prefs;
            if (
              typeof rawPrefs !== "object" ||
              rawPrefs === null
            ) {
              json(res, 400, { ok: false, error: "prefs-invalid" });
              return;
            }
            if (
              Buffer.byteLength(JSON.stringify(rawPrefs)) > PREFS_MAX_BYTES
            ) {
              json(res, 400, { ok: false, error: "prefs-too-large" });
              return;
            }
            const prefs = narrowPrefs(rawPrefs);
            if (prefs === null) {
              json(res, 400, { ok: false, error: "prefs-invalid" });
              return;
            }
            const store = readLayoutStore();
            writeLayoutStore({
              ...store,
              prefs: { ...(store.prefs ?? {}), ...prefs },
            });
            json(res, 200, {
              ok: true,
              prefs: { ...(store.prefs ?? {}), ...prefs },
            });
          },
          (error) => {
            json(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
        return;
      }
      json(res, 405, { ok: false, error: "method-not-allowed" });
    },
  };

  ctx.effect(() => {
    const disposeConfig = ctx.webServer.register(configRoute);
    const disposeLayout = ctx.webServer.register(layoutRoute);
    const disposePrefs = ctx.webServer.register(prefsRoute);
    return () => {
      disposeConfig();
      disposeLayout();
      disposePrefs();
    };
  }, "dsh-desktop-workbench: config, layout and prefs routes");
}
