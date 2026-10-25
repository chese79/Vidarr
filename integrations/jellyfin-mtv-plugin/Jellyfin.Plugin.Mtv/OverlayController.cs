using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Mtv;
[ApiController]
[Authorize(Policy="RequiresElevation")]
[Route("MtvOverlay")]
public sealed class OverlayController(OverlayService overlays):ControllerBase
{
 [HttpGet("Libraries")] public object Libraries()=>overlays.Libraries();
 [HttpGet("Status")] public object Status()=>overlays.Snapshot();
 [HttpPost("Generate")] public ActionResult Generate()=>overlays.Start()?Accepted(overlays.Snapshot()):Conflict("Generation is already running");
}
