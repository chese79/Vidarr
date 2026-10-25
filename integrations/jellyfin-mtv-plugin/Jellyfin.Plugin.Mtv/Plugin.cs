using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Mtv;
public sealed class PluginConfiguration:BasePluginConfiguration
{
 public bool Enabled {get;set;}=false;
 public Guid[] LibraryIds {get;set;}=[];
 public double IntroSeconds {get;set;}=6;
 public double OutroSeconds {get;set;}=6;
 public int FontSize {get;set;}=28;
}
public sealed class Plugin:BasePlugin<PluginConfiguration>,IHasWebPages
{
 public static Plugin? Instance {get;private set;}
 public Plugin(IApplicationPaths paths,IXmlSerializer serializer):base(paths,serializer){Instance=this;}
 public override string Name=>"MTV Music Video Info";
 public override string Description=>"Music-video-only timed info tracks and automatic playback selection. Movie/TV subtitle defaults are not changed.";
 public override Guid Id=>Guid.Parse("c9298ca5-50d5-4be6-8771-eae3b2bb8b86");
 public IEnumerable<PluginPageInfo> GetPages()=>[new(){Name="mtv-info",DisplayName=Name,EmbeddedResourcePath="Jellyfin.Plugin.Mtv.Configuration.configPage.html"}];
 public override void UpdateConfiguration(BasePluginConfiguration configuration)
 {
  var c=(PluginConfiguration)configuration;
  _=OverlayCore.Windows(30,new(c.IntroSeconds,c.OutroSeconds,c.FontSize));
  base.UpdateConfiguration(c);
 }
}
public sealed class ServiceRegistrator:IPluginServiceRegistrator
{
 public void RegisterServices(IServiceCollection services,IServerApplicationHost host)
 {
  services.AddSingleton<OverlayService>();services.AddScoped<PlaybackFilter>();
  services.Configure<MvcOptions>(options=>options.Filters.AddService<PlaybackFilter>());
 }
}
