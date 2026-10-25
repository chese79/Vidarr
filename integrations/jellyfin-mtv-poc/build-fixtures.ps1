param([string]$Runtime = 'C:\Program Files\Jellyfin\Server')
$ErrorActionPreference = 'Stop'
$media = Join-Path $PSScriptRoot '.lab/media'
New-Item -ItemType Directory -Force -Path $media | Out-Null
for ($index=1; $index -le 2; $index++) {
  $name = "MTV Test $index"
  $video = Join-Path $media "$name.mp4"
  if (!(Test-Path -LiteralPath $video)) {
    & (Join-Path $Runtime 'ffmpeg.exe') -hide_banner -loglevel error -n -f lavfi -i 'testsrc2=size=1280x720:rate=24' -f lavfi -i "sine=frequency=$($index*220):sample_rate=48000" -t 24 -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart $video
    if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed' }
  }
  $metadata = Join-Path $media "$name.json"
  if (!(Test-Path -LiteralPath $metadata)) { @{ artist='Test Artist';title="Synthetic Song $index";album='Overlay Test Fixtures';videoYear=2026;director='Test Director' } | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding utf8NoBOM }
  $subtitle = Join-Path $media "$name.eng.ass"
  if (!(Test-Path -LiteralPath $subtitle)) {
    & node (Join-Path $PSScriptRoot 'overlay.mjs') $metadata 24 $subtitle
    if ($LASTEXITCODE -ne 0) { throw 'Overlay generation failed' }
  }
  $nfo = Join-Path $media "$name.nfo"
  if (!(Test-Path -LiteralPath $nfo)) { "<musicvideo><title>Synthetic Song $index</title><artist>Test Artist</artist><album>Overlay Test Fixtures</album><year>2026</year><director>Test Director</director><plot>Synthetic media for isolated MTV overlay testing.</plot></musicvideo>" | Set-Content -LiteralPath $nfo -Encoding utf8 }
}
Write-Output 'Two synthetic 24-second fixtures, NFO files and ASS tracks are ready.'
