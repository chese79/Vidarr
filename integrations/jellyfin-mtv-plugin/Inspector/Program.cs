using System.Reflection;
using System.Runtime.Loader;
var root=args[0];
AssemblyLoadContext.Default.Resolving+=(_,name)=>File.Exists(Path.Combine(root,name.Name+".dll"))?AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(root,name.Name+".dll")):null;
var wanted=new Dictionary<string,string[]> {
 ["MediaBrowser.Common"]=["MediaBrowser.Common.Plugins.BasePlugin`1","MediaBrowser.Common.Plugins.IHasWebPages"],
 ["MediaBrowser.Controller"]=["MediaBrowser.Controller.Entities.MusicVideo","MediaBrowser.Controller.Providers.DirectoryService","MediaBrowser.Controller.Providers.MetadataRefreshOptions"],
 ["Jellyfin.Api"]=["Jellyfin.Api.Controllers.MediaInfoController","Jellyfin.Api.Models.MediaInfoDtos.PlaybackInfoDto"]
};
foreach(var (assembly,names) in wanted)foreach(var name in names){
 var t=Assembly.LoadFrom(Path.Combine(root,assembly+".dll")).GetType(name);Console.WriteLine("TYPE "+name+" "+(t is null?"MISSING":""));if(t is null)continue;
 foreach(var c in t.GetConstructors())Console.WriteLine("CTOR "+c);
 if(t.Name=="MusicVideo")foreach(var p in t.GetProperties().Where(p=>new[]{"Artists","Album","ProductionYear","Path","RunTimeTicks","Id"}.Contains(p.Name)))Console.WriteLine("PROP "+p);
 foreach(var m in t.GetMethods().Where(m=>m.Name.Contains("Playback")||m.Name.Contains("MediaStream")||m.Name.Contains("CollectionFolder")||m.Name.Contains("VirtualFolder")||m.Name.Contains("UpdateConfiguration")||m.Name.Contains("UserDto")||m.Name.Contains("QueueRefresh")||m.Name.Contains("GetItemList")||m.Name.Contains("RegisterServices")))Console.WriteLine("METHOD "+m+" ARGS "+string.Join(",",m.GetParameters().Select(p=>p.Name)));
 if(t.Name.Contains("Query")||t.Name.Contains("PlaybackInfoDto"))foreach(var p in t.GetProperties().Where(p=>new[]{"ParentId","Recursive","IncludeItemTypes","StartIndex","Limit","IsVirtualItem","SubtitleStreamIndex","UserId","MediaSourceId"}.Contains(p.Name)))Console.WriteLine("PROP "+p);
}
