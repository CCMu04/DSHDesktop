/**
 * dsh-desktop-updates — host half.
 *
 * 「检查更新」功能增强的服务端：
 *   - 开关持久化：~/.dsh/desktop-updates.json（{ enabled }），POST 写入
 *   - GET /api/desktop-updates/config  → { enabled }
 *   - POST /api/desktop-updates/config → 写开关
 *   - GET /api/desktop-updates/version → { currentVersion }（构建时注入）
 *
 * 最新版本检查由浏览器端直接请求 GitHub Releases API（走系统代理），
 * host 只负责当前版本与开关。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = "dsh-desktop-updates";

/** 路由挂载所需的宿主服务。 */
export const inject = ["webServer"];

/** 功能开关默认值（全部开启）。 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 设置侧边栏显示「检查更新」入口。 */
  enabled: true,
});

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function updatesHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** 开关文档路径。 */
function configPath() {
  return join(updatesHomeDir(), "desktop-updates.json");
}

/** 容错读取开关文档：缺失/损坏 → {}。 */
function readOverrides() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  return typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {};
}

/** 原子写入开关文档。 */
function writeOverrides(section) {
  mkdirSync(updatesHomeDir(), { recursive: true });
  const target = configPath();
  const temporaryPath = `${target}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(section, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporaryPath, target);
}

/** 当前桌面壳版本（构建时由 scripts/write-plugin-version.mjs 生成）。 */
const VERSION_PATH = fileURLToPath(new URL("../version.json", import.meta.url));

/** 读取构建注入的版本信息（应用版本 + 官方 DSH 组件版本）。 */
function readVersionInfo() {
  try {
    const raw = JSON.parse(readFileSync(VERSION_PATH, "utf8"));
    return {
      currentVersion:
        typeof raw?.version === "string" ? raw.version : null,
      dshVersion:
        typeof raw?.dshVersion === "string" ? raw.dshVersion : null,
    };
  } catch {
    return { currentVersion: null, dshVersion: null };
  }
}

/** Windows 版本展示（由内核版本映射）。 */
function windowsDisplayName() {
  if (process.platform !== "win32") return process.platform;
  const build = Number.parseInt(os.release().split(".").pop() ?? "0", 10);
  if (Number.isNaN(build)) return "Windows";
  if (build >= 22000) return "Windows 11";
  if (build >= 10240) return "Windows 10";
  return "Windows";
}

/**
 * 安装方式：优先读桌面壳注入的环境变量；缺失时自行推断：
 *   PORTABLE_EXECUTABLE_DIR（Electron 便携版自动设置）→ portable；
 *   HARNESS_DESKTOP_NODE 指向 resources/runtime（打包安装）→ installer；
 *   其余（开发模式 electron）→ dev。
 */
function installKind() {
  const injected = process.env.DSH_DESKTOP_INSTALL_KIND;
  if (injected === "portable" || injected === "installer" || injected === "dev")
    return injected;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return "portable";
  const nodePath = process.env.HARNESS_DESKTOP_NODE ?? "";
  if (nodePath.includes("resources") && nodePath.includes("runtime"))
    return "installer";
  return "dev";
}

/** 写一个 JSON 响应。 */
function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** 读取有界 JSON 请求体。 */
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
 * 注册插件 API 路由（两条 exact 路由，path 不同）：
 *   /api/desktop-updates/config  —— 开关读写（GET/HEAD/POST）
 *   /api/desktop-updates/version —— 当前桌面壳版本
 */
export function apply(ctx, config = {}) {
  const patchLayer = typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** 生效配置：默认值 ← 插件行 config ← 用户开关文档。 */
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readOverrides() });

  const routes = [
    {
      kind: "exact",
      path: "/api/desktop-updates/config",
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
              writeOverrides({ enabled: body.enabled });
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
    },
    {
      kind: "exact",
      path: "/api/desktop-updates/version",
      handler: (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          json(res, 405, { ok: false, error: "method-not-allowed" });
          return;
        }
        const body = JSON.stringify({
          ...readVersionInfo(),
          platform: process.platform,
          arch: process.arch,
          os: windowsDisplayName(),
          installKind: installKind(),
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
      },
    },
  ];

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "dsh-desktop-updates: api routes");
}
