# Jellyfin 12 compatibility validation

Validated on 2026-10-25 against Jellyfin Server 12.3.0 using the official
`jellyfin/jellyfin:12.3` image (digest
`sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5`).

- .NET SDK 10.0.403; Release build with warnings treated as errors.
- All 78 unit tests passed, including archive comment metadata, asynchronous
  internal ComicInfo reads and cover stream lifetime regression tests.
- Isolated server startup loaded Bookshelf 14.0.0.0 with Active status.
- Plugin configuration page loaded; configuration read and write succeeded.
- Library scan indexed CBZ (ComicInfo and ComicBookInfo), CBR, EPUB and PDF.
- ComicInfo, ZIP comment and EPUB titles matched fixture metadata.
- CBZ, CBR and EPUB primary images were present and could be retrieved.
- No plugin construction errors, missing methods or type loading errors in logs.

Reproduce with `dotnet test -c Release` and `python3 scripts/smoke-test.py`.
PDF cover extraction is not provided by this plugin. Online provider behavior is
covered with mocked HTTP responses in the unit suite; live GoogleBooks/ComicVine
service availability was not tested. This validates a fresh server, not migration
of an existing production library or compatibility with every other plugin.

The CBR sample comes from SharpCompress commit
`c083c6efd843a844b0c8f7878787360e815be781`, and the PDF from PDF.js `v3.11.174`.
The script generates its own CBZ/EPUB fixtures.
