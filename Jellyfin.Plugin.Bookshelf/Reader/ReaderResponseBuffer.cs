using System;
using System.IO;
using System.IO.Pipelines;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http.Features;

namespace Jellyfin.Plugin.Bookshelf.Reader
{
    /// <summary>
    /// Buffers only the web entry response while preserving the normal server middleware pipeline.
    /// </summary>
    internal sealed class ReaderResponseBuffer : IHttpResponseBodyFeature, IDisposable
    {
        private readonly MemoryStream _stream = new MemoryStream();
        private PipeWriter? _writer;

        public Stream Stream => _stream;

        public PipeWriter Writer => _writer ??= PipeWriter.Create(_stream, new StreamPipeWriterOptions(leaveOpen: true));

        public void DisableBuffering()
        {
            // This one small HTML response must be completed before its length can be updated.
        }

        public Task StartAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public async Task SendFileAsync(string path, long offset, long? count, CancellationToken cancellationToken = default)
        {
            using var source = File.OpenRead(path);
            source.Position = offset;
            var remaining = count ?? (source.Length - offset);
            var bytes = new byte[81920];
            while (remaining > 0)
            {
                var read = await source.ReadAsync(bytes.AsMemory(0, (int)Math.Min(remaining, bytes.Length)), cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    break;
                }

                await _stream.WriteAsync(bytes.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                remaining -= read;
            }
        }

        public Task CompleteAsync() => _writer is null ? Task.CompletedTask : _writer.FlushAsync().AsTask();

        public byte[] GetBytes() => _stream.ToArray();

        public void Dispose()
        {
            _writer?.Complete();
            _stream.Dispose();
        }
    }
}
