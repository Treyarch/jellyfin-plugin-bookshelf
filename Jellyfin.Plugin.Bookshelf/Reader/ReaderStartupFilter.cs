using System;
using System.Net;
using System.Text;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Extensions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Configuration;

namespace Jellyfin.Plugin.Bookshelf.Reader
{
    /// <summary>
    /// Loads the reader extension with the server-hosted web client, without changing files on disk.
    /// </summary>
    public class ReaderStartupFilter : IStartupFilter
    {
        private readonly IServerConfigurationManager _configuration;
        private readonly IConfiguration _appConfiguration;

        /// <summary>
        /// Initializes a new instance of the <see cref="ReaderStartupFilter"/> class.
        /// </summary>
        /// <param name="configuration">The server configuration.</param>
        /// <param name="appConfiguration">The application configuration.</param>
        public ReaderStartupFilter(IServerConfigurationManager configuration, IConfiguration appConfiguration)
        {
            _configuration = configuration;
            _appConfiguration = appConfiguration;
        }

        /// <inheritdoc />
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
        {
            return app =>
            {
                app.Use(async (context, nextMiddleware) =>
                {
                    var path = context.Request.Path.Value ?? string.Empty;
                    var suffix = path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase) ? "/web/index.html" : "/web/";
                    if (!_appConfiguration.HostWebClient()
                        || (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
                        || !path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                    {
                        await nextMiddleware(context).ConfigureAwait(false);
                        return;
                    }

                    var baseUrl = _configuration.GetNetworkConfiguration().BaseUrl.TrimEnd('/');
                    var prefix = path[..^suffix.Length];
                    if (!string.Equals(prefix, baseUrl, StringComparison.OrdinalIgnoreCase))
                    {
                        await nextMiddleware(context).ConfigureAwait(false);
                        return;
                    }

                    var originalBody = context.Features.Get<IHttpResponseBodyFeature>();
                    if (originalBody is null || !HttpMethods.IsGet(context.Request.Method) || context.Request.Headers.ContainsKey("Range"))
                    {
                        await nextMiddleware(context).ConfigureAwait(false);
                        return;
                    }

                    // Let Jellyfin handle redirects, access rules, and static files as usual.
                    // Keep this small HTML response uncompressed while adding the script.
                    var acceptEncoding = context.Request.Headers.AcceptEncoding;
                    var ifNoneMatch = context.Request.Headers.IfNoneMatch;
                    var ifModifiedSince = context.Request.Headers.IfModifiedSince;
                    context.Request.Headers.Remove("Accept-Encoding");
                    context.Request.Headers.Remove("If-None-Match");
                    context.Request.Headers.Remove("If-Modified-Since");
                    using var buffer = new ReaderResponseBuffer();
                    context.Features.Set<IHttpResponseBodyFeature>(buffer);
                    try
                    {
                        await nextMiddleware(context).ConfigureAwait(false);
                        await buffer.CompleteAsync().ConfigureAwait(false);
                    }
                    finally
                    {
                        context.Features.Set(originalBody);
                        context.Request.Headers.AcceptEncoding = acceptEncoding;
                        context.Request.Headers.IfNoneMatch = ifNoneMatch;
                        context.Request.Headers.IfModifiedSince = ifModifiedSince;
                    }

                    var bytes = buffer.GetBytes();
                    if (context.Response.StatusCode == StatusCodes.Status200OK
                        && context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true
                        && string.IsNullOrEmpty(context.Response.Headers.ContentEncoding.ToString()))
                    {
                        var html = Encoding.UTF8.GetString(bytes);
                        var insertion = html.IndexOf("<script", StringComparison.OrdinalIgnoreCase);
                        if (insertion >= 0)
                        {
                            var url = WebUtility.HtmlEncode(prefix + "/Bookshelf/Reader/");
                            var extension = $"<link rel=\"stylesheet\" href=\"{url}scroll.css?v=14\"><script src=\"{url}scroll.js?v=14\"></script>";
                            bytes = Encoding.UTF8.GetBytes(html.Insert(insertion, extension));
                            context.Response.Headers.Remove("ETag");
                            context.Response.Headers.Remove("Last-Modified");
                            context.Response.Headers.CacheControl = "no-cache";
                        }
                    }

                    context.Response.ContentLength = bytes.Length;
                    await originalBody.Stream.WriteAsync(bytes, context.RequestAborted).ConfigureAwait(false);
                });
                next(app);
            };
        }
    }
}
