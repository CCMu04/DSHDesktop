/**
 * dsh-desktop-git — host half.
 *
 * 工作台 Git 面板的服务端：纯 git CLI 代理。绝不设置身份（user.name /
 * user.email 交给用户环境），无 push / pull / fetch，只暴露本地操作：
 * 状态、diff、历史、暂存、提交、还原。
 *
 * 路由：
 *   /api/desktop-git/config    — 功能开关（exact，通用约定）
 *   /api/desktop-git/status    — GET ?session=&path= 仓库状态（分支 + 改动文件）
 *   /api/desktop-git/diff      — GET ?session=&path=&staged=0|1 统一 diff
 *   /api/desktop-git/log       — GET ?session=&path=&limit= 提交历史
 *   /api/desktop-git/stage     — POST {session, path?} git add
 *   /api/desktop-git/unstage   — POST {session, path?} git restore --staged
 *   /api/desktop-git/commit    — POST {session, message} git commit -m
 *   /api/desktop-git/restore   — POST {session, path} git restore（丢弃工作区改动）
 *
 * 安全模型：
 *   - 每个请求携带 session，以会话 header.cwd realpath 为白名单根；
 *   - 目标路径 resolve + realpath 必须位于 cwd 内（符号链接逃逸 → 403）；
 *   - git 一律 spawn("git", args) 参数数组、无 shell，路径经 "--" 分隔；
 *   - 非零退出返回 stderr 文本（如「身份未配置」提示），不掩盖错误。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve as pathResolve, sep } from "node:path";

/** 开关默认值（插件行 config 与用户开关文档可覆盖 enabled）。 */
export const DEFAULT_CONFIG = Object.freeze({ enabled: true });

export const name = "dsh-desktop-git";

export const inject = ["webServer", "sessions"];

/** git 命令超时（防挂起）。 */
const GIT_TIMEOUT_MS = 15000;
/** diff 文本返回上限（超出截断并标记；过大 diff 全量渲染会卡顿）。 */
const DIFF_LIMIT_BYTES = 256 * 1024;
/** log 默认 / 上限条数。 */
const LOG_DEFAULT = 20;
const LOG_MAX = 100;

/** 子仓库扫描：最大深度与跳过目录（大目录/依赖树不深入）。 */
const REPO_SCAN_MAX_DEPTH = 3;
const REPO_SCAN_SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".git",
]);

/**
 * 扫描目录树（深度 ≤ 3）中的 git 仓库根（含 cwd 自身）；进入某个仓库
 * 后不再深入（嵌套仓库/子模块忽略）。返回绝对路径列表（cwd 在前）。
 */
function findGitRepos(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (existsSync(join(dir, ".git"))) {
      found.push(dir);
      return;
    }
    if (depth >= REPO_SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (REPO_SCAN_SKIP.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** 持久化目录（$DSH_HOME 或 ~/.dsh）。 */
function gitHomeDir() {
  return process.env.DSH_HOME?.trim()
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

/** 开关文档路径。 */
function configPath() {
  return join(gitHomeDir(), "desktop-git.json");
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
  mkdirSync(gitHomeDir(), { recursive: true });
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

/** 取会话 cwd：host 端 sessions store 的 header.cwd 是白名单根目录。 */
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

/** realpath 最近存在的祖先（目标可能尚不存在）。 */
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

/** git 相对路径（git 接受正斜杠；空串表示仓库根）。 */
function gitRelPath(cwd, abs) {
  if (abs === cwd) return "";
  return relative(cwd, abs).split(sep).join("/");
}

/**
 * 运行 git：spawn 参数数组（无 shell），收集 stdout/stderr，超时终止。
 * git 存在性检查由调用方处理（ENOENT → git-unavailable）。
 */
function runGit(cwd, args) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("git", ["-c", "core.quotepath=false", ...args], {
        cwd,
        windowsHide: true,
      });
    } catch (error) {
      resolvePromise({ code: -1, stdout: "", stderr: String(error) });
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => {
      child.kill();
    }, GIT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      // ENOENT：系统未安装 git。
      const unavailable = error.code === "ENOENT";
      resolvePromise({
        code: unavailable ? -2 : -1,
        stdout: "",
        stderr: unavailable ? "git not found" : String(error),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code: typeof code === "number" ? code : -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

/** 是否位于 git 仓库内（rev-parse 成功）。 */
async function isGitRepo(cwd) {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

/** 当前分支名（detached HEAD → 空串）。 */
async function currentBranch(cwd) {
  const result = await runGit(cwd, ["branch", "--show-current"]);
  return result.code === 0 ? result.stdout.trim() : "";
}

/**
 * 解析 `git status --porcelain=v1 -z` 输出：
 * 每个 NUL 字段是 `XY PATH`（XY 两个状态字符 + 一个分隔空格 + 路径）；
 * rename/copy 条目后跟第二个字段（新路径）。-z 模式路径不转义。
 * 返回 [{ path, origPath?, x, y, staged, worktree, untracked }]。
 */
function parseStatus(fields) {
  const files = [];
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    if (field.length < 4) {
      i += 1;
      continue;
    }
    const x = field[0];
    const y = field[1];
    const path = field.slice(3);
    if (x === "R" || x === "C") {
      // -z 模式下 rename/copy 的新路径是下一个字段。
      files.push({
        path: fields[i + 1] ?? path,
        origPath: path,
        x,
        y,
        staged: x !== " " && x !== "?",
        worktree: y !== " " && y !== "?",
        untracked: x === "?",
      });
      i += 2;
    } else {
      files.push({
        path,
        origPath: null,
        x,
        y,
        staged: x !== " " && x !== "?",
        worktree: y !== " " && y !== "?",
        untracked: x === "?",
      });
      i += 1;
    }
  }
  return files;
}

/** 仓库状态：分支 + 改动文件列表。非仓库 → { repo: false }。 */
async function readStatus(cwd) {
  if (!(await isGitRepo(cwd))) return { repo: false };
  const [branch, status] = await Promise.all([
    currentBranch(cwd),
    runGit(cwd, ["status", "--porcelain=v1", "-z"]),
  ]);
  if (status.code !== 0) {
    const error = new Error(status.stderr.trim() || "git-status-failed");
    error.status = 400;
    throw error;
  }
  const fields = status.stdout.split("\0").filter((s) => s.length > 0);
  return { repo: true, branch, files: parseStatus(fields) };
}

/** 单文件 diff 文本；二进制 → { binary: true }。staged → 暂存区 diff。 */
async function readDiff(cwd, relPath, staged) {
  if (!(await isGitRepo(cwd))) {
    const error = new Error("not-a-git-repository: " + cwd);
    error.status = 400;
    throw error;
  }
  const args = ["diff"];
  if (staged) args.push("--cached");
  if (relPath !== "") args.push("--", relPath);
  const result = await runGit(cwd, args);
  if (result.code !== 0) {
    const error = new Error(result.stderr.trim() || "git-diff-failed");
    error.status = 400;
    throw error;
  }
  const content = result.stdout;
  const binary =
    content.includes("Binary files ") || content.includes("GIT binary patch");
  if (binary) return { binary: true };
  const truncated = Buffer.byteLength(content, "utf8") > DIFF_LIMIT_BYTES;
  return {
    binary: false,
    content: truncated
      ? content.slice(0, DIFF_LIMIT_BYTES)
      : content,
    truncated,
  };
}

/** 提交历史（新 → 旧）。 */
async function readLog(cwd, limit) {
  const args = [
    "log",
    "-n",
    String(Math.min(Math.max(1, limit), LOG_MAX)),
    "--date=iso-strict",
    "--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e",
  ];
  const result = await runGit(cwd, args);
  if (result.code !== 0) {
    // 空仓库（无提交）也视为正常。
    if (result.stderr.includes("does not have any commits")) return [];
    const error = new Error(result.stderr.trim() || "git-log-failed");
    error.status = 400;
    throw error;
  }
  return result.stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, short, author, date, subject] = record.split("\x1f");
      return { hash, short, author, date, subject };
    });
}

/** git 写操作统一封装：非零退出 → 400 + stderr。 */
function requireGitOk(result, label) {
  if (result.code === 0) return;
  const error = new Error(result.stderr.trim() || `git-${label}-failed`);
  error.status = 400;
  throw error;
}

/**
 * 注册路由：1 个 exact（config）+ 6 个 prefix（status/diff/log）+ 4 个
 * POST（stage/unstage/commit/restore）。路径经会话 cwd 白名单校验。
 */
export function apply(ctx, config = {}) {
  const patchLayer =
    typeof config.enabled === "boolean" ? { enabled: config.enabled } : {};
  /** 生效配置：默认值 ← 插件行 config ← 用户开关文档。 */
  const resolve = () => ({ ...DEFAULT_CONFIG, ...patchLayer, ...readOverrides() });

  /** 从请求解析 session + path，并解析出 cwd 与安全路径。 */
  function resolveRequest(reqUrl, requiredPath = false) {
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
    path: "/api/desktop-git/config",
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

  /** GET 类路由（status / diff / log）共用处理器（handler 可为 async）。 */
  function makeGetRoute(path, handler) {
    return {
      kind: "prefix",
      path,
      handler: (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          json(res, 405, { ok: false, error: "method-not-allowed" });
          return;
        }
        Promise.resolve()
          .then(() => handler(req))
          .then(
            (value) => {
              const body = JSON.stringify(value);
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
            (error) => respondError(res, error),
          );
      },
    };
  }

  /**
   * 解析仓库目录：repo 参数（相对 cwd 或绝对路径，须在 cwd 内）；
   * 缺省 = 会话 cwd。git 命令一律在仓库目录执行。
   */
  function resolveRepoDir(cwd, repoParam) {
    if (typeof repoParam !== "string" || repoParam === "") return cwd;
    const { abs } = resolveWithinCwd(cwd, repoParam);
    return abs;
  }

  /** cwd 内所有 git 仓库（含 cwd 自身）；path 为相对 cwd 的路径。 */
  const reposRoute = makeGetRoute("/api/desktop-git/repos", (req) => {
    const { cwd } = resolveRequest(req.url, false);
    const found = findGitRepos(cwd);
    return {
      repos: found.map((abs) => gitRelPath(cwd, abs)),
    };
  });

  const statusRoute = makeGetRoute("/api/desktop-git/status", (req) => {
    const params = queryParams(req.url);
    const { requested, cwd } = resolveRequest(req.url, false);
    // repo 参数优先；缺省回退到 path（向后兼容：查看某目录的 status）。
    const repoDir = resolveRepoDir(cwd, params.get("repo") ?? requested);
    const { abs } = resolveWithinCwd(repoDir, requested ?? repoDir);
    return readStatus(abs);
  });

  const diffRoute = makeGetRoute("/api/desktop-git/diff", (req) => {
    const params = queryParams(req.url);
    const { requested, cwd } = resolveRequest(req.url, true);
    const staged = params.get("staged") === "1";
    const repoDir = resolveRepoDir(cwd, params.get("repo"));
    const { abs } = resolveWithinCwd(repoDir, requested);
    const rel = gitRelPath(repoDir, abs);
    return readDiff(repoDir, rel, staged);
  });

  const logRoute = makeGetRoute("/api/desktop-git/log", (req) => {
    const params = queryParams(req.url);
    const { requested, cwd } = resolveRequest(req.url, false);
    const limit = Number.parseInt(params.get("limit") ?? "", 10);
    const repoDir = resolveRepoDir(cwd, params.get("repo") ?? requested);
    const { abs } = resolveWithinCwd(repoDir, requested ?? repoDir);
    return readLog(abs, Number.isFinite(limit) ? limit : LOG_DEFAULT);
  });

  /** POST 写操作路由：body 里取 session/path/message/repo，执行 git 操作。 */
  function makePostRoute(path, perform) {
    return {
      kind: "exact",
      path,
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
              if (sessionId === null) {
                json(res, 400, { ok: false, error: "session-required" });
                return;
              }
              const cwd = sessionCwd(ctx, sessionId);
              if (cwd === null) {
                json(res, 400, { ok: false, error: "session-or-cwd-unavailable" });
                return;
              }
              const result = await perform(cwd, body);
              json(res, 200, { ok: true, ...result });
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
  }

  /** 写操作前置检查：仓库目录必须位于 git 仓库内（友好错误替代 fatal）。 */
  async function requireGitRepo(repoDir) {
    if (!(await isGitRepo(repoDir))) {
      const error = new Error("not-a-git-repository: " + repoDir);
      error.status = 400;
      throw error;
    }
  }

  const stageRoute = makePostRoute("/api/desktop-git/stage", async (cwd, body) => {
    const repoDir = resolveRepoDir(cwd, body?.repo);
    await requireGitRepo(repoDir);
    if (typeof body?.path === "string" && body.path !== "") {
      const { abs } = resolveWithinCwd(repoDir, body.path);
      requireGitOk(await runGit(repoDir, ["add", "--", gitRelPath(repoDir, abs)]), "add");
    } else {
      requireGitOk(await runGit(repoDir, ["add", "-A"]), "add");
    }
    return {};
  });

  const unstageRoute = makePostRoute("/api/desktop-git/unstage", async (cwd, body) => {
    const repoDir = resolveRepoDir(cwd, body?.repo);
    await requireGitRepo(repoDir);
    if (typeof body?.path === "string" && body.path !== "") {
      const { abs } = resolveWithinCwd(repoDir, body.path);
      requireGitOk(
        await runGit(repoDir, ["restore", "--staged", "--", gitRelPath(repoDir, abs)]),
        "unstage",
      );
    } else {
      // 无路径：取消全部暂存（仅动 index，安全）。
      requireGitOk(await runGit(repoDir, ["reset"]), "unstage");
    }
    return {};
  });

  const commitRoute = makePostRoute("/api/desktop-git/commit", async (cwd, body) => {
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (message.length === 0) {
      const error = new Error("commit-message-required");
      error.status = 400;
      throw error;
    }
    if (message.length > 10000) {
      const error = new Error("commit-message-too-long");
      error.status = 413;
      throw error;
    }
    const repoDir = resolveRepoDir(cwd, body?.repo);
    await requireGitRepo(repoDir);
    requireGitOk(await runGit(repoDir, ["commit", "-m", message]), "commit");
    return {};
  });

  const restoreRoute = makePostRoute("/api/desktop-git/restore", async (cwd, body) => {
    if (typeof body?.path !== "string" || body.path === "") {
      const error = new Error("path-required");
      error.status = 400;
      throw error;
    }
    const repoDir = resolveRepoDir(cwd, body?.repo);
    await requireGitRepo(repoDir);
    const { abs } = resolveWithinCwd(repoDir, body.path);
    requireGitOk(
      await runGit(repoDir, ["restore", "--", gitRelPath(repoDir, abs)]),
      "restore",
    );
    return {};
  });

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(configRoute),
      ctx.webServer.register(reposRoute),
      ctx.webServer.register(statusRoute),
      ctx.webServer.register(diffRoute),
      ctx.webServer.register(logRoute),
      ctx.webServer.register(stageRoute),
      ctx.webServer.register(unstageRoute),
      ctx.webServer.register(commitRoute),
      ctx.webServer.register(restoreRoute),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "dsh-desktop-git: config, repos, status, diff, log, stage, unstage, commit and restore routes");
}
