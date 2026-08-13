import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'

const workspace = mkdtempSync(path.join(homedir(), 'dsh-desktop-pwsh-smoke-'))
const marker = path.join(workspace, 'marker.txt')
const literal = value => `'${value.replaceAll("'", "''")}'`

const ctx = new Context()
try {
  await ctx.plugin(LocalSandboxProvider, {})
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxPwshExecutor, {})
  const executor = ctx.shell
  const policy = { mode: 'workspace-write', workspaceRoot: workspace }

  if (process.env.HARNESS_DESKTOP_WINDOW_PROBE === '1') {
    const probe = await executor.run(executor.resolve({
      command: "Write-Output 'window-probe-start'; Start-Sleep -Seconds 6; Write-Output 'window-probe-end'",
      sandboxPolicy: policy,
    }))
    if (!probe.stdout.text.includes('window-probe-end') || probe.exitCode !== 0) process.exitCode = 10
  }

  const output = await executor.run(executor.resolve({ command: "Write-Output 'desktop-output-ok'", sandboxPolicy: policy }))
  if (!output.stdout.text.includes('desktop-output-ok') || output.exitCode !== 0) process.exitCode = 11

  const exit = await executor.run(executor.resolve({ command: 'exit 42', sandboxPolicy: policy }))
  if (exit.exitCode !== 42) process.exitCode = 12

  const write = await executor.run(executor.resolve({
    command: `Set-Content -LiteralPath ${literal(marker)} -Value 'desktop-write-ok'; Write-Output 'desktop-write-ok'`,
    sandboxPolicy: policy,
  }))
  if (write.exitCode !== 0 || !write.stdout.text.includes('desktop-write-ok')
    || !existsSync(marker) || !readFileSync(marker, 'utf8').includes('desktop-write-ok')) process.exitCode = 13
} catch (error) {
  console.error(error)
  process.exitCode = 20
} finally {
  await ctx.fiber.dispose().catch(() => {})
  rmSync(workspace, { recursive: true, force: true })
}
