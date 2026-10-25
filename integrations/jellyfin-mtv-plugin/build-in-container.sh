#!/bin/sh
set -eu
mkdir -p /tmp/mtv-build/Jellyfin.Plugin.Mtv/Configuration /tmp/mtv-build/Tests /tmp/mtv-runtime
cp /src/Jellyfin.Plugin.Mtv/*.cs /src/Jellyfin.Plugin.Mtv/*.csproj /tmp/mtv-build/Jellyfin.Plugin.Mtv/
cp /src/Jellyfin.Plugin.Mtv/Configuration/*.html /tmp/mtv-build/Jellyfin.Plugin.Mtv/Configuration/
cp /src/Tests/*.cs /src/Tests/*.csproj /tmp/mtv-build/Tests/
for name in MediaBrowser.Common MediaBrowser.Model MediaBrowser.Controller Jellyfin.Data Jellyfin.Database.Implementations Jellyfin.Api; do
 cp "/jellyfin/$name.dll" /tmp/mtv-runtime/
done
dotnet build /tmp/mtv-build/Jellyfin.Plugin.Mtv -c Release -p:JellyfinRuntimePath=/tmp/mtv-runtime -p:UseSharedCompilation=false --disable-build-servers -m:1
dotnet run --project /tmp/mtv-build/Tests -p:UseSharedCompilation=false
cp /tmp/mtv-build/Jellyfin.Plugin.Mtv/bin/Release/net10.0/Jellyfin.Plugin.Mtv.dll /artifacts/
sha256sum /artifacts/Jellyfin.Plugin.Mtv.dll
