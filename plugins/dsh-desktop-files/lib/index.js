/**
 * dsh-desktop-files — host half.
 *
 * 文件工作台的服务端：目录树、文本读写、媒体/HTML 预览。
 *
 * 路由：
 *   /api/desktop-files/config          — 功能开关（exact，通用约定）
 *   /api/desktop-files/tree            — GET ?session=&path= 懒加载目录树
 *   /api/desktop-files/text            — GET 读取文本 / POST 原子写入（≤ 2 MiB）
 *   /api/desktop-files/file            — GET 媒体文件（图片/PDF，≤ 10 MiB，
 *                                        音视频 Range 流式）
 *   /api/desktop-files/reveal          — POST 在资源管理器中打开文件所在目录
 *   /api/desktop-files/open-external   — POST 用系统默认应用打开文件
 *
 * 安全模型：
 *   - 每个请求必须携带 session；host 端从 ctx.sessions 取该会话的
 *     header.cwd 作为白名单根目录；
 *   - 目标路径 resolve 后 + realpath（写入时取最近存在祖先）必须位于
 *     cwd realpath 内，符号链接逃逸被拒绝；
 *   - 目录树过滤常见依赖/缓存/构建/版本库目录与隐藏条目；
 *   - 大小上限与内容类型白名单，杜绝越界与任意类型读取。
 */
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve as pathResolve, sep } from "node:path";

/** Stable cordis plugin name (matches the bundle patch insert id). */
export const name = "dsh-desktop-files";

/** Services required before the routes can mount. */
export const inject = ["webServer", "sessions"];

/** Feature switch default (on). */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
});

/** 文本读写上限。 */
const TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
/** 媒体文件（图片/PDF）上限。 */
const MEDIA_LIMIT_BYTES = 10 * 1024 * 1024;
/** 单层目录条目上限。 */
const TREE_ENTRY_LIMIT = 1000;

/** 目录树忽略清单（依赖树/缓存/构建产物/版本库/IDE 元数据/隐藏条目）。 */
const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".turbo",
  ".parcel-cache",
  ".pytest_cache",
  "coverage",
  "target",
  ".pnpm-store",
  ".pnpm",
  ".dsh",
]);

/** 媒体文件扩展名 → MIME。 */
const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  // 视频（Chromium 支持的容器；mkv 不支持）
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  // 音频
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
};

/** 音视频：流式响应（Range 支持拖动进度）。 */
function isStreamableMedia(mime) {
  return mime.startsWith("video/") || mime.startsWith("audio/");
}

/** 文本文件扩展名（text 接口可读）。 */
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".yml", ".yaml",
  ".toml", ".ini", ".cfg", ".conf", ".xml", ".css", ".scss", ".less",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sh",
  ".bash", ".ps1", ".sql", ".vue", ".svelte", ".gitignore", ".env",
  ".html", ".htm",
]);

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function filesHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** 开关文档路径。 */
function configPath() {
  return join(filesHomeDir(), "desktop-files.json");
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
  mkdirSync(filesHomeDir(), { recursive: true });
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

/** 查询参数（request url 解析）。 */
function queryParams(reqUrl) {
  try {
    return new URL(reqUrl, "http://dsh.invalid").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * 取会话 cwd：host 端 sessions store 的 header.cwd 是白名单根目录。
 */
function sessionCwd(ctx, sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  try {
    const session = ctx.sessions?.get(sessionId);
    const cwd = session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
  } catch {
    return null;
  }
}

/** 路径是否位于根目录内（或等于根目录）。 */
function isWithin(rootReal, targetReal) {
  return (
    targetReal === rootReal || targetReal.startsWith(rootReal + sep)
  );
}

/** realpath 最近存在的祖先（写入目标可能尚不存在）。 */
function realpathNearest(absPath) {
  let current = absPath;
  while (!existsSync(current)) {
    const parent = pathResolve(current, "..");
    if (parent === current) return absPath; // 到根仍不存在，原样返回
    current = parent;
  }
  return realpathSync(current);
}

/**
 * 解析并校验目标路径：必须在会话 cwd 内。
 * 返回 { abs, real }；违规抛错（由调用方转 403）。
 */
function resolveWithinCwd(cwd, requestedPath) {
  const rootReal = realpathSync(cwd);
  const abs = pathResolve(cwd, requestedPath ?? cwd);
  const real = realpathNearest(abs);
  if (!isWithin(rootReal, real)) {
    const error = new Error("path-outside-cwd");
    error.status = 403;
    throw error;
  }
  return { abs, real };
}

/** 目录树：懒加载单层（目录在前，文件在后，按名称排序）。 */
function listDirectory(cwd, requestedPath) {
  const { abs } = resolveWithinCwd(cwd, requestedPath);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    const error = new Error("path-not-found");
    error.status = 404;
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error("not-a-directory");
    error.status = 400;
    throw error;
  }
  let names;
  try {
    names = readdirSync(abs);
  } catch {
    const error = new Error("read-failed");
    error.status = 500;
    throw error;
  }
  const entries = [];
  for (const entryName of names) {
    if (entryName.startsWith(".")) continue; // 隐藏条目
    if (IGNORED_NAMES.has(entryName)) continue;
    if (entries.length >= TREE_ENTRY_LIMIT) break;
    const entryPath = join(abs, entryName);
    let entryStat;
    try {
      entryStat = statSync(entryPath);
    } catch {
      continue; // 损坏的符号链接等
    }
    entries.push({
      name: entryName,
      type: entryStat.isDirectory() ? "dir" : "file",
      size: entryStat.isDirectory() ? null : entryStat.size,
      mtime: entryStat.mtimeMs,
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: abs, cwd, entries };
}

/** 文本读取：校验扩展名与大小。 */
function readText(cwd, requestedPath) {
  const { abs } = resolveWithinCwd(cwd, requestedPath);
  const ext = extname(abs).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && basename(abs) !== "package.json") {
    const error = new Error("not-a-text-file");
    error.status = 415;
    throw error;
  }
  let content;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    const error = new Error("read-failed");
    error.status = 404;
    throw error;
  }
  if (Buffer.byteLength(content, "utf8") > TEXT_LIMIT_BYTES) {
    const error = new Error("text-too-large");
    error.status = 413;
    throw error;
  }
  return { path: abs, content };
}

/** 文本写入：原子写，仅限文本扩展名与大小上限。 */
function writeText(cwd, requestedPath, content) {
  const { abs } = resolveWithinCwd(cwd, requestedPath);
  const ext = extname(abs).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && basename(abs) !== "package.json") {
    const error = new Error("not-a-text-file");
    error.status = 415;
    throw error;
  }
  if (typeof content !== "string") {
    const error = new Error("content-must-be-string");
    error.status = 400;
    throw error;
  }
  if (Buffer.byteLength(content, "utf8") > TEXT_LIMIT_BYTES) {
    const error = new Error("text-too-large");
    error.status = 413;
    throw error;
  }
  mkdirSync(pathResolve(abs, ".."), { recursive: true });
  const temporaryPath = `${abs}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, abs);
  return { path: abs, bytes: Buffer.byteLength(content, "utf8") };
}

/**
 * 媒体文件信息：类型白名单 + stat。
 * 音视频返回 streamable（走 Range 流式，无大小上限）；
 * 图片/PDF 返回 Buffer（≤ MEDIA_LIMIT_BYTES）。
 */
function readMedia(cwd, requestedPath) {
  const { abs } = resolveWithinCwd(cwd, requestedPath);
  const ext = extname(abs).toLowerCase();
  const mime = MEDIA_TYPES[ext];
  if (mime === undefined) {
    const error = new Error("unsupported-media-type");
    error.status = 415;
    throw error;
  }
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    const error = new Error("read-failed");
    error.status = 404;
    throw error;
  }
  if (!stat.isFile()) {
    const error = new Error("not-a-file");
    error.status = 400;
    throw error;
  }
  const streamable = isStreamableMedia(mime);
  if (!streamable && stat.size > MEDIA_LIMIT_BYTES) {
    const error = new Error("media-too-large");
    error.status = 413;
    throw error;
  }
  if (streamable) return { abs, mime, size: stat.size, streamable: true };
  const data = readFileSync(abs);
  return { data, mime, streamable: false };
}

/** 解析 Range 头（bytes=start-end / suffix），非法或不可满足 → null。 */
function parseRange(header, size) {
  if (typeof header !== "string") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  let start;
  let end;
  if (match[1] === "" && match[2] !== "") {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = match[1] === "" ? 0 : Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  }
  if (start >= size || start > end) return null;
  return { start, end, length: end - start + 1 };
}

/** 最近一次 reveal 时间戳（节流：避免连点反复 spawn 系统进程）。 */
let lastRevealAt = 0;

/**
 * 用系统默认方式打开目标路径（文件 → 关联应用；目录 → 文件管理器）。
 * Windows 用 cmd /c start（ShellExecute 路径，等效双击）——实测结论：
 * 从本宿主进程 spawn powershell.exe 执行 Invoke-Item（官方 openPath
 * 的底层命令）不弹窗，而 cmd start 可正常弹窗。macOS open（reveal 用
 * -R 在 Finder 中定位）；Linux xdg-open。GUI 进程分离运行，不阻塞。
 * 返回 Promise<boolean>：spawn 失败 → false。
 */
function systemOpen(abs, reveal = false) {
  const now = Date.now();
  if (now - lastRevealAt < 500) return Promise.resolve(true); // 节流
  lastRevealAt = now;
  return new Promise((resolvePromise) => {
    let child;
    if (process.platform === "win32") {
      const cmd = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "cmd.exe",
      );
      child = spawn(cmd, ["/c", "start", "", reveal ? dirname(abs) : abs], {
        detached: true,
        stdio: "ignore",
      });
    } else if (process.platform === "darwin") {
      child = spawn("open", reveal ? ["-R", abs] : [abs], {
        detached: true,
        stdio: "ignore",
      });
    } else {
      child = spawn("xdg-open", [reveal ? dirname(abs) : abs], {
        detached: true,
        stdio: "ignore",
      });
    }
    const timer = setTimeout(() => {
      // 500ms 内未报错也未退出：视为已成功唤起（GUI 进程可能常驻）。
      resolvePromise(true);
    }, 500);
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error("[dsh-desktop-files] spawn failed:", error.message);
      resolvePromise(false);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
    child.unref();
  });
}

/**
 * 注册路由：2 个 exact（config/reveal）+ 3 个 prefix（tree/text/file）。
 * reveal 接口：路径经 cwd 白名单校验后，用官方同款命令在资源管理器中
 * 打开文件所在目录（官方 workspaces.openPath 只接受已注册工作区路径，
 * 本接口覆盖任意 cwd 内文件场景）。
 */
export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** 生效配置：默认值 ← 插件行 config ← 用户开关文档。 */
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readOverrides() });

  /** 从请求解析 session + path，并解析出 cwd 与安全路径。 */
  function resolveRequest(reqUrl, requiredPath = true) {
    const params = queryParams(reqUrl);
    const sessionId = params.get("session") ?? null;
    const requested = params.get("path") ?? null;
    if (requiredPath && requested === null) {
      const error = new Error("path-required");
      error.status = 400;
      throw error;
    }
    const cwd = sessionCwd(ctx, sessionId);
    if (cwd === null) {
      const error = new Error("session-or-cwd-unavailable");
      error.status = 400;
      throw error;
    }
    return { sessionId, requested, cwd };
  }

  /** 统一错误响应。 */
  function respondError(res, error) {
    const status =
      typeof error?.status === "number" ? error.status : error?.code === "ENOENT" ? 404 : 500;
    json(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const configRoute = {
    kind: "exact",
    path: "/api/desktop-files/config",
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

  const treeRoute = {
    kind: "prefix",
    path: "/api/desktop-files/tree",
    handler: (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { ok: false, error: "method-not-allowed" });
        return;
      }
      try {
        const { requested, cwd } = resolveRequest(req.url, false);
        const body = JSON.stringify(listDirectory(cwd, requested));
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
      } catch (error) {
        respondError(res, error);
      }
    },
  };

  const textRoute = {
    kind: "prefix",
    path: "/api/desktop-files/text",
    handler: (req, res) => {
      if (req.method === "GET" || req.method === "HEAD") {
        try {
          const { requested, cwd } = resolveRequest(req.url);
          const body = JSON.stringify(readText(cwd, requested));
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
        } catch (error) {
          respondError(res, error);
        }
        return;
      }
      if (req.method === "POST") {
        readJsonBody(req).then(
          (body) => {
            try {
              const sessionId =
                typeof body?.session === "string" ? body.session : null;
              const requested =
                typeof body?.path === "string" ? body.path : null;
              if (sessionId === null || requested === null) {
                json(res, 400, { ok: false, error: "session-or-path-required" });
                return;
              }
              const cwd = sessionCwd(ctx, sessionId);
              if (cwd === null) {
                json(res, 400, { ok: false, error: "session-or-cwd-unavailable" });
                return;
              }
              json(res, 200, { ok: true, ...writeText(cwd, requested, body?.content) });
            } catch (error) {
              respondError(res, error);
            }
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

  const fileRoute = {
    kind: "prefix",
    path: "/api/desktop-files/file",
    handler: (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { ok: false, error: "method-not-allowed" });
        return;
      }
      try {
        const { requested, cwd } = resolveRequest(req.url);
        const media = readMedia(cwd, requested);
        if (media.streamable) {
          // 音视频：Range 流式（支持进度条拖动），不做大小上限。
          const range = parseRange(req.headers.range, media.size);
          if (range !== null) {
            res.writeHead(206, {
              "content-type": media.mime,
              "content-range": `bytes ${range.start}-${range.end}/${media.size}`,
              "content-length": String(range.length),
              "accept-ranges": "bytes",
              "cache-control": "no-cache",
              "x-content-type-options": "nosniff",
            });
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(media.abs, {
              start: range.start,
              end: range.end,
            }).pipe(res);
            return;
          }
          res.writeHead(200, {
            "content-type": media.mime,
            "content-length": String(media.size),
            "accept-ranges": "bytes",
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
          });
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          createReadStream(media.abs).pipe(res);
          return;
        }
        // 图片 / PDF：整读 + 大小上限。
        res.writeHead(200, {
          "content-type": media.mime,
          "content-length": String(media.data.length),
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(media.data);
      } catch (error) {
        respondError(res, error);
      }
    },
  };

  const revealRoute = {
    kind: "exact",
    path: "/api/desktop-files/reveal",
    handler: (req, res) => {
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "method-not-allowed" });
        return;
      }
      readJsonBody(req).then(
        async (body) => {
          try {
            const sessionId =
              typeof body?.session === "string" ? body.session : null;
            const requested = typeof body?.path === "string" ? body.path : null;
            if (sessionId === null || requested === null) {
              json(res, 400, { ok: false, error: "session-or-path-required" });
              return;
            }
            const cwd = sessionCwd(ctx, sessionId);
            if (cwd === null) {
              json(res, 400, { ok: false, error: "session-or-cwd-unavailable" });
              return;
            }
            // reveal 只是「在资源管理器中打开文件所在目录」，无读写副作用，
            // 因此不做 cwd 白名单限制（非本工作区的文件也能打开其目录）；
            // 但要求路径存在，防止无意义调用。
            const abs = pathResolve(cwd, requested);
            const exists = existsSync(abs);
            if (!exists) {
              console.error(
                "[dsh-desktop-files] reveal not found:",
                JSON.stringify({ requested, abs, cwd }),
              );
              json(res, 404, { ok: false, error: "path-not-found" });
              return;
            }
            const revealed = await systemOpen(abs, true);
            if (!revealed) {
              json(res, 500, { ok: false, error: "reveal-spawn-failed" });
              return;
            }
            json(res, 200, { ok: true, path: abs });
          } catch (error) {
            respondError(res, error);
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

  const openExternalRoute = {
    kind: "exact",
    path: "/api/desktop-files/open-external",
    handler: (req, res) => {
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "method-not-allowed" });
        return;
      }
      readJsonBody(req).then(
        async (body) => {
          try {
            const sessionId =
              typeof body?.session === "string" ? body.session : null;
            const requested = typeof body?.path === "string" ? body.path : null;
            if (sessionId === null || requested === null) {
              json(res, 400, { ok: false, error: "session-or-path-required" });
              return;
            }
            const cwd = sessionCwd(ctx, sessionId);
            if (cwd === null) {
              json(res, 400, { ok: false, error: "session-or-cwd-unavailable" });
              return;
            }
            // 用系统默认应用打开文件（用户显式点击按钮触发，与 reveal
            // 同级信任）：不设 cwd 白名单，但要求路径存在。
            const abs = pathResolve(cwd, requested);
            const exists = existsSync(abs);
            if (!exists) {
              console.error(
                "[dsh-desktop-files] open-external not found:",
                JSON.stringify({ requested, abs, cwd }),
              );
              json(res, 404, { ok: false, error: "path-not-found" });
              return;
            }
            const opened = await systemOpen(abs, false);
            if (!opened) {
              json(res, 500, { ok: false, error: "open-spawn-failed" });
              return;
            }
            json(res, 200, { ok: true, path: abs });
          } catch (error) {
            respondError(res, error);
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
    const disposeConfig = ctx.webServer.register(configRoute);
    const disposeTree = ctx.webServer.register(treeRoute);
    const disposeText = ctx.webServer.register(textRoute);
    const disposeFile = ctx.webServer.register(fileRoute);
    const disposeReveal = ctx.webServer.register(revealRoute);
    const disposeOpenExternal = ctx.webServer.register(openExternalRoute);
    return () => {
      disposeConfig();
      disposeTree();
      disposeText();
      disposeFile();
      disposeReveal();
      disposeOpenExternal();
    };
  }, "dsh-desktop-files: config, tree, text, file, reveal and open-external routes");
}

