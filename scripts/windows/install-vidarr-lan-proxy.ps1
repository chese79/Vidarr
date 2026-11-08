param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
# Run as the desktop user; only the separate scoped firewall rule needs elevation.
$node=(Resolve-Path -LiteralPath $NodePath).Path
if ((& $node --version) -notmatch '^v22\.') { throw 'A verified Node 22 executable is required' }
$destination=Join-Path $env:LOCALAPPDATA 'Vidarr\LanAccess'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$runtime=Join-Path $destination 'node.exe'
$proxy=Join-Path $destination 'vidarr-lan-proxy.mjs'
$existing=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq $runtime -and $_.CommandLine -like '*vidarr-lan-proxy.mjs*'})
if($existing.Count){throw 'The installed LAN proxy is already running; stop only that process before updating'}
Copy-Item -LiteralPath $node -Destination $runtime -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'vidarr-lan-proxy.mjs') -Destination $proxy -Force
$launcher=Join-Path ([Environment]::GetFolderPath('Startup')) 'Vidarr LAN Access.vbs'
$command='"'+$runtime+'" "'+$proxy+'"'
$vb='CreateObject("WScript.Shell").Run "'+$command.Replace('"','""')+'", 0, False'
Set-Content -LiteralPath $launcher -Value $vb -Encoding Unicode
Start-Process -FilePath $runtime -ArgumentList ('"'+$proxy+'"') -WindowStyle Hidden
Write-Output "Installed per-user LAN listener and logon launcher: $destination"
