/**
 * dsh-desktop-ui — host half.
 *
 * 浏览器端功能开关的服务端：
 *   - 配置三层合并：内置默认值 < 插件行 config（profile patch 层）< desktop-ui.json
 *   - GET  /api/desktop-ui/config → 返回当前生效配置（浏览器端启动时拉取）
 *   - POST /api/desktop-ui/config → 写入 desktop-ui.json（设置页卡片保存时调用）
 *   - 配置持久化在 $DSH_HOME/desktop-ui.json，原子写入，损坏时自动回退默认
 *
 * 同一个 webServer 路由处理 GET/HEAD/POST：webserver 不允许同 path 重复注册，
 * 因此方法分发写在单个 handler 内。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Stable cordis plugin name (matches the bundle patch insert id). */
export const name = "dsh-desktop-ui";

/** Services required before the config routes can mount. */
export const inject = ["webServer"];

/** Every feature switch and its default state (all on). 顺序即卡片行序。 */
export const DEFAULT_CONFIG = Object.freeze({
  /** Settings modal restyled as a left-side drawer. */
  settingsDrawer: true,
  /** Session-log export button moved into the header action row. */
  sessionLogExport: true,
  /** Composer dock stats line widened and centered. */
  statsLine: true,
});

/** Feature keys in stable order (also the settings-card row order). */
export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));

/** Resolve the persistence directory ($DSH_HOME or ~/.dsh). */
function desktopUiHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** Absolute path of the user-editable overrides document. */
function configPath() {
  return join(desktopUiHomeDir(), "desktop-ui.json");
}

/** Tolerant read of the overrides document: corrupt or absent file → {}. */
function readOverrides() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

/** Atomic write of the overrides document (mkdir -p + tmp rename). */
function writeOverrides(section) {
  mkdirSync(desktopUiHomeDir(), { recursive: true });
  const target = configPath();
  const temporaryPath = `${target}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(section, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, target);
}

/** Narrow an unknown patch to the boolean fields we own. */
function narrowPatch(value) {
  if (typeof value !== "object" || value === null) return {};
  const out = {};
  for (const key of CONFIG_KEYS) {
    if (typeof value[key] === "boolean") out[key] = value[key];
  }
  return out;
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

/**
 * 注册插件 API 路由：/api/desktop-ui/config —— 功能开关读写
 * （GET/HEAD/POST 单 handler 分发；webserver 不允许同 path 重复注册）。
 * 当前版本等由「功能增强」插件（dsh-desktop-updates）提供。
 */
export function apply(ctx, config = {}) {
  const patchLayer = narrowPatch(config);
  /** Effective configuration: defaults ← patch layer ← user overrides. */
  const resolve = () => ({
    ...DEFAULT_CONFIG,
    ...patchLayer,
    ...readOverrides(),
  });

  const route = {
    kind: "exact",
    path: "/api/desktop-ui/config",
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
            const patch = narrowPatch(body);
            if (Object.keys(patch).length === 0) {
              json(res, 400, { ok: false, error: "no-boolean-fields" });
              return;
            }
            // Merge over the previous overrides: a partial POST updates only
            // the fields it carries.
            writeOverrides({ ...readOverrides(), ...patch });
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

  ctx.effect(() => {
    const dispose = ctx.webServer.register(route);
    return () => dispose();
  }, "dsh-desktop-ui: config route");
}
