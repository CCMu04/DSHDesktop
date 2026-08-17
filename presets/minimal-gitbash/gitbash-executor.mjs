/**
 * gitbash-executor — DSHDesktop 自研的 Git-for-Windows bash 提供者（agent
 * preset 本地模块，仅 Windows）。设计灵感来自 liceses/dsh-gitbash-preset
 * (MIT)，按桌面端场景重写：
 *
 *  - 为什么存在：官方极简模式（minimal）的持久 bash 依赖 PTY，而
 *    @deepseek-ai/dsh-subprocess-local 在 win32 上拒绝 terminal
 *    inspection；@deepseek-ai/dsh-bash-local 又硬编码从 PATH 找 bash，
 *    Windows 默认没有。
 *  - 做什么：在 entry-local realm 内以 `ctx.provide('shell', executor)`
 *    取代 shell 服务，每条命令以 `"<git bash>" -c <command>` 通过宿主
 *    subprocess 服务执行——每次调用全新 shell，与官方极简模式相同的
 *    bash 工具名与 str_replace_editor 表面。只 import Node 内置模块：
 *    预设内文件相对预设目录解析，不能用 DSH 的 node_modules。
 *  - 沙箱：MSYS 运行时在 Windows 受限令牌下无法初始化（无法创建信号
 *    管道），因此命令仅在 danger-full-access 策略下放行，受限时抛出带
 *    桌面端指引的中文错误，不绕过沙箱。
 *
 * 探测顺序（桌面端通过 GIT_BASH 环境变量注入托管 bash，即第一优先级）：
 * 显式配置 shellPath → GIT_BASH → Program Files 安装根 → LOCALAPPDATA
 * Programs\Git → PATH 中真实存在的 bash.exe（跳过 System32 下的 WSL
 * 启动器 stub）→ 兜底 `bash`。
 */

import { existsSync } from 'node:fs'

/** Cordis 插件名，loader 诊断用。 */
export const name = 'gitbash-executor'

/** 需要的宿主服务；apply() 会立即读取，顺序敏感。 */
export const inject = ['subprocess', 'sandboxPolicy']

/** Node 定时器上限，超过会被 clamp 到 1ms。 */
const MAX_TIMER_DELAY_MS = 2147483647

/** 模型友好环境：禁颜色、禁分页器，避免命令输出被终端控制序列搅乱。 */
const ENV_OVERRIDES = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
}

/**
 * 把 Git Bash / MSYS 盘符路径 `/d/foo` 转成 Windows 路径 `D:\foo`，供
 * node:child_process 作为 cwd 或可执行路径。只转换单字母盘符形式
 * （`/d`、`/d/`、`/d/foo`，字母后必须紧跟 `/` 或字符串结束），因此
 * MSYS 根路径如 `/usr/bin` 不会被误转成 `U:\sr\bin`。其余（UNC、`D:\`、
 * `D:/`）原样通过。
 */
export function toWindowsPath(value) {
  if (
    process.platform !== 'win32' ||
    typeof value !== 'string' ||
    value.length === 0
  ) {
    return value
  }
  const match = /^\/\s*([A-Za-z])(?:$|\/(.*))$/.exec(value)
  if (match === null) return value
  const drive = `${match[1].toUpperCase()}:`
  const rest = match[2] ?? ''
  if (rest === '') return `${drive}\\`
  return `${drive}\\${rest.replace(/\//g, '\\')}`
}

/**
 * 判断目录是否为存放 Microsoft bash.exe stub（WSL 启动器）的目录：
 * `<SystemRoot>\System32` 及其 WoW64 镜像。该 stub 只是桥接到 wsl.exe，
 * 在无 WSL 发行版时执行必然失败（"no installed distribution"），
 * 探测时必须跳过。
 */
export function isWslBashDirectory(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return false
  return /(?:\\|\/)(?:system32|sysnative|syswow64)$/i.test(dir)
}

/**
 * bash.exe 候选，按优先级：GIT_BASH 环境变量 → 标准安装根 → PATH 中每个
 * 目录的 bash.exe（System32 系目录跳过）。
 */
function shellPathCandidates(env) {
  const candidates = [
    env.GIT_BASH,
    env.ProgramFiles === undefined
      ? undefined
      : `${env.ProgramFiles}\\Git\\bin\\bash.exe`,
    env['ProgramFiles(x86)'] === undefined
      ? undefined
      : `${env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`,
    env.LOCALAPPDATA === undefined
      ? undefined
      : `${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
  ]
  if (typeof env.PATH === 'string' && env.PATH.length > 0) {
    for (const dir of env.PATH.split(';')) {
      if (dir.length === 0) continue
      if (isWslBashDirectory(dir)) continue
      candidates.push(`${dir}\\bash.exe`)
    }
  }
  return candidates
}

/**
 * 解析要 spawn 的 shell 可执行文件。显式配置优先；非 Windows 主机总是
 * `bash`；Windows 上取第一个真实存在的候选（GIT_BASH → 安装根 → PATH），
 * 全部不存在时回退裸 `bash` 名，让 spawn 报解析错误。`exists` 可注入以便测试。
 */
export function detectShellPath(
  explicit,
  env = process.env,
  exists = existsSync,
) {
  if (process.platform !== 'win32') {
    return typeof explicit === 'string' && explicit.length > 0
      ? explicit
      : 'bash'
  }
  if (typeof explicit === 'string' && explicit.length > 0)
    return toWindowsPath(explicit)
  for (const candidate of shellPathCandidates(env)) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    if (exists(candidate)) return toWindowsPath(candidate)
  }
  return 'bash'
}

function positiveNumber(config, label, fallback) {
  const value = config[label] ?? fallback
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name}: ${label} 必须是有限正数`)
  }
  return value
}

export function resolveConfig(config, env = process.env) {
  const source = config ?? {}
  const timeoutMs = positiveNumber(source, 'timeoutMs', 120000)
  const maxTimeoutMs = positiveNumber(source, 'maxTimeoutMs', 600000)
  const graceMs = positiveNumber(source, 'graceMs', 3000)
  if (
    timeoutMs > MAX_TIMER_DELAY_MS ||
    maxTimeoutMs > MAX_TIMER_DELAY_MS ||
    graceMs > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      `${name}: timeoutMs、maxTimeoutMs、graceMs 不能超过 ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return {
    shellPath: detectShellPath(source.shellPath, env),
    cwd:
      typeof source.cwd === 'string' && source.cwd.length > 0
        ? toWindowsPath(source.cwd)
        : undefined,
    timeoutMs,
    maxTimeoutMs,
    maxOutputBytes: positiveNumber(source, 'maxOutputBytes', 64000),
    maxSpillBytes: positiveNumber(source, 'maxSpillBytes', 64 * 1024 * 1024),
    graceMs,
  }
}

/** 融合上游取消信号与可识别的超时。 */
function timeoutSignal(upstream, timeoutMs) {
  const timer = new AbortController()
  const id = setTimeout(() => {
    timer.abort(new Error('BASH_TIMEOUT'))
  }, timeoutMs)
  const signal =
    upstream === undefined
      ? timer.signal
      : AbortSignal.any([upstream, timer.signal])
  return {
    signal,
    timedOut: () => timer.signal.aborted,
    dispose: () => clearTimeout(id),
  }
}

/** 把一个已 settle 的收集器投影成工具结果形状。 */
function finalOutput(reader) {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...(read.spillPath === undefined ? {} : { spillPath: read.spillPath }),
  }
}

/** 包装 spawn 失败，带上 shell 路径与工作目录。 */
function spawnError(shellPath, workdir, cause) {
  return new Error(
    `${name}: 无法启动 ${shellPath}（工作目录：${workdir}）：${cause?.message ?? String(cause)}`,
    {
      cause,
    },
  )
}

/** 沙箱被拒时的中文指引（桌面端语境）。 */
function gateMessage(mode) {
  return (
    `${name}: Git Bash 无法在「${mode ?? '未知'}」沙箱下启动` +
    '（MSYS 运行时在 Windows 受限令牌下无法创建信号管道）。' +
    '请在会话权限徽章中把沙箱切到「完全访问」后重试；' +
    '或让模型对这条命令用 sandbox_permissions: "danger-full-access" + justification ' +
    '发起一次单次升级（走正常审批流程，不绕过沙箱）。'
  )
}

/** 把 git-bash 执行器注册为 entry-local 的 `shell` 提供者。 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error(`${name}: ctx.subprocess 不可用`)
  }
  const sandboxPolicy = ctx.get('sandboxPolicy')

  const spawnSpec = (spec, argv, stdoutMaxBytes, signal) => ({
    argv,
    cwd: spec.workdir,
    stdio: {
      stdin: spec.stdin !== undefined ? { data: spec.stdin } : 'ignore',
      stdout: {
        maxBytes: stdoutMaxBytes,
        spill: { maxBytes: resolved.maxSpillBytes },
      },
      stderr: {
        maxBytes: resolved.maxOutputBytes,
        spill: { maxBytes: resolved.maxSpillBytes },
      },
    },
    graceMs: resolved.graceMs,
    signal,
    env: {
      ...ENV_OVERRIDES,
      ...spec.env,
      ...spec.dshEnv,
    },
  })

  const spawnShell = (spec, stdoutMaxBytes, signal) => {
    try {
      return subprocess.spawn(
        spawnSpec(
          spec,
          [resolved.shellPath, '-c', spec.command],
          stdoutMaxBytes,
          signal,
        ),
      )
    } catch (error) {
      throw spawnError(resolved.shellPath, spec.workdir, error)
    }
  }

  const executor = {
    /** 上报约束模式，让 bash 工具层提供单次升级。 */
    get sandboxMode() {
      return sandboxPolicy === undefined ? undefined : sandboxPolicy.defaultMode
    },

    resolve(request) {
      const timeoutMs = Math.min(
        request.timeoutMs ?? resolved.timeoutMs,
        resolved.maxTimeoutMs,
      )
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`${name}: request.timeoutMs 必须是有限正数`)
      }
      const stdoutMaxBytes = request.stdoutMaxBytes ?? resolved.maxOutputBytes
      if (!Number.isFinite(stdoutMaxBytes) || stdoutMaxBytes <= 0) {
        throw new Error(`${name}: request.stdoutMaxBytes 必须是有限正数`)
      }
      return {
        command: request.command,
        workdir: toWindowsPath(
          request.workdir ?? resolved.cwd ?? process.cwd(),
        ),
        timeoutMs,
        stdoutMaxBytes,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
        ...(request.env === undefined ? {} : { env: request.env }),
        ...(request.dshEnv === undefined ? {} : { dshEnv: request.dshEnv }),
        sandboxPolicy:
          request.sandboxPolicy ??
          (sandboxPolicy?.resolve === undefined
            ? undefined
            : sandboxPolicy.resolve()),
      }
    },

    async run(spec) {
      const mode = spec.sandboxPolicy?.mode
      // undefined 表示部署完全没有沙箱策略。
      if (mode !== undefined && mode !== 'danger-full-access') {
        throw new Error(gateMessage(mode))
      }
      const fused = timeoutSignal(spec.signal, spec.timeoutMs)
      try {
        const handle = spawnShell(spec, spec.stdoutMaxBytes, fused.signal)
        let outcome
        try {
          outcome = await handle.done
        } catch (error) {
          throw spawnError(resolved.shellPath, spec.workdir, error)
        }
        const stdout = finalOutput(handle.collected.stdout)
        const stderr = finalOutput(handle.collected.stderr)
        const timedOut = fused.timedOut()
        const aborted =
          spec.signal !== undefined && spec.signal.aborted && !timedOut
        return {
          ...outcome,
          timedOut,
          aborted,
          timeoutMs: spec.timeoutMs,
          stdout,
          stderr,
          ...(mode === undefined ? {} : { sandbox: { mode, denied: false } }),
        }
      } finally {
        fused.dispose()
      }
    },

    start(spec) {
      const mode = spec.sandboxPolicy?.mode
      if (mode !== undefined && mode !== 'danger-full-access') {
        throw new Error(gateMessage(mode))
      }
      const running = spawnShell(spec, resolved.maxOutputBytes, spec.signal)
      const collected = {
        stdout: running.collected.stdout,
        stderr: running.collected.stderr,
      }
      let spawnFailureNote
      const consumeSpawnFailure = () => {
        const note = spawnFailureNote ?? ''
        spawnFailureNote = undefined
        return note
      }
      let stdoutOffset = 0
      let stderrOffset = 0
      const proc = {
        status: 'running',
        exitCode: null,
        signal: null,
        done: running.done.then(
          (outcome) => {
            if (proc.status === 'running') {
              proc.status =
                spec.signal?.aborted === true || outcome.signal !== null
                  ? 'killed'
                  : 'completed'
            }
            proc.exitCode = outcome.exitCode
            proc.signal = outcome.signal
          },
          (error) => {
            proc.status = 'killed'
            spawnFailureNote = spawnError(
              resolved.shellPath,
              spec.workdir,
              error,
            ).message
          },
        ),
        readOutput: () => {
          const out = collected.stdout.readFrom(stdoutOffset)
          const err = collected.stderr.readFrom(stderrOffset)
          stdoutOffset = out.nextOffset
          stderrOffset = err.nextOffset
          const errText = err.text.length > 0 ? err.text : consumeSpawnFailure()
          const separator =
            out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
          return {
            delta:
              out.text +
              (errText.length > 0 ? `${separator}[stderr]\n${errText}` : ''),
            lossy: out.lossy || err.lossy,
            ...(out.spillPath === undefined
              ? {}
              : { stdoutSpillPath: out.spillPath }),
            ...(err.spillPath === undefined
              ? {}
              : { stderrSpillPath: err.spillPath }),
          }
        },
        kill: () => {
          if (proc.status !== 'running') return false
          proc.status = 'killed'
          running.terminate()
          return true
        },
      }
      return proc
    },
  }

  ctx.provide('shell', executor)
}
