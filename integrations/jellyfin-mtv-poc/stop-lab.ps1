$ErrorActionPreference = 'Stop'
$lab = Join-Path $PSScriptRoot '.lab'
$pidFile = Join-Path $lab 'server.pid'
if (!(Test-Path -LiteralPath $pidFile)) { throw 'No lab process recorded' }
$labProcessId = [int](Get-Content -LiteralPath $pidFile)
$labProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $labProcessId"
if (!$labProcess) { Write-Output 'Lab is already stopped'; return }
if ($labProcess.Name -ne 'jellyfin.exe' -or !$labProcess.CommandLine.Contains($lab,[StringComparison]::OrdinalIgnoreCase)) { throw 'PID does not identify this lab; refusing to stop it' }
Stop-Process -Id $labProcessId
Write-Output 'Only the isolated lab was stopped. Test files and configuration are retained.'
