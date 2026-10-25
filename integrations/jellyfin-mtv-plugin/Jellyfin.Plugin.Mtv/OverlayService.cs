using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Persistence;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Mtv;
public sealed class GenerationStatus
{
 public bool Running {get;set;}
 public int Processed {get;set;}
 public int Created {get;set;}
 public int Updated {get;set;}
 public int Unchanged {get;set;}
 public List<string> Errors {get;set;}=[];
}
public sealed class OverlayService(ILibraryManager library,IMediaStreamRepository streams,IHostApplicationLifetime lifetime,ILogger<OverlayService> logger)
{
 private OwnedOverlayStore? store;
 private readonly object gate=new();
 public GenerationStatus Status {get;private set;}=new();
 public GenerationStatus Snapshot(){lock(gate)return new(){Running=Status.Running,Processed=Status.Processed,Created=Status.Created,Updated=Status.Updated,Unchanged=Status.Unchanged,Errors=[..Status.Errors]};}
 public OwnedOverlayStore Store {get{lock(gate)return store??=new OwnedOverlayStore(Plugin.Instance!.DataFolderPath);}}
 private PluginConfiguration Configuration=>Plugin.Instance!.Configuration;
 public object[] Libraries()=>library.GetVirtualFolders().Where(x=>x.CollectionType==CollectionTypeOptions.musicvideos).Select(x=>(object)new{Id=Guid.Parse(x.ItemId).ToString("D"),x.Name}).ToArray();
 public bool InScope(BaseItem item)=>item is MusicVideo&&library.GetCollectionFolders(item).Any(x=>Configuration.LibraryIds.Contains(x.Id));
 public int? OwnedStream(Video video)
 {
  if(!Configuration.Enabled||(Configuration.IntroSeconds==0&&Configuration.OutroSeconds==0)||!InScope(video)||!Store.Valid(video.Id))return null;
  var owned=Store.Find(video.Id)!;
  return video.GetMediaStreams().FirstOrDefault(x=>x.Type==MediaStreamType.Subtitle&&x.IsExternal&&string.Equals(x.Path,owned.Path,StringComparison.OrdinalIgnoreCase))?.Index;
 }
 public bool Start()
 {
  lock(gate){if(Status.Running)return false;Status=new(){Running=true};}
  _=Task.Run(()=>Generate(lifetime.ApplicationStopping));return true;
 }
 private async Task Generate(CancellationToken token)
 {
  try {
   var allowed=library.GetVirtualFolders().Where(x=>x.CollectionType==CollectionTypeOptions.musicvideos).Select(x=>Guid.Parse(x.ItemId)).ToHashSet();
   var roots=Configuration.LibraryIds.Distinct().ToArray();
   if(roots.Length==0||roots.Any(x=>!allowed.Contains(x)))throw new InvalidOperationException("Choose only music-video libraries before generation");
   var style=new OverlayStyle(Configuration.IntroSeconds,Configuration.OutroSeconds,Configuration.FontSize);
   var seen=new HashSet<Guid>();
   foreach(var root in roots)for(var offset=0;;offset+=100){
    token.ThrowIfCancellationRequested();
    var batch=library.GetItemList(new InternalItemsQuery{ParentId=root,Recursive=true,IncludeItemTypes=[BaseItemKind.MusicVideo],IsVirtualItem=false,StartIndex=offset,Limit=100});
    if(batch.Count==0)break;
    foreach(var item in batch){
     if(item is not MusicVideo video||!seen.Add(item.Id))continue;
     try {
      if(video.RunTimeTicks is null or <=0)throw new InvalidOperationException("Media duration is not scanned yet");
      var directors=string.Join(", ",library.GetPeople(video).Where(x=>x.Type==PersonKind.Director).Select(x=>x.Name));
      var text=OverlayCore.Render(new(string.Join(", ",video.Artists),video.Name,video.Album??"",video.ProductionYear,directors),video.RunTimeTicks.Value/10000000d,style);
      var result=await Store.Write(video.Id,video.Path,text,token);
      // Register only the owned subtitle through Jellyfin's public stream repository. A full
      // metadata refresh reprobes every video and can contact remote providers for hours.
      if(!Store.Valid(video.Id))throw new InvalidOperationException("Generated subtitle ownership could not be verified");
      var owned=Store.Find(video.Id)!;
      var current=video.GetMediaStreams().ToList();
      var matching=current.Where(x=>string.Equals(x.Path,owned.Path,StringComparison.OrdinalIgnoreCase)).ToArray();
      if(matching.Length>1||matching.Any(x=>!x.IsExternal||x.Type!=MediaStreamType.Subtitle||x.Codec!="ass"))throw new InvalidOperationException("Existing owned stream metadata requires review");
      if(matching.Length==0){
       current.Add(new(){Index=OverlayCore.NextStreamIndex(current.Select(x=>x.Index)),Type=MediaStreamType.Subtitle,Codec="ass",Language="eng",Title="MTV Music Video Info",IsExternal=true,Path=owned.Path});
       streams.SaveMediaStreams(video.Id,current,token);
      }
      lock(gate){if(result=="created")Status.Created++;else if(result=="updated")Status.Updated++;else Status.Unchanged++;}
     }catch(OperationCanceledException){throw;}
     catch(Exception error){logger.LogWarning(error,"MTV overlay generation failed for {ItemId}",video.Id);lock(gate)if(Status.Errors.Count<50)Status.Errors.Add(video.Name+": "+error.Message);}
     finally{lock(gate)Status.Processed++;}
    }
    if(batch.Count<100)break;
   }
  }catch(Exception error){logger.LogWarning(error,"MTV overlay generation stopped");lock(gate)if(Status.Errors.Count<50)Status.Errors.Add(error.Message);}
  finally{lock(gate)Status.Running=false;}
 }
}
