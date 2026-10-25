param([string]$Runtime = 'C:\Program Files\Jellyfin\Server')
$ErrorActionPreference='Stop'
$lab=Join-Path $PSScriptRoot '.lab'
$output=Join-Path $lab 'production-media/Embedded ASS Diagnostic.mkv'
if(Test-Path -LiteralPath $output){throw 'Diagnostic already exists; no file overwritten'}
& (Join-Path $Runtime 'ffmpeg.exe') -hide_banner -loglevel error -n -i (Join-Path $lab 'media/MTV Test 1.mp4') -i (Join-Path $lab 'media/MTV Test 1.eng.ass') -map 0:v:0 -map 0:a:0 -map 1:0 -c:v copy -c:a copy -c:s ass -metadata:s:s:0 language=eng -metadata:s:s:0 title='MTV Overlay Diagnostic' -disposition:s:0 default $output
if($LASTEXITCODE-ne 0){throw 'Diagnostic mux failed'}
Write-Output 'Synthetic MKV prepared with video/audio stream copy and embedded ASS at index 2.'
