using System.Text.Json;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Mtv;
public sealed record MetadataPatch(Guid LibraryId,Guid RequestId,string ExpectedFingerprint,EnrichmentFacts Facts,string[] Corrections,string Provenance);
public sealed record MetadataSnapshot(Guid ItemId,Guid LibraryId,string Path,EnrichmentFacts Facts,Dictionary<string,string> ProviderIds,bool Locked,string[] LockedFields,string NfoHash,bool NfoValid,string? NfoError,string Fingerprint,AlbumMetadata? LocalAlbum,bool OverlayValid,EnrichmentFacts? NfoFacts);
public sealed record MetadataJournal(string RequestHash,string Fingerprint,string Stage,MetadataSnapshot Before,MetadataPatch Request);

[ApiController]
[Authorize(Policy="RequiresElevation")]
[Route("MtvOverlay/Metadata")]
public sealed class MetadataController(OverlayService overlays):ControllerBase
{
 [HttpGet("Capabilities")] public object Capabilities()=>overlays.MetadataCapabilities();
 [HttpGet("{itemId:guid}")] public ActionResult<MetadataSnapshot> Get(Guid itemId,[FromQuery]Guid libraryId)
 {try{return overlays.Metadata(itemId,libraryId);}catch(InvalidOperationException error){return Conflict(error.Message);}}
 [HttpPost("{itemId:guid}")] public async Task<ActionResult<MetadataSnapshot>> Apply(Guid itemId,MetadataPatch patch,CancellationToken token)
 {try{return await overlays.Enrich(itemId,patch,token);}catch(InvalidOperationException error){return Conflict(error.Message);}}
}

public sealed partial class OverlayService
{
 public object MetadataCapabilities()=>new{Version="0.1.5",MetadataEnrichment=true,Enabled=Configuration.Enabled,LibraryIds=Configuration.LibraryIds,TimingEnabled=Configuration.IntroSeconds>0||Configuration.OutroSeconds>0};
 private MusicVideo Selected(Guid id,Guid root)
 {
  if(!Configuration.Enabled||!Configuration.LibraryIds.Contains(root)||!library.GetVirtualFolders().Any(x=>Guid.Parse(x.ItemId)==root&&x.CollectionType==CollectionTypeOptions.musicvideos))throw new InvalidOperationException("Select an enabled music-video library");
  if(library.GetItemById(id) is not MusicVideo video||!InScope(video)||!library.GetCollectionFolders(video).Any(x=>x.Id==root)||!System.IO.Path.IsPathFullyQualified(video.Path)||!File.Exists(video.Path))throw new InvalidOperationException("Item is not a local music video in the selected library");
  return video;
 }
 private AlbumMetadata? LocalAlbum(MusicVideo video)
 {
  if(string.IsNullOrWhiteSpace(video.Album))return null;
  var matches=library.GetItemList(new InternalItemsQuery{Recursive=true,IncludeItemTypes=[BaseItemKind.MusicAlbum],Name=video.Album,IsVirtualItem=false,Limit=101});
  if(matches.Count>100)return null;
  return OverlayCore.MatchAlbum(video.Album,video.Artists,matches.OfType<MusicAlbum>().Select(x=>new AlbumMetadata(x.Name,x.AlbumArtists.Concat(x.Artists).Distinct().ToArray(),x.ProductionYear,string.Join(", ",x.Studios),x.Id.ToString("N"))));
 }
 public MetadataSnapshot Metadata(Guid id,Guid root)
 {
  var video=Selected(id,root);var nfo=EnrichedNfo.Read(video.Path);var album=LocalAlbum(video);
  var facts=new EnrichmentFacts(string.Join(", ",video.Artists),video.Name,video.Album,EnrichedNfo.AlbumYear(video.Path,video.Album),string.Join(", ",video.Studios),library.GetPeople(video).Where(x=>x.Type==PersonKind.Director).Select(x=>x.Name).ToArray());
  var locked=video.LockedFields.Select(x=>x.ToString()).ToArray();
  var nfoLocked=nfo.Valid&&nfo.Text is not null&&EnrichedNfo.Parse(nfo.Text).Root!.Element("lockdata")?.Value.Trim().Equals("true",StringComparison.OrdinalIgnoreCase)==true;
  var fingerprint=EnrichedNfo.Hash(JsonSerializer.Serialize(new{video.Id,video.Path,facts,video.ProviderIds,video.IsLocked,locked,nfo.Hash,video.RunTimeTicks}));
  EnrichmentFacts? nfoFacts=null;
  if(nfo.Valid&&nfo.Text is not null){var xml=EnrichedNfo.Parse(nfo.Text).Root!;string? One(string tag){var values=xml.Elements(tag).Select(x=>x.Value.Trim()).Where(x=>x.Length>0).Distinct().ToArray();return values.Length==1?values[0]:null;}var year=One("albumyear");nfoFacts=new(One("artist"),One("title"),One("album"),int.TryParse(year,out var y)&&y is >=1000 and <=9999?y:null,One("studio"),xml.Elements("director").Select(x=>x.Value.Trim()).Where(x=>x.Length>0).Distinct().ToArray());}
  return new(id,root,video.Path,facts,new(video.ProviderIds),video.IsLocked||nfoLocked,locked,nfo.Hash,nfo.Valid,nfo.Error,fingerprint,album,Store.Valid(id)&&OwnedStream(video) is not null,nfoFacts);
 }
 public async Task<MetadataSnapshot> Enrich(Guid id,MetadataPatch patch,CancellationToken token)
 {
  lock(gate){if(Status.Running)throw new InvalidOperationException("Overlay generation or enrichment is busy; retry later");Status.Running=true;}
  try{
   if(patch.RequestId==Guid.Empty||patch.Provenance.Length>64000||string.IsNullOrWhiteSpace(patch.Provenance))throw new InvalidOperationException("A request ID and provenance are required");
   if(Configuration.IntroSeconds==0&&Configuration.OutroSeconds==0)throw new InvalidOperationException("Enable overlay timing before enrichment");
   var video=Selected(id,patch.LibraryId);var current=Metadata(id,patch.LibraryId);
   if(video.RunTimeTicks is null or <=0)throw new InvalidOperationException("Media duration is not scanned yet; metadata was preserved");
   Store.AssertWritable(id,video.Path);
   var folder=System.IO.Path.Combine(Plugin.Instance!.DataFolderPath,"metadata-audit");Directory.CreateDirectory(folder);
   var journalPath=System.IO.Path.Combine(folder,patch.RequestId.ToString("N")+".json");
   var requestHash=EnrichedNfo.Hash(JsonSerializer.Serialize(new{id,patch}));
   var journal=File.Exists(journalPath)?JsonSerializer.Deserialize<MetadataJournal>(await File.ReadAllTextAsync(journalPath,token))!:new MetadataJournal(requestHash,patch.ExpectedFingerprint,"planned",current,patch);
   if(journal.RequestHash!=requestHash||journal.Fingerprint!=current.Fingerprint)throw new InvalidOperationException("Metadata changed since observation or an interrupted write; inspect and retry with a new proposal");
   if(journal.Stage=="complete"){if(!current.OverlayValid)throw new InvalidOperationException("Previously generated overlay changed; review required");return current;}
   async Task Save(string stage){journal=journal with{Stage=stage,Fingerprint=Metadata(id,patch.LibraryId).Fingerprint};var temporary=journalPath+".tmp";await File.WriteAllTextAsync(temporary,JsonSerializer.Serialize(journal),token);File.Move(temporary,journalPath,true);}
   var facts=patch.Facts;
   var changes=new (string Field,string Lock,object? Before,object? After)[]{("artist","Artists",current.Facts.Artist,facts.Artist),("title","Name",current.Facts.Title,facts.Title),("album","Album",current.Facts.Album,facts.Album),("albumYear","ProductionYear",current.Facts.AlbumYear,facts.AlbumYear),("recordLabel","Studios",current.Facts.RecordLabel,facts.RecordLabel),("directors","Cast",current.Facts.Directors,facts.Directors)};
   foreach(var (field,locked,before,proposed) in changes){
    if(proposed is null)continue;
    if(current.Locked||current.LockedFields.Contains(locked,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Locked metadata was preserved");
    bool populated=before is string str?!string.IsNullOrWhiteSpace(str):before is string[] array?array.Length>0:before is not null;
    if(populated&&JsonSerializer.Serialize(before)!=JsonSerializer.Serialize(proposed)&&!patch.Corrections.Contains(field))throw new InvalidOperationException("Populated "+field+" requires reviewed correction");
   }
   var nfo=EnrichedNfo.Read(video.Path);var text=EnrichedNfo.Merge(nfo,current.Facts,facts,patch.Corrections.ToHashSet());
   // Refuse foreign/edited tracks before any metadata write.
   if(Store.Find(id) is not null&&!Store.Valid(id))throw new InvalidOperationException("Owned overlay changed; review required");
   await Save(journal.Stage);
   if(journal.Stage=="planned"){
    if(changes.Any(x=>x.After is not null))await EnrichedNfo.Write(nfo,text,System.IO.Path.Combine(folder,"nfo-backups"),id,token);await Save("nfo-saved");
   }
   if(journal.Stage=="nfo-saved"){
    if(facts.Artist is not null)video.Artists=[facts.Artist];if(facts.Title is not null)video.Name=facts.Title;if(facts.Album is not null)video.Album=facts.Album;if(facts.RecordLabel is not null)video.Studios=[facts.RecordLabel];
    if(facts.Directors is not null){var people=library.GetPeople(video).Where(x=>x.Type!=PersonKind.Director).ToList();people.AddRange(facts.Directors.Select(x=>new PersonInfo{Name=x,Type=PersonKind.Director}));library.UpdatePeople(video,people);}
    if(changes.Any(x=>x.After is not null))await video.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit,token);await Save("metadata-saved");
   }
   await Refresh(video,LocalAlbum(video) is {} album?[album]:[],token);
   var after=Metadata(id,patch.LibraryId);
   foreach(var (field,_,_,value) in changes){if(value is null)continue;var actual=field switch{"artist"=>(object?)after.Facts.Artist,"title"=>after.Facts.Title,"album"=>after.Facts.Album,"albumYear"=>after.Facts.AlbumYear,"recordLabel"=>after.Facts.RecordLabel,_=>after.Facts.Directors};if(JsonSerializer.Serialize(actual)!=JsonSerializer.Serialize(value))throw new InvalidOperationException("Metadata read-back failed for "+field);}
   if(!after.OverlayValid||OwnedStream(video) is null)throw new InvalidOperationException("Overlay registration could not be verified");
   await Save("complete");return after;
  }finally{lock(gate)Status.Running=false;}
 }
}
