$ErrorActionPreference='Stop'
$labMedia=Join-Path (Split-Path $PSScriptRoot -Parent) 'jellyfin-mtv-poc/.lab/media'
$controlName='MTV Native Index Control'
$controlVideo=Join-Path $labMedia "$controlName.mp4"
if(!(Test-Path -LiteralPath $controlVideo)){Copy-Item -LiteralPath (Join-Path $labMedia 'MTV Test 1.mp4') -Destination $controlVideo}
$controlNfo=Join-Path $labMedia "$controlName.nfo"
if(!(Test-Path -LiteralPath $controlNfo)){'<musicvideo><title>Native Index Control</title><artist>Test Artist</artist><year>2026</year></musicvideo>' | Set-Content -LiteralPath $controlNfo -Encoding utf8NoBOM}
$foreignSubtitle=Join-Path $labMedia "$controlName.eng.srt"
if(!(Test-Path -LiteralPath $foreignSubtitle)){"1`n00:00:10,000 --> 00:00:12,000`nForeign subtitle control`n" | Set-Content -LiteralPath $foreignSubtitle -Encoding utf8NoBOM}
Write-Output 'Isolated native-index fixture retained with an ordinary subtitle control.'
