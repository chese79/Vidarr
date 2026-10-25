using Jellyfin.Api.Models.MediaInfoDtos;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Mtv;
public sealed class PlaybackFilter(ILibraryManager library,OverlayService overlays,ILogger<PlaybackFilter> logger):IAsyncActionFilter
{
 public async Task OnActionExecutionAsync(ActionExecutingContext context,ActionExecutionDelegate next)
 {
  // Only the normal POST playback negotiation endpoint; all other actions pass through.
  if(context.Controller.GetType().FullName=="Jellyfin.Api.Controllers.MediaInfoController"&&context.HttpContext.Request.Method=="POST"&&
    context.ActionArguments.TryGetValue("itemId",out var value)&&value is Guid id){
   try {
    var dto=context.ActionArguments.Values.OfType<PlaybackInfoDto>().FirstOrDefault();
    var requestedSource=context.ActionArguments.TryGetValue("mediaSourceId",out var sourceValue)?sourceValue as string:null;
    if(string.IsNullOrEmpty(requestedSource))requestedSource=dto?.MediaSourceId;
    var primarySource=string.IsNullOrEmpty(requestedSource)||(Guid.TryParse(requestedSource,out var sourceId)&&sourceId==id);
    var index=primarySource&&library.GetItemById(id) is MusicVideo video?overlays.OwnedStream(video):null;
    if(index is not null){
     // Web omits MediaSourceId; Jellyfin applies a requested index only to an explicit source.
     if(string.IsNullOrEmpty(requestedSource)){
      var primaryId=id.ToString("N");
      if(dto is not null)dto.MediaSourceId=primaryId;
      context.ActionArguments["mediaSourceId"]=primaryId;
     }
     if(dto is not null)dto.SubtitleStreamIndex=index;
     context.ActionArguments["subtitleStreamIndex"]=index;
     logger.LogDebug("Selecting owned MTV stream {StreamIndex} for music video {ItemId}",index,id);
    }
   }catch(Exception error){logger.LogWarning(error,"MTV selection skipped for {ItemId}; normal playback retained",id);}
  }
  await next();
 }
}
