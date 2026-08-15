/**
 * dsh-desktop-context-menu — host half.
 *
 * 「右键菜单」功能增强的服务端：开关持久化（~/.dsh/desktop-context-menu.json），
 * 浏览器端通过 /api/desktop-context-menu/config 读写。
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as pathResolve } from "node:path";

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = "dsh-desktop-context-menu";

/** 路由挂载所需的宿主服务。 */
export const inject = ["webServer"];

/** 最近一次打开工作区时间戳（节流：避免连点反复 spawn 系统进程）。 */
let lastOpenAt = 0;

/**
 * 在系统文件管理器中打开目录。Windows 用 cmd /c start（ShellExecute 路径，
 * 等效双击）——官方 workspaces.openPath 的底层命令（powershell
 * Invoke-Item）在本宿主进程 spawn 时不弹窗，故自建可靠通道。
 */
function openInSystem(abs) {
  const now = Date.now();
  if (now - lastOpenAt < 500) return Promise.resolve(true); // 节流
  lastOpenAt = now;
  return new Promise((resolvePromise) => {
    let child;
    if (process.platform === "win32") {
      const cmd = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "cmd.exe",
      );
      child = spawn(cmd, ["/c", "start", "", abs], {
        detached: true,
        stdio: "ignore",
      });
    } else if (process.platform === "darwin") {
      child = spawn("open", [abs], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [abs], { detached: true, stdio: "ignore" });
    }
    const timer = setTimeout(() => {
      resolvePromise(true);
    }, 500);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error("[dsh-desktop-context-menu] open spawn failed:", error.message);
      resolvePromise(false);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
    child.unref();
  });
}

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

  const openWorkspaceRoute = {
    kind: "exact",
    path: "/api/desktop-context-menu/open-workspace",
    handler: (req, res) => {
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "method-not-allowed" });
        return;
      }
      readJsonBody(req).then(
        async (body) => {
          try {
            const requested =
              typeof body?.path === "string" && body.path.length > 0
                ? body.path
                : null;
            if (requested === null) {
              json(res, 400, { ok: false, error: "path-required" });
              return;
            }
            // 注意：这里必须用 node:path 的 pathResolve（插件的配置解析
            // 函数也叫 resolve，会遮蔽导入，曾导致 abs 变成配置对象）。
            const abs = pathResolve(requested);
            let stat;
            try {
              stat = statSync(abs);
            } catch (error) {
              console.error(
                "[dsh-desktop-context-menu] stat failed:",
                JSON.stringify({
                  requested,
                  abs,
                  code: error?.code ?? String(error),
                  message: error?.message ?? String(error),
                }),
              );
              json(res, 404, { ok: false, error: "path-not-found" });
              return;
            }
            if (!stat.isDirectory()) {
              json(res, 400, { ok: false, error: "not-a-directory" });
              return;
            }
            const opened = await openInSystem(abs);
            if (!opened) {
              json(res, 500, { ok: false, error: "open-spawn-failed" });
              return;
            }
            json(res, 200, { ok: true, path: abs });
          } catch (error) {
            json(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
        (error) => {
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    },
  };

  ctx.effect(() => {
    const dispose = ctx.webServer.register(route);
    const disposeOpen = ctx.webServer.register(openWorkspaceRoute);
    return () => {
      dispose();
      disposeOpen();
    };
  }, "dsh-desktop-context-menu: config and open-workspace routes");
}

