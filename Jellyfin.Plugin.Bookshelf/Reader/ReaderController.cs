using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Bookshelf.Reader
{
    /// <summary>
    /// Serves the small extension to Jellyfin's existing reader.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("Bookshelf/Reader")]
    public class ReaderController : ControllerBase
    {
        /// <summary>
        /// Gets an embedded vertical-mode asset.
        /// </summary>
        /// <param name="asset">The script or stylesheet name.</param>
        /// <returns>The asset, or not found.</returns>
        [HttpGet("{asset}")]
        public ActionResult GetAsset(string asset)
        {
            if (asset != "scroll.js" && asset != "scroll.css")
            {
                return NotFound();
            }

            var resource = typeof(ReaderController).Assembly.GetManifestResourceStream("Jellyfin.Plugin.Bookshelf.Reader." + asset);
            return resource is null ? NotFound() : File(resource, asset == "scroll.js" ? "application/javascript" : "text/css");
        }
    }
}
