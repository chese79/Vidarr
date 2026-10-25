param([string]$JellyfinRuntime='C:\Program Files\Jellyfin\Server')
$ErrorActionPreference='Stop'
foreach($name in @('MediaBrowser.Common','MediaBrowser.Model','MediaBrowser.Controller','Jellyfin.Api')){if(!(Test-Path -LiteralPath (Join-Path $JellyfinRuntime "$name.dll"))){throw 'Expected Jellyfin runtime is missing'}}
$artifacts=Join-Path $PSScriptRoot '.artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
docker run --rm --network none --mount "type=bind,source=$PSScriptRoot,target=/src,readonly" --mount "type=bind,source=$JellyfinRuntime,target=/jellyfin,readonly" --mount "type=bind,source=$artifacts,target=/artifacts" --env DOTNET_GCHeapHardLimit=0x30000000 --env DOTNET_CLI_HOME=/tmp/dotnet --entrypoint sh mcr.microsoft.com/dotnet/sdk:10.0 /src/build-in-container.sh
if($LASTEXITCODE-ne 0){throw 'Plugin build or tests failed'}
