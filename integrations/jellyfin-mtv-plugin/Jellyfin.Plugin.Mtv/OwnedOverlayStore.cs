using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jellyfin.Plugin.Mtv;
public sealed record OwnedOverlay(string Path,string Hash);
public sealed class OwnedOverlayStore(string root)
{
 private readonly Dictionary<Guid,OwnedOverlay> entries=Load(root);
 private static Dictionary<Guid,OwnedOverlay> Load(string root)
 {
  var file=System.IO.Path.Combine(root,"owned-overlays.json");
  return File.Exists(file)?JsonSerializer.Deserialize<Dictionary<Guid,OwnedOverlay>>(File.ReadAllText(file))??[]:[];
 }
 public static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
 public OwnedOverlay? Find(Guid id){lock(entries)return entries.GetValueOrDefault(id);}
 public bool Valid(Guid id)
 {
  var entry=Find(id);return entry is not null&&File.Exists(entry.Path)&&Hash(File.ReadAllText(entry.Path))==entry.Hash;
 }
 public async Task<string> Write(Guid id,string mediaPath,string text,CancellationToken ct)
 {
  AssertWritable(id,mediaPath);
  if(!System.IO.Path.IsPathFullyQualified(mediaPath)||!File.Exists(mediaPath))throw new InvalidOperationException("A local existing music-video file is required");
  var target=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(mediaPath)!,System.IO.Path.GetFileNameWithoutExtension(mediaPath)+".mtv-info.eng.ass");
  var old=Find(id);var hash=Hash(text);var exists=File.Exists(target);
  if(exists&&(old is null||!string.Equals(old.Path,target,StringComparison.OrdinalIgnoreCase)||Hash(await File.ReadAllTextAsync(target,ct))!=old.Hash))throw new InvalidOperationException("Existing or edited subtitle was preserved; ownership check failed");
  if(exists&&old!.Hash==hash)return "unchanged";
  Directory.CreateDirectory(root);
  if(exists){var backup=System.IO.Path.Combine(root,"backups",id.ToString("N")+"-"+old!.Hash+".ass");Directory.CreateDirectory(System.IO.Path.GetDirectoryName(backup)!);if(!File.Exists(backup))await File.WriteAllTextAsync(backup,await File.ReadAllTextAsync(target,ct),ct);}
  var temporary=target+".tmp-"+Guid.NewGuid().ToString("N");
  try{await File.WriteAllTextAsync(temporary,text,new UTF8Encoding(false),ct);if(exists&&(!File.Exists(target)||Hash(await File.ReadAllTextAsync(target,ct))!=old!.Hash))throw new InvalidOperationException("Subtitle changed during generation; preserved for review");File.Move(temporary,target,exists);}
  finally{if(File.Exists(temporary))File.Delete(temporary);}
  lock(entries)entries[id]=new(target,hash);
  var manifest=System.IO.Path.Combine(root,"owned-overlays.json");var next=manifest+".tmp";
  Dictionary<Guid,OwnedOverlay> snapshot;lock(entries)snapshot=new(entries);
  await File.WriteAllTextAsync(next,JsonSerializer.Serialize(snapshot),ct);File.Move(next,manifest,true);
  return exists?"updated":"created";
 }
 public void AssertWritable(Guid id,string mediaPath)
 {
  var target=System.IO.Path.ChangeExtension(mediaPath,".mtv-info.eng.ass");var old=Find(id);
  if(File.Exists(target)&&(old is null||!string.Equals(old.Path,target,StringComparison.OrdinalIgnoreCase)||Hash(File.ReadAllText(target))!=old.Hash))throw new InvalidOperationException("Existing or edited subtitle was preserved; ownership check failed");
 }
}
