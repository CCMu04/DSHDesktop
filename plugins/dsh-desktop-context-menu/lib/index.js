/**
 * dsh-desktop-context-menu — host half.
 *
 * 「右键菜单」功能增强的服务端：开关持久化（~/.dsh/desktop-context-menu.json），
 * 浏览器端通过 /api/desktop-context-menu/config 读写。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = "dsh-desktop-context-menu";

/** 路由挂载所需的宿主服务。 */
export const inject = ["webServer"];

/** 功能开关默认值（全部开启）。 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 插件设置中使用按「预设 / 我的」分组的插件列表页。 */
  enabled: true,
});

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function homeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** 开关文档路径。 */
function configPath() {
  return join(homeDir(), "desktop-context-menu.json");
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
  mkdirSync(homeDir(), { recursive: true });
  const target = configPath();
  const temporaryPath = `${target}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(section, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporaryPath, target);
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
 * 注册开关 API 路由：/api/desktop-context-menu/config（GET/HEAD/POST）。
 */
export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** 生效配置：默认值 ← 插件行 config ← 用户开关文档。 */
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readOverrides() });

  const route = {
    kind: "exact",
    path: "/api/desktop-context-menu/config",
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
  };

  ctx.effect(() => {
    const dispose = ctx.webServer.register(route);
    return () => dispose();
  }, "dsh-desktop-context-menu: config route");
}

