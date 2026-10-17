param(
    [string]$releaseImage = 'vidarr-music-discovery:final',
    [string]$deploymentId = '20261016-music-discovery-4f37a6b1'
)
$ErrorActionPreference = 'Stop'
$candidateName = "vidarr-candidate-$deploymentId"
$rollbackName = "vidarr-rollback-$deploymentId"
$backupName = "vidarr-backup-$deploymentId"
$previous = (docker inspect vidarr | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0 -or !$previous.State.Running) { throw 'Existing Vidarr is not running' }
if ($previous.HostConfig.NetworkMode -ne 'bridge') { throw 'Unexpected network mode; inspect before deployment' }
$release = (docker image inspect $releaseImage | ConvertFrom-Json)[0]
if ($LASTEXITCODE -ne 0) { throw 'Release image is unavailable' }
$createArgs = @('create', '--name', $candidateName, '--restart', $previous.HostConfig.RestartPolicy.Name, '--network', 'bridge', '--log-driver', $previous.HostConfig.LogConfig.Type)
foreach ($entry in $previous.HostConfig.LogConfig.Config.PSObject.Properties) { $createArgs += @('--log-opt', "$($entry.Name)=$($entry.Value)") }
foreach ($entry in $previous.HostConfig.PortBindings.PSObject.Properties) {
    foreach ($binding in $entry.Value) { $createArgs += @('--publish', "$($binding.HostIp):$($binding.HostPort):$($entry.Name)") }
}
foreach ($mount in $previous.Mounts) {
    if ($mount.Type -notin @('bind', 'volume')) { throw 'Unexpected mount type' }
    $mountSource = if ($mount.Type -eq 'volume') { $mount.Name } else { $mount.Source }
    $spec = "type=$($mount.Type),source=$mountSource,target=$($mount.Destination)"
    if (!$mount.RW) { $spec += ',readonly' }
    $createArgs += @('--mount', $spec)
}
foreach ($entry in $previous.Config.Env) { $createArgs += @('--env', $entry) }
$createArgs += $releaseImage
$created = & docker @createArgs
if ($LASTEXITCODE -ne 0) { throw 'Candidate creation failed; original service is still running' }
$candidate = (docker inspect $candidateName | ConvertFrom-Json)[0]
$oldMounts = @($previous.Mounts | ForEach-Object { "$($_.Type)|$($_.Source)|$($_.Destination)|$($_.RW)" } | Sort-Object)
$newMounts = @($candidate.Mounts | ForEach-Object { "$($_.Type)|$($_.Source)|$($_.Destination)|$($_.RW)" } | Sort-Object)
if (Compare-Object $oldMounts $newMounts) { throw 'Candidate mounts differ; original service is still running' }
docker volume create $backupName | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup volume creation failed' }
$stopped = $false
$renamed = $false
try {
    docker stop --time 30 vidarr | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Vidarr stop failed' }
    $stopped = $true
    $researchPath = $PSScriptRoot
    docker run --rm --user 0 --network none --read-only --volumes-from "vidarr:ro" --mount "type=volume,source=$backupName,target=/backup" --mount "type=bind,source=$researchPath,target=/audit,readonly" --entrypoint timeout $releaseImage 120 python3 -u /audit/deploy-backup.py
    if ($LASTEXITCODE -ne 0) { throw 'Configuration backup failed' }
    docker rename vidarr $rollbackName
    if ($LASTEXITCODE -ne 0) { throw 'Rollback container rename failed' }
    $renamed = $true
    docker rename $candidateName vidarr
    if ($LASTEXITCODE -ne 0) { throw 'Release container rename failed' }
    docker start vidarr | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Release start failed' }
    Write-Output ([pscustomobject]@{ Started=$true; Image=$releaseImage; ImageId=$release.Id; ContainerId=$candidate.Id; BackupVolume=$backupName; RollbackContainer=$rollbackName; MountsPreserved=$true } | ConvertTo-Json)
} catch {
    if ($renamed) {
        $current = docker inspect --format '{{.Id}}' vidarr 2>$null
        if ($LASTEXITCODE -eq 0 -and $current -eq $candidate.Id) {
            docker stop --time 15 vidarr | Out-Null
            docker rename vidarr $candidateName
        }
        docker rename $rollbackName vidarr
    }
    if ($stopped) { docker start vidarr | Out-Null }
    throw
}
