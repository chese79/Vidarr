using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Jellyfin.Plugin.Mtv;

public sealed record EnrichmentFacts(
 [property:System.Text.Json.Serialization.JsonPropertyName("artist")]string? Artist=null,
 [property:System.Text.Json.Serialization.JsonPropertyName("title")]string? Title=null,
 [property:System.Text.Json.Serialization.JsonPropertyName("album")]string? Album=null,
 [property:System.Text.Json.Serialization.JsonPropertyName("albumYear")]int? AlbumYear=null,
 [property:System.Text.Json.Serialization.JsonPropertyName("recordLabel")]string? RecordLabel=null,
 [property:System.Text.Json.Serialization.JsonPropertyName("directors")]string[]? Directors=null);
public sealed record NfoState(string Path,string? Text,string Hash,bool Valid,string? Error);

public static class EnrichedNfo
{
 public static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
 public static XDocument Parse(string text)
 {
  if(Encoding.UTF8.GetByteCount(text)>1024*1024)throw new InvalidOperationException("NFO exceeds the metadata size limit");
  using var reader=XmlReader.Create(new StringReader(text),new XmlReaderSettings{DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=1024*1024});
  var document=XDocument.Load(reader,LoadOptions.PreserveWhitespace);
  if(document.Root?.Name.LocalName!="musicvideo"||document.Root.Name.Namespace!=XNamespace.None)throw new InvalidOperationException("NFO is not music-video metadata");
  return document;
 }
 public static NfoState Read(string mediaPath)
 {
  var file=System.IO.Path.ChangeExtension(mediaPath,".nfo");
  try{
   if(!File.Exists(file))return new(file,null,Hash(""),true,null);
   if(new FileInfo(file).Length>1024*1024)throw new InvalidOperationException("NFO exceeds the metadata size limit");
   var text=File.ReadAllText(file);_=Parse(text);return new(file,text,Hash(text),true,null);
  }catch(Exception error)when(error is IOException or UnauthorizedAccessException or XmlException or InvalidOperationException){return new(file,null,"",false,error.Message);}
 }
 public static int? AlbumYear(string mediaPath,string? album)
 {
  try{
   var state=Read(mediaPath);if(!state.Valid||state.Text is null||string.IsNullOrWhiteSpace(album))return null;
   var root=Parse(state.Text).Root!;
   if(!string.Equals(root.Element("album")?.Value.Trim(),album.Trim(),StringComparison.OrdinalIgnoreCase))return null;
   var years=root.Elements("albumyear").Select(x=>int.TryParse(x.Value,out var year)&&year is >=1000 and <=9999?(int?)year:null).Distinct().ToArray();
   return years.Length==1?years[0]:null;
  }catch{return null;}
 }
 public static string Merge(NfoState state,EnrichmentFacts current,EnrichmentFacts patch,IReadOnlySet<string> corrections)
 {
  if(!state.Valid)throw new InvalidOperationException(state.Error??"Invalid NFO was preserved");
  var document=state.Text is null?new XDocument(new XDeclaration("1.0","utf-8","yes"),new XElement("musicvideo")):Parse(state.Text);
  var root=document.Root!;
  if(root.Element("lockdata")?.Value.Trim().Equals("true",StringComparison.OrdinalIgnoreCase)==true&&patch!=new EnrichmentFacts())throw new InvalidOperationException("Locked NFO metadata was preserved");
  var fields=new (string Field,string Tag,string[]? Values)[]{
   ("artist","artist",patch.Artist is null?null:[patch.Artist]),("title","title",patch.Title is null?null:[patch.Title]),
   ("album","album",patch.Album is null?null:[patch.Album]),("albumYear","albumyear",patch.AlbumYear is null?null:[patch.AlbumYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)]),
   ("recordLabel","studio",patch.RecordLabel is null?null:[patch.RecordLabel]),("directors","director",patch.Directors)
  };
  // A newly created NFO also retains the existing identity rather than being a fragment.
  if(state.Text is null){if(!string.IsNullOrWhiteSpace(current.Artist))root.Add(new XElement("artist",current.Artist));if(!string.IsNullOrWhiteSpace(current.Title))root.Add(new XElement("title",current.Title));if(!string.IsNullOrWhiteSpace(current.Album))root.Add(new XElement("album",current.Album));}
  foreach(var (field,tag,values) in fields){
   if(values is null)continue;
   if(values.Any(x=>string.IsNullOrWhiteSpace(x)||x.Length>500)||values.Length==0||values.Length>20)throw new InvalidOperationException("Invalid enrichment value");
   var existing=root.Elements(tag).ToArray();var populated=existing.Select(x=>x.Value.Trim()).Where(x=>x.Length>0).ToArray();
   if(populated.Length>0&&!populated.SequenceEqual(values,StringComparer.OrdinalIgnoreCase)&&!corrections.Contains(field))throw new InvalidOperationException("Existing NFO "+field+" requires reviewed correction");
   foreach(var element in existing)element.Remove();foreach(var value in values)root.Add(new XElement(tag,value));
  }
  if(patch.AlbumYear is not null){
   var album=patch.Album??current.Album;
   if(patch.AlbumYear is <1000 or >9999||string.IsNullOrWhiteSpace(album))throw new InvalidOperationException("Album year requires a known album");
   var nfoAlbums=root.Elements("album").Where(x=>!string.IsNullOrWhiteSpace(x.Value)).ToArray();
   if(nfoAlbums.Any(x=>!string.Equals(x.Value.Trim(),album.Trim(),StringComparison.OrdinalIgnoreCase)))throw new InvalidOperationException("NFO album conflicts with the album-year evidence");
   if(nfoAlbums.Length==0){foreach(var empty in root.Elements("album").ToArray())empty.Remove();root.Add(new XElement("album",album));}
  }
  return document.ToString(SaveOptions.DisableFormatting);
 }
 public static async Task Write(NfoState before,string text,string backupRoot,Guid itemId,CancellationToken token)
 {
  if(!before.Valid)throw new InvalidOperationException("Invalid NFO was preserved");
  var current=File.Exists(before.Path)?await File.ReadAllTextAsync(before.Path,token):"";
  if(Hash(current)!=before.Hash)throw new InvalidOperationException("NFO changed after review; preserved for review");
  if(before.Text==text)return;
  Directory.CreateDirectory(backupRoot);
  if(before.Text is not null){var backup=System.IO.Path.Combine(backupRoot,itemId.ToString("N")+"-"+before.Hash+".nfo");if(!File.Exists(backup))File.Copy(before.Path,backup,false);}
  var temporary=before.Path+".tmp-"+Guid.NewGuid().ToString("N");
  try{
   await File.WriteAllTextAsync(temporary,text,new UTF8Encoding(false),token);
   var latest=File.Exists(before.Path)?await File.ReadAllTextAsync(before.Path,token):"";
   if(Hash(latest)!=before.Hash)throw new InvalidOperationException("NFO changed during enrichment; preserved for review");
   File.Move(temporary,before.Path,File.Exists(before.Path));
  }finally{if(File.Exists(temporary))File.Delete(temporary);}
 }
}
