# Vertical mode in the existing Jellyfin reader

Install Bookshelf through the same plugin installation process as before. There
is no replacement reader, separate library page, APK, or customized web build to
install. Open books normally and use the added **Vertical scrolling** icon in the
existing toolbar. All existing reader icons and paged controls remain in place.

- Comics: the original single/double-page icon keeps its behavior and exits
  vertical mode when used. Toggling vertical mode off returns to the paged layout.
- PDFs: vertical mode places pages continuously; toggling off restores the
  original paged canvas reader.
- EPUBs: vertical mode uses the existing EPUB renderer's continuous manager;
  toggling off restores its original paginated layout, with theme and font size.
- Adjacent page frames have zero margins, padding, borders and gaps. Whitespace
  authored inside images, PDFs or EPUB content remains part of the source.
- Progress goes through the existing reader's reporting and resume behavior.
  Comic/PDF vertical progress includes the offset within a tall page.

## Installation

1. Stop Jellyfin.
2. Replace the old Bookshelf plugin directory with the DLLs in the plugin ZIP.
3. Start Jellyfin, then refresh/reopen the client to load the new script.

The ZIP contains `Jellyfin.Plugin.Bookshelf.dll` and `SharpCompress.dll`. The reader
extension is embedded in the first DLL. No additional runtime dependencies or
changes to the web installation directory are needed. Removing the plugin also
removes the extension after refreshing the client.

## How delivery works

The plugin adds a small script/stylesheet to the server's web entry response in
memory. It extends the existing reader classes when Jellyfin loads them, adds one
icon beside the existing controls, and uses the original reader for all paged
behavior. Jellyfin web files on disk are not modified.

Jellyfin does not offer a public reader-mode extension API. This adapter therefore
targets the existing Webpack exports and reader methods in **Jellyfin 12.3**. It
must be checked when Jellyfin web changes; this is not a compatibility guarantee
for future web releases. Web hosting disabled in server configuration is respected.
Configured base URLs are preserved.

## Clients

- Server-hosted Jellyfin web: validated on the stock 12.3 Docker image.
- Official Android mobile app: expected to receive the extension because it loads
  the server's web interface. An Android device/emulator has not been tested.
- Independently hosted/bundled web clients and native third-party readers do not
  automatically receive the server's added script.

## Development

`Reader/src/` contains the small extension, and `npm run build --prefix Reader`
updates the embedded `scroll.js` and `scroll.css`. Node is needed only when changing
that extension. The server API exposes only those two static assets; book access
and progress remain handled by Jellyfin's existing authorized APIs.

## Validation

The server unit suite checks entry-response injection, asset serving, configured
base URLs, disabled web hosting, and unchanged web files on disk. JavaScript tests
check original controls/icons, original paged behavior, vertical-mode cleanup,
fractional progress, navigation, and the lazy-module hook's push chain.

Browser checks use stock Jellyfin web, the normal book-opening flow and the
original toolbar. No standalone reader or custom web files are used.

Verified on stock 12.3 web: comic and PDF page boundaries measured 0 pixels;
vertical → original double-page control → vertical retained the same comic scroll
offset; EPUB toggled between its existing paginated view and continuous flow with
its original toolbar. The JavaScript suite has 7 passing tests; the server suite
has 78. Android hardware, Safari and coexistence with other HTML-injection plugins
have not been tested.
