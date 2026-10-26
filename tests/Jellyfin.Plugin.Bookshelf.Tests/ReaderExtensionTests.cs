using System.Text;
using Jellyfin.Plugin.Bookshelf.Reader;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;

namespace Jellyfin.Plugin.Bookshelf.Tests;

public sealed class ReaderExtensionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "bookshelf-web-" + Guid.NewGuid());
    private const string Index = "<html><head><script defer src=\"runtime.js\"></script></head><body>Stock reader</body></html>";

    [Theory]
    [InlineData("", "/web/index.html")]
    [InlineData("/jellyfin", "/jellyfin/web/")]
    public async Task AddsOnlyAssetsToServedHtmlAndDoesNotChangeWebFiles(string baseUrl, string path)
    {
        var pipeline = CreatePipeline(baseUrl, true);
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        await pipeline(context);
        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        var html = await reader.ReadToEndAsync();
        Assert.Contains(baseUrl + "/Bookshelf/Reader/scroll.js?v=14", html);
        Assert.True(html.IndexOf("scroll.js", StringComparison.Ordinal) < html.IndexOf("runtime.js", StringComparison.Ordinal));
        Assert.Contains("Stock reader", html);
        Assert.Equal(Index, await File.ReadAllTextAsync(Path.Combine(_directory, "index.html")));
    }

    [Theory]
    [InlineData("/Items", true)]
    [InlineData("/other/web/index.html", true)]
    [InlineData("/web/index.html", false)]
    public async Task LeavesApiRequestsOtherPrefixesAndDisabledWebHostingAlone(string path, bool enabled)
    {
        var pipeline = CreatePipeline(string.Empty, enabled);
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = path;
        await pipeline(context);
        Assert.Equal(418, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("scroll.js", "application/javascript")]
    [InlineData("scroll.css", "text/css")]
    public void ServesOnlyEmbeddedExtensionAssets(string asset, string contentType)
    {
        var file = Assert.IsType<FileStreamResult>(new ReaderController().GetAsset(asset));
        using var stream = file.FileStream;
        Assert.Equal(contentType, file.ContentType);
        Assert.True(stream.Length > 0);
        Assert.IsType<NotFoundResult>(new ReaderController().GetAsset("../config.xml"));
    }

    [Theory]
    [InlineData(302)]
    [InlineData(403)]
    [InlineData(500)]
    public async Task PreservesRedirectAndErrorResponses(int statusCode)
    {
        var pipeline = CreatePipeline(string.Empty, true, statusCode);
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = "/web/index.html";
        context.Response.Body = new MemoryStream();
        await pipeline(context);
        Assert.Equal(statusCode, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        Assert.Equal(Index, await reader.ReadToEndAsync());
    }

    private RequestDelegate CreatePipeline(string baseUrl, bool enabled, int statusCode = 200)
    {
        Directory.CreateDirectory(_directory);
        File.WriteAllText(Path.Combine(_directory, "index.html"), Index);
        var paths = Substitute.For<IServerApplicationPaths>();
        paths.WebPath.Returns(_directory);
        var configuration = Substitute.For<IServerConfigurationManager>();
        configuration.ApplicationPaths.Returns(paths);
        configuration.GetConfiguration("network").Returns(new NetworkConfiguration { BaseUrl = baseUrl });
        var appConfiguration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["hostwebclient"] = enabled.ToString() }).Build();
        var app = new ApplicationBuilder(new ServiceCollection().BuildServiceProvider());
        new ReaderStartupFilter(configuration, appConfiguration).Configure(builder => builder.Run(async context =>
        {
            if (enabled && (context.Request.Path == baseUrl + "/web/index.html" || context.Request.Path == baseUrl + "/web/"))
            {
                context.Response.StatusCode = statusCode;
                context.Response.ContentType = "text/html";
                context.Response.ContentLength = Encoding.UTF8.GetByteCount(Index);
                await context.Response.SendFileAsync(Path.Combine(_directory, "index.html"));
            }
            else
            {
                context.Response.StatusCode = 418;
            }
        }))(app);
        return app.Build();
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }
}
