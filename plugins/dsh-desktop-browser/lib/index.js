/**
 * dsh-desktop-browser — host half.
 *
 * 内置浏览器（工作台页签）的服务端：功能开关 + 全局偏好持久化。
 * 浏览器行为本体在主进程（browser-controller.mjs，WebContentsView + 桥），
 * 本模块只负责「开关」和「偏好」两类纯配置数据。
 *
 * 路由：
 *   /api/desktop-browser/config   — 功能开关（exact，通用约定，GET/HEAD/POST）
 *   /api/desktop-browser/prefs    — 全局偏好（exact，白名单 schema，GET/HEAD/POST）
 *
 * 持久化：$DSH_HOME/desktop-browser.json（未设置 DSH_HOME 时为 ~/.dsh/…），
 * 原子写入（临时文件 + rename），容错读损坏回退默认。结构与 workbench 同款
 * 多段文档：{ enabled, prefs }，config 与 prefs 互不覆盖。
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Stable cordis plugin name (matches the bundle patch insert id). */
export const name = "dsh-desktop-browser";

/** Services required before the routes can mount. */
export const inject = ["webServer"];

/** Feature switch default (on). */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
});

/** 渲染区比例白名单（与 client 的 VIEWPORT_RATIOS 键集同步）。 */
const VIEWPORT_RATIO_VALUES = new Set(["16:9", "4:3", "1:1", "9:16", "fill"]);

/** 偏好白名单 schema：key → 校验函数（返回清洗后的值，非法返回 undefined）。 */
const PREFS_SCHEMA = {
  "browser.splitProtocol": (v) => (typeof v === "boolean" ? v : undefined),
  "browser.tabsPersist": (v) => (typeof v === "boolean" ? v : undefined),
  "browser.allowLocalhost": (v) => (typeof v === "boolean" ? v : undefined),
  "browser.allowPermissions": (v) => (typeof v === "boolean" ? v : undefined),
  "browser.viewportRatio": (v) =>
    typeof v === "string" && VIEWPORT_RATIO_VALUES.has(v) ? v : undefined,
  "browser.searchEngine": (v) =>
    typeof v === "string" && v.trim().length > 0 && v.trim().length <= 32
      ? v.trim()
      : undefined,
};

/** 偏好文档序列化大小上限。 */
const PREFS_LIMIT_BYTES = 4 * 1024;

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function browserHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** 持久化文档路径。 */
function storePath() {
  return join(browserHomeDir(), "desktop-browser.json");
}

/** 容错读取持久化文档：缺失/损坏 → {}。 */
function readStore() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(storePath(), "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return raw;
}

/** 原子写入持久化文档。 */
function writeStore(section) {
  mkdirSync(browserHomeDir(), { recursive: true });
  const target = storePath();
  const temporaryPath = `${target}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(section, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporaryPath, target);
}

/** 读偏好部分（只保留白名单键）。 */
function readPrefs() {
  const store = readStore();
  const prefs = typeof store.prefs === "object" && store.prefs !== null
    ? store.prefs
    : {};
  const clean = {};
  for (const key of Object.keys(PREFS_SCHEMA)) {
    if (key in prefs) {
      const value = PREFS_SCHEMA[key](prefs[key]);
      if (value !== undefined) clean[key] = value;
    }
  }
  return clean;
}

/** 写 JSON 响应。 */
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** 读有界 JSON 请求体。 */
function readJsonBody(req) {
  return new Promise((resolvePromise, reject) => {
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
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** 生效开关：默认值 ← 插件行 config ← 用户开关文档。 */
  const resolveConfig = () => {
    const store = readStore();
    return {
      ...DEFAULT_CONFIG,
      ...patchLayer,
      ...(typeof store.enabled === "boolean" ? { enabled: store.enabled } : {}),
    };
  };

  const configRoute = {
    kind: "exact",
    path: "/api/desktop-browser/config",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        const body = JSON.stringify(resolveConfig());
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
            const store = readStore();
            store.enabled = body.enabled;
            writeStore(store);
            json(res, 200, { ok: true, config: resolveConfig() });
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
    path: "/api/desktop-browser/prefs",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        const body = JSON.stringify({ prefs: readPrefs() });
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
            const incoming =
              typeof body?.prefs === "object" && body.prefs !== null
                ? body.prefs
                : null;
            if (incoming === null) {
              json(res, 400, { ok: false, error: "prefs-required" });
              return;
            }
            // 白名单收窄：只保留 schema 内且校验通过的键。
            const patch = {};
            for (const key of Object.keys(incoming)) {
              if (!(key in PREFS_SCHEMA)) continue;
              const value = PREFS_SCHEMA[key](incoming[key]);
              if (value !== undefined) patch[key] = value;
            }
            if (Object.keys(patch).length === 0 && Object.keys(incoming).length > 0) {
              json(res, 400, { ok: false, error: "no-valid-prefs" });
              return;
            }
            const store = readStore();
            const merged = { ...readPrefs(), ...patch };
            if (Buffer.byteLength(JSON.stringify(merged)) > PREFS_LIMIT_BYTES) {
              json(res, 413, { ok: false, error: "prefs-too-large" });
              return;
            }
            store.prefs = merged;
            writeStore(store);
            json(res, 200, { ok: true, prefs: merged });
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
    const disposePrefs = ctx.webServer.register(prefsRoute);
    return () => {
      disposeConfig();
      disposePrefs();
    };
  }, "dsh-desktop-browser: config + prefs routes");
}