using System.IO.Compression;
using System.Text;
using Jellyfin.Plugin.Bookshelf.Providers;
using Jellyfin.Plugin.Bookshelf.Providers.ComicBookInfo;
using Jellyfin.Plugin.Bookshelf.Providers.ComicInfo;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.IO;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Jellyfin.Plugin.Bookshelf.Tests;

public sealed class ArchiveProviderTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"bookshelf-{Guid.NewGuid()}.cbz");

    [Fact]
    public async Task ComicBookInfoReadsZipCommentWithCurrentSharpCompress()
    {
        using (var archive = ZipFile.Open(_path, ZipArchiveMode.Create))
        {
            archive.CreateEntry("001.png");
            archive.Comment = "{\"ComicBookInfo/1.0\":{\"title\":\"Archive comment title\"}}";
        }

        var provider = new ComicBookInfoProvider(FileSystem(), NullLogger<ComicBookInfoProvider>.Instance);
        var result = await provider.ReadMetadata(new ItemInfo(new Book { Path = _path }), Substitute.For<IDirectoryService>(), CancellationToken.None);

        Assert.True(result.HasMetadata);
        Assert.Equal("Archive comment title", result.Item.Name);
    }

    [Fact]
    public async Task InternalComicInfoCompletesReadingBeforeDisposingArchive()
    {
        using (var archive = ZipFile.Open(_path, ZipArchiveMode.Create))
        {
            using var writer = new StreamWriter(archive.CreateEntry("ComicInfo.xml").Open(), Encoding.UTF8);
            await writer.WriteAsync("<ComicInfo><Title>Internal title</Title><Summary>" + new string('x', 100000) + "</Summary></ComicInfo>");
        }

        var provider = new InternalComicInfoProvider(FileSystem(), NullLogger<InternalComicInfoProvider>.Instance);
        var result = await provider.ReadMetadata(new ItemInfo(new Book { Path = _path }), Substitute.For<IDirectoryService>(), CancellationToken.None);

        Assert.True(result.HasMetadata);
        Assert.Equal("Internal title", result.Item.Name);
        Assert.Equal(100000, result.Item.Overview.Length);
    }

    [Fact]
    public async Task ComicCoverStreamRemainsReadableAfterArchiveIsDisposed()
    {
        var expected = new byte[] { 1, 2, 3, 4 };
        using (var archive = ZipFile.Open(_path, ZipArchiveMode.Create))
        {
            using var stream = archive.CreateEntry("001.png").Open();
            await stream.WriteAsync(expected);
        }

        var provider = new ComicBookImageProvider(NullLogger<ComicBookImageProvider>.Instance);
        var result = await provider.GetImage(new Book { Path = _path }, ImageType.Primary, CancellationToken.None);

        Assert.True(result.HasImage);
        using var streamResult = result.Stream;
        using var bytes = new MemoryStream();
        await streamResult.CopyToAsync(bytes);
        Assert.Equal(expected, bytes.ToArray());
    }

    private IFileSystem FileSystem()
    {
        var fileSystem = Substitute.For<IFileSystem>();
        fileSystem.GetFileSystemInfo(_path).Returns(new FileSystemMetadata { FullName = _path, Exists = true, IsDirectory = false, Extension = ".cbz" });
        return fileSystem;
    }

    public void Dispose() => File.Delete(_path);
}
