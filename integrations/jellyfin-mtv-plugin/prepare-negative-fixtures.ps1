$ErrorActionPreference='Stop'
$lab=Join-Path (Split-Path $PSScriptRoot) 'jellyfin-mtv-poc/.lab'
$source=Join-Path $lab 'media/MTV Test 1.mp4'
if(!(Test-Path -LiteralPath $source)){throw 'Generate the isolated synthetic fixture first'}
$movie=Join-Path $lab 'negative-movies'
$show=Join-Path $lab 'negative-tv/MTV Negative Show'
$season=Join-Path $show 'Season 01'
foreach($folder in @($movie,$season)){New-Item -ItemType Directory -Force -Path $folder | Out-Null}
foreach($target in @((Join-Path $movie 'MTV Negative Movie (2026).mp4'),(Join-Path $season 'MTV Negative Show S01E01.mp4'))){if(!(Test-Path -LiteralPath $target)){Copy-Item -LiteralPath $source -Destination $target};if((Get-FileHash -LiteralPath $target).Hash-ne(Get-FileHash -LiteralPath $source).Hash){throw 'Negative fixture checksum mismatch'}}
$files=@{
 (Join-Path $movie 'MTV Negative Movie (2026).nfo')='<movie><title>MTV Negative Movie</title><year>2026</year></movie>';
 (Join-Path $show 'tvshow.nfo')='<tvshow><title>MTV Negative Show</title></tvshow>';
 (Join-Path $season 'MTV Negative Show S01E01.nfo')='<episodedetails><title>MTV Negative Episode</title><season>1</season><episode>1</episode></episodedetails>';
 (Join-Path $movie 'MTV Negative Movie (2026).eng.srt')="1`n00:00:00,000 --> 00:00:06,000`nOrdinary movie captions control`n";
 (Join-Path $season 'MTV Negative Show S01E01.eng.srt')="1`n00:00:00,000 --> 00:00:06,000`nOrdinary television captions control`n"
}
foreach($entry in $files.GetEnumerator()){if(!(Test-Path -LiteralPath $entry.Key)){$entry.Value | Set-Content -LiteralPath $entry.Key -Encoding utf8NoBOM}}
Write-Output 'Synthetic movie/episode controls prepared in the isolated lab only.'
