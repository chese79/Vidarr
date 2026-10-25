$ErrorActionPreference='Stop'
$artifacts=Join-Path $PSScriptRoot '.artifacts'
$dll=Join-Path $artifacts 'Jellyfin.Plugin.Mtv.dll'
if(!(Test-Path -LiteralPath $dll)){throw 'Run the build and tests first'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'meta.json') -Destination (Join-Path $artifacts 'meta.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $artifacts 'README.md')
$sources=Get-ChildItem (Join-Path $PSScriptRoot 'Jellyfin.Plugin.Mtv') -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/](bin|obj)[\\/]' -and $_.Extension -in @('.cs','.csproj','.html') } | Sort-Object FullName | ForEach-Object { @{File=[IO.Path]::GetRelativePath($PSScriptRoot,$_.FullName);SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} }
$metadata=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'meta.json') -Raw | ConvertFrom-Json
@{Version=$metadata.version;TargetAbi=$metadata.targetAbi;DLLSHA256=(Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash;Sources=@($sources)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $artifacts 'build-info.json') -Encoding utf8NoBOM
$archive=Join-Path $artifacts "MTV-Music-Video-Info-$($metadata.version).zip"
Compress-Archive -LiteralPath $dll,(Join-Path $artifacts 'meta.json'),(Join-Path $artifacts 'README.md'),(Join-Path $artifacts 'build-info.json') -DestinationPath $archive -Force
Write-Output $archive
