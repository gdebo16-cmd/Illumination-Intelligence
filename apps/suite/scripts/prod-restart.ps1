# scripts/prod-restart.ps1 - the fixed "update and restart prod" sequence behind the restart_prod
# tool (lib/umbra/prod-control.ts). It only runs after you tap Approve in a Flicker chat, and it
# takes no commands from the Flicker: only the request id and the app's own paths.
#
#   1. git pull --ff-only illumen main in the repo. Stops if the repo isn't on main or the pull
#      would touch uncommitted work. Nothing is ever stashed, reset or forced.
#   2. npm run build in apps\suite. If it fails, prod keeps running the old build.
#   3. Only if the build passed: stop the supervisor's "npm run start" (the cmd.exe whose command
#      line has both "npm run start" and "suite-prod.log") with taskkill /T. The IlluminationSuite
#      supervisor (suite-supervisor.ps1) starts prod again on the new build. The dev server on
#      port 3001 and the supervisor itself are never touched.
#
# Progress goes to the JSON file given in -Result, so the Flicker can see how it went once the
# server is back. Output tails are scrubbed of anything that looks like a token.

param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$Suite,
  [Parameter(Mandatory = $true)][string]$Result,
  [switch]$Worker
)

$ErrorActionPreference = 'Stop'
if ($Id -notmatch '^[0-9a-fA-F-]{36}$') { exit 2 }

if (-not $Worker) {
  # Started by the server: relaunch outside its process tree (this copy exits straight away), so
  # stopping prod's tree in step 3 doesn't stop this script too.
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"",
    '-Id', $Id, '-Suite', "`"$Suite`"", '-Result', "`"$Result`"", '-Worker')
  Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden | Out-Null
  exit 0
}

# This server's own Next.js and npm settings would confuse the build.
Get-ChildItem env: | Where-Object { $_.Name -match '^(__NEXT|NEXT_RUNTIME$|NEXT_PHASE$|TURBOPACK|npm_|NODE_OPTIONS$|GITHUB_TOKEN$|PORT$)' } |
  ForEach-Object { Remove-Item -LiteralPath ("env:" + $_.Name) -ErrorAction SilentlyContinue }
$env:GIT_TERMINAL_PROMPT = '0'

$repo = (Resolve-Path -LiteralPath (Join-Path $Suite '..\..')).Path
$work = Join-Path (Split-Path -Parent $Result) 'prod-restart'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)

$state = [ordered]@{
  id = $Id; status = 'starting'; stage = 'start'; message = 'Starting.'; pull = ''; build = ''
  oldPid = $null; newPid = $null; startedAt = (Get-Date).ToString('o'); updatedAt = ''; finishedAt = $null
}

function Save {
  $state.updatedAt = (Get-Date).ToString('o')
  $json = $state | ConvertTo-Json -Depth 4
  $tmp = "$Result.tmp"
  [System.IO.File]::WriteAllText($tmp, $json, $utf8)
  Move-Item -LiteralPath $tmp -Destination $Result -Force
}

function Scrub([string]$text) {
  if (-not $text) { return '' }
  $t = $text -replace '(gh[pousr]_|github_pat_)[A-Za-z0-9_]+', '***'
  $t = $t -replace 'crsr_[A-Za-z0-9_-]+', '***'
  $t = $t -replace '(https?://)[^/@\s]+@', '$1'
  return $t
}

function Tail([string]$file, [int]$lines = 40) {
  $out = @()
  foreach ($f in @($file, "$file.err")) {
    if (Test-Path -LiteralPath $f) { $out += Get-Content -LiteralPath $f -Tail $lines -Encoding UTF8 -ErrorAction SilentlyContinue }
  }
  $text = ($out | Where-Object { $_ -ne $null }) -join "`n"
  if ($text.Length -gt 4000) { $text = $text.Substring($text.Length - 4000) }
  return (Scrub $text)
}

function Finish([string]$status, [string]$message) {
  $state.status = $status
  $state.message = $message
  $state.finishedAt = (Get-Date).ToString('o')
  Save
  exit 0
}

# Run one program, wait up to $seconds, and return its exit code (-1 if it ran too long).
function Run-Step([string]$exe, [string]$arguments, [string]$cwd, [string]$log, [int]$seconds) {
  Remove-Item -LiteralPath $log, "$log.err" -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $cwd -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  $null = $p.Handle  # keeps the exit code readable after it ends
  if (-not $p.WaitForExit($seconds * 1000)) {
    Start-Process -FilePath 'taskkill.exe' -ArgumentList "/T /F /PID $($p.Id)" -WindowStyle Hidden -Wait
    return -1
  }
  $p.WaitForExit()
  return [int]$p.ExitCode
}

try {
  Start-Sleep -Seconds 3

  # 1. Pull
  $state.status = 'pulling'; $state.stage = 'pull'; $state.message = 'Getting the latest main.'; Save
  $branchLog = Join-Path $work 'branch.log'
  $null = Run-Step 'git.exe' 'rev-parse --abbrev-ref HEAD' $repo $branchLog 30
  $branch = ((Get-Content -LiteralPath $branchLog -ErrorAction SilentlyContinue) -join '').Trim()
  if ($branch -ne 'main') { Finish 'failed' "The repo on the PC is on '$branch', not main, so nothing was pulled, built or restarted." }
  $pullLog = Join-Path $work 'pull.log'
  $code = Run-Step 'git.exe' 'pull --ff-only illumen main' $repo $pullLog 180
  $state.pull = Tail $pullLog 25
  if ($code -ne 0) {
    $why = if ($code -eq -1) { 'git pull took too long and was stopped' }
      elseif ($state.pull -match 'would be overwritten|Please commit your changes or stash them') { 'the pull would change files that have uncommitted changes on the PC (nothing was stashed or reset)' }
      elseif ($state.pull -match 'Not possible to fast-forward|diverg') { "the PC's main has commits GitHub doesn't, so it can't fast-forward" }
      else { "git pull failed (exit $code)" }
    Finish 'failed' "Stopped before building: $why. Prod was not restarted."
  }

  # 2. Build
  $state.status = 'building'; $state.stage = 'build'; $state.message = 'Building.'; Save
  $buildLog = Join-Path $work 'build.log'
  $code = Run-Step 'cmd.exe' '/d /c npm run build' $Suite $buildLog 900
  $state.build = Tail $buildLog 40
  if ($code -ne 0) {
    $why = if ($code -eq -1) { 'the build took longer than 15 minutes and was stopped' } else { "the build failed (exit $code)" }
    Finish 'failed' "Stopped: $why. Prod was not restarted."
  }

  # 3. Restart: stop the supervisor's npm run start; the supervisor brings prod back up.
  $prod = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*npm run start*' -and $_.CommandLine -like '*suite-prod.log*' })
  if ($prod.Count -ne 1) {
    Finish 'failed' "The build passed, but $($prod.Count) prod processes were found instead of one, so prod was not restarted. It still runs the old build until it is restarted."
  }
  $oldPid = [int]$prod[0].ProcessId
  $state.status = 'restarting'; $state.stage = 'restart'; $state.oldPid = $oldPid; $state.message = 'Restarting prod.'; Save
  Start-Process -FilePath 'taskkill.exe' -ArgumentList "/T /F /PID $oldPid" -WindowStyle Hidden -Wait

  # Wait for the supervisor to start it again and for the site to answer.
  $deadline = (Get-Date).AddSeconds(150)
  Start-Sleep -Seconds 8
  while ((Get-Date) -lt $deadline) {
    $next = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -like '*npm run start*' -and $_.CommandLine -like '*suite-prod.log*' -and [int]$_.ProcessId -ne $oldPid })
    if ($next.Count -ge 1) {
      try {
        $res = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 10
        if ($res.StatusCode -eq 200) {
          $state.newPid = [int]$next[0].ProcessId
          Finish 'done' 'Pulled main, built, and restarted. Prod is back up on the new build.'
        }
      } catch { }
    }
    Start-Sleep -Seconds 3
  }
  Finish 'failed' 'The build passed and prod was stopped, but it did not answer again within about 2.5 minutes. The supervisor keeps trying; check suite-prod.log.'
} catch {
  $state.status = 'failed'
  $state.message = Scrub ("The restart script hit an error at the $($state.stage) step: " + $_.Exception.Message)
  $state.finishedAt = (Get-Date).ToString('o')
  Save
}
