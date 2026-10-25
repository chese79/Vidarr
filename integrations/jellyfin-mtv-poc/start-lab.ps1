param([string]$Runtime = 'C:\Program Files\Jellyfin\Server')
$ErrorActionPreference = 'Stop'
$lab = Join-Path $PSScriptRoot '.lab'
if (Get-NetTCPConnection -LocalPort 18096 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 18096 is occupied; no server started' }
foreach ($folder in @('data','config','cache','logs','media','evidence')) { New-Item -ItemType Directory -Force -Path (Join-Path $lab $folder) | Out-Null }
$network = Join-Path $lab 'config/network.xml'
if (!(Test-Path -LiteralPath $network)) {
  @'
<?xml version="1.0" encoding="utf-8"?>
<NetworkConfiguration>
 <InternalHttpPort>18096</InternalHttpPort><PublicHttpPort>18096</PublicHttpPort>
 <InternalHttpsPort>18920</InternalHttpsPort><PublicHttpsPort>18920</PublicHttpsPort>
 <EnableHttps>false</EnableHttps><RequireHttps>false</RequireHttps>
 <EnableIPv4>true</EnableIPv4><EnableIPv6>false</EnableIPv6>
 <EnableRemoteAccess>false</EnableRemoteAccess><EnableUPnP>false</EnableUPnP>
 <EnablePublishedServerUriByRequest>false</EnablePublishedServerUriByRequest>
</NetworkConfiguration>
'@ | Set-Content -LiteralPath $network -Encoding utf8
}
$arguments = @('--datadir', ('"' + (Join-Path $lab 'data') + '"'), '--configdir', ('"' + (Join-Path $lab 'config') + '"'), '--cachedir', ('"' + (Join-Path $lab 'cache') + '"'), '--logdir', ('"' + (Join-Path $lab 'logs') + '"'), '--webdir', ('"' + (Join-Path $Runtime 'jellyfin-web') + '"'), '--ffmpeg', ('"' + (Join-Path $Runtime 'ffmpeg.exe') + '"'), '--nonetchange')
$process = Start-Process -FilePath (Join-Path $Runtime 'jellyfin.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $lab 'stdout.log') -RedirectStandardError (Join-Path $lab 'stderr.log')
$process.Id | Set-Content -LiteralPath (Join-Path $lab 'server.pid')
Write-Output "Isolated Jellyfin PID $($process.Id); test URL http://192.168.0.8:18096"
