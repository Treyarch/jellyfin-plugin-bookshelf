<h1 align="center">Jellyfin Bookshelf Plugin</h1>
<h3 align="center">Part of the <a href="https://jellyfin.org/">Jellyfin Project</a></h3>

<p align="center">

<img alt="Logo Banner" src="https://raw.githubusercontent.com/jellyfin/jellyfin-ux/master/branding/SVG/banner-logo-solid.svg?sanitize=true"/>
<br/>
<br/>
<a href="https://github.com/jellyfin/jellyfin-plugin-bookshelf/actions?query=workflow%3A%22Test+Build+Plugin%22">
<img alt="GitHub Workflow Status" src="https://img.shields.io/github/workflow/status/jellyfin/jellyfin-plugin-bookshelf/Test%20Build%20Plugin.svg">
</a>
<a href="https://github.com/jellyfin/jellyfin-plugin-bookshelf">
<img alt="MIT License" src="https://img.shields.io/github/license/jellyfin/jellyfin-plugin-bookshelf.svg"/>
</a>
<a href="https://github.com/jellyfin/jellyfin-plugin-bookshelf/releases">
<img alt="Current Release" src="https://img.shields.io/github/release/jellyfin/jellyfin-plugin-bookshelf.svg"/>
</a>
</p>

## Compatibility

This fork targets **Jellyfin Server 12.3+ (12.x)** and **.NET 10**. Builds for
Jellyfin 10.11 remain on the original upstream history; this build does not load
on 10.x. Compatibility with newer releases must be verified before use.

Jellyfin 12 moved much of Bookshelf's local metadata support into the server and
split the online providers into separate plugins. This fork retains the existing
Bookshelf providers for users who want them together. Avoid enabling both this
fork and the standalone GoogleBooks/ComicVine plugins. Select the intended local
metadata/image providers in the library settings to avoid duplicate work.

The plugin adds a vertical-scrolling toggle to Jellyfin's existing comic, PDF
and EPUB readers. The reader, existing icons and paged controls remain in place.
No separate web client installation is required.

## About

The Jellyfin Bookshelf plugin enables the collection of eBooks & AudioBooks, with the latter being able to be played through Jellyfin.

### Supported eBook file types

- epub
- mobi
- pdf
- cbz
- cbr

### Supported audio book file types

Please take in mind that this is not a complete list and represents some of the most commonly used formats.

- mp3
- m4a
- m4b
- flac

### Offline Metadata providers

This plugin supports the following offline Metadata providers. These will check the local files for metadata.

- [Open Packaging Format (OPF)](http://idpf.org/epub/20/spec/OPF_2.0.1_draft.htm)
- Calibre OPF
- [ComicInfo](https://github.com/anansi-project/comicinfo)
- [ComicBookInfo](https://code.google.com/archive/p/comicbookinfo/)

The following **limitations** apply:

- .cbr Comics tagged with ComicRacks ComicInfo format are partially supported. Any metadata within the comic book itself will be ignored while external metadata within a ComicInfo.xml file can be read.
- The _[Advanced Comic Book Format](https://launchpad.net/acbf)_ is not supported.
- The _[CoMet](https://www.denvog.com/comet/comet-specification/)_ format is not supported.

### Online Metadata providers

These Metadata providers will check online services for metadata.

- Google Books
- Comic Vine

To use the Comic Vine metadata provider, you will need to set an API key on the plugin's configuration page.

## Build & Installation Process

1. Clone this repository

2. Ensure you have the .NET 10 SDK installed

3. Build the plugin with following command:

```bash
dotnet publish Jellyfin.Plugin.Bookshelf --configuration Release --output bin
```

4. Stop Jellyfin and place `Jellyfin.Plugin.Bookshelf.dll` and `SharpCompress.dll`
   from `bin/` in a dedicated `plugins/Bookshelf/` directory under Jellyfin's data
   directory. Replace the previous Bookshelf directory rather than mixing builds.
   Do not copy Jellyfin's own assemblies from the publish output.
5. Start Jellyfin and check that Bookshelf appears as Active in Dashboard → Plugins.

## Validation

```bash
dotnet test --configuration Release
python3 scripts/smoke-test.py
```

The smoke test requires Docker, Python 3 and the .NET 10 SDK. It creates an isolated
Jellyfin 12.3 server bound to localhost, validates plugin loading and configuration,
scans CBZ, CBR, EPUB and PDF fixtures, checks metadata and available covers, then
removes the test container and files. It downloads parser fixtures from pinned
SharpCompress and PDF.js revisions. `--keep` retains the server for manual testing;
`--port` overrides the default port 18097. The private session file contains a test
access token; do not commit it.

## Vertical reading mode

Install the plugin as above, open a book normally, and use the added **Vertical
scrolling** icon in the existing reader toolbar. The original controls remain
available. Continuous pages have zero layout gaps. See [reader details and client
compatibility](docs/reader.md) and [Jellyfin 12 validation](docs/compatibility.md).

To change the small embedded reader extension during development:

```bash
npm ci --prefix Reader
npm test --prefix Reader
npm run build --prefix Reader
dotnet test --configuration Release
```

The generated script and stylesheet are embedded in the DLL and checked in, so a
normal plugin build/install does not require Node.js.
