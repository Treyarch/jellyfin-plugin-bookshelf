#!/usr/bin/env python3
"""Build and exercise Bookshelf on an isolated Jellyfin 12.3 Docker server.

Requires Python 3, Docker and the .NET 10 SDK. Does not touch an existing server.
Use --keep to retain the local test server and fixtures for browser testing.
"""
import argparse
import json
from pathlib import Path
import secrets
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ID = "9c4e63f1-031b-4f25-988b-4f7d78a8b53e"


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def png(width, height, color):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\0' + bytes(color) * width) * height)) + chunk(b'IEND', b''))


def fixtures(media):
    # Different dimensions expose spread and continuous-scroll layout mistakes.
    with zipfile.ZipFile(media / 'Gapless.cbz', 'w') as archive:
        for i, height in enumerate([900, 2400, 600, 1200, 900], 1):
            archive.writestr(f'{i:03}.png', png(600, height, (40 * i, 90, 160)))
        archive.writestr('ComicInfo.xml', '<ComicInfo><Title>Gapless Fixture</Title><Writer>Test Author</Writer><PageCount>5</PageCount></ComicInfo>')
    with zipfile.ZipFile(media / 'Comment.cbz', 'w') as archive:
        archive.writestr('001.png', png(600, 900, (120, 70, 50)))
        archive.comment = b'{"ComicBookInfo/1.0":{"title":"Comment Fixture"}}'
    with zipfile.ZipFile(media / 'Book.epub', 'w') as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        archive.writestr('OEBPS/content.opf', '''<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB Fixture</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language><dc:identifier id="id">urn:bookshelf:test</dc:identifier><meta name="cover" content="cover"/></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/><itemref idref="chapter2"/></spine></package>''')
        archive.writestr('OEBPS/cover.png', png(600, 900, (40, 110, 80)))
        archive.writestr('OEBPS/chapter2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second chapter</title></head><body><h1>Second chapter</h1><p>Next section.</p></body></html>')
        archive.writestr('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body><h1>Fixture</h1>' + '<p>Continuous reading test.</p>' * 200 + '</body></html>')
    # Public parser fixtures from the upstream libraries; never executed.
    for name, url in {
        'Archive.cbr': 'https://raw.githubusercontent.com/adamhathcock/sharpcompress/c083c6efd843a844b0c8f7878787360e815be781/tests/TestArchives/Archives/Rar.rar',
        'Document.pdf': 'https://raw.githubusercontent.com/mozilla/pdf.js/v3.11.174/test/pdfs/basicapi.pdf',
    }.items():
        with urllib.request.urlopen(url, timeout=30) as response:
            (media / name).write_bytes(response.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep', action='store_true')
    parser.add_argument('--port', type=int, default=18097)
    args = parser.parse_args()
    work = Path(tempfile.mkdtemp(prefix='bookshelf-smoke-'))
    container = f'bookshelf-smoke-{secrets.token_hex(4)}'
    token = None
    started = False
    base = f'http://127.0.0.1:{args.port}'

    def request(path, data=None, method=None, raw=False):
        headers = {'Authorization': 'MediaBrowser Client="Bookshelf Smoke", Device="Test", DeviceId="bookshelf-smoke", Version="1.0"' + (f', Token="{token}"' if token else '')}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
            return body if raw else json.loads(body) if body else None

    try:
        plugin = work / 'config/plugins/Bookshelf'
        plugin.mkdir(parents=True)
        (work / 'cache').mkdir()
        media = work / 'media'
        media.mkdir()
        fixtures(media)
        print(run('dotnet', 'publish', str(ROOT / 'Jellyfin.Plugin.Bookshelf'), '-c', 'Release', '-o', str(work / 'publish'), '--nologo'), flush=True)
        for name in ['Jellyfin.Plugin.Bookshelf.dll', 'SharpCompress.dll']:
            shutil.copy2(work / 'publish' / name, plugin / name)
        run('docker', 'run', '-d', '--name', container, '-p', f'127.0.0.1:{args.port}:8096', '-v', f'{work}/config:/config', '-v', f'{work}/cache:/cache', '-v', f'{media}:/media:ro', 'jellyfin/jellyfin:12.3')
        started = True
        for _ in range(90):
            try:
                info = request('/System/Info/Public')
                if info.get('Version'):
                    break
                time.sleep(1)
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError('Server did not start within 90 seconds')
        assert info['Version'] == '12.3.0', info
        password = secrets.token_urlsafe(24)
        request('/Startup/Configuration', {'ServerName': 'Bookshelf test', 'UICulture': 'en-US', 'MetadataCountryCode': 'US', 'PreferredMetadataLanguage': 'en'})
        request('/Startup/User')  # Initialize the first user before setting credentials.
        request('/Startup/User', {'Name': 'bookshelf-test', 'Password': password})
        request('/Startup/RemoteAccess', {'EnableRemoteAccess': False})
        request('/Startup/Complete', method='POST')
        auth = request('/Users/AuthenticateByName', {'Username': 'bookshelf-test', 'Pw': password})
        token = auth['AccessToken']
        session = work / 'session.json'
        session.write_text(json.dumps({'baseUrl': base, 'token': token, 'userId': auth['User']['Id'], 'container': container}))
        session.chmod(0o600)
        plugins = request('/Plugins')
        bookshelf = next(p for p in plugins if p['Id'].replace('-', '') == PLUGIN_ID.replace('-', ''))
        assert bookshelf['Status'] == 'Active', bookshelf
        config = request(f'/Plugins/{PLUGIN_ID}/Configuration')
        request(f'/Plugins/{PLUGIN_ID}/Configuration', config)
        assert b'ComicVine' in request('/web/ConfigurationPage?name=Bookshelf', raw=True)
        assert b'Bookshelf/Reader/scroll.js?v=14' in request('/web/index.html', raw=True)
        assert request('/Bookshelf/Reader/scroll.js', raw=True)
        assert request('/Bookshelf/Reader/scroll.css', raw=True)
        # Select this fork's image providers and disable remote metadata lookups.
        options = {'Enabled': True, 'EnableRealtimeMonitor': False, 'TypeOptions': [{'Type': 'Book', 'MetadataFetchers': [], 'ImageFetchers': ['Epub Metadata', 'Comic Book Archive Cover Extractor']}]}
        request('/Library/VirtualFolders?name=Books&collectionType=books&paths=%2Fmedia&refreshLibrary=false', {'LibraryOptions': options})
        # Startup completion schedules its own scan; wait before requesting ours.
        for _ in range(60):
            if all(t['State'] != 'Running' for t in request('/ScheduledTasks') if t['Key'] == 'RefreshLibrary'):
                break
            time.sleep(1)
        request('/Library/Refresh', method='POST')
        for _ in range(90):
            items = request('/Items?Recursive=true&IncludeItemTypes=Book&Fields=Path,Overview')['Items']
            if len(items) == 5 and all(i.get('ImageTags', {}).get('Primary') for i in items if not i['Path'].endswith('.pdf')):
                break
            time.sleep(1)
        else:
            raise RuntimeError(f'Library scan did not produce five books and expected covers: {items}')
        names = {i['Name'] for i in items}
        assert {'Gapless Fixture', 'Comment Fixture', 'EPUB Fixture'} <= names, names
        for item in items:
            if item['Path'].endswith('.pdf'):
                continue
            assert request(f'/Items/{item["Id"]}/Images/Primary', raw=True), item
        logs = run('docker', 'logs', container)
        assert 'Loaded plugin: Bookshelf 14.0.0.0' in logs
        assert 'Error creating' not in logs and 'MissingMethodException' not in logs and 'TypeLoadException' not in logs, logs
        print('PASS: Jellyfin 12.3; plugin active; configuration read/write; embedded reader extension; CBZ/CBR/EPUB/PDF scan; CBZ/CBR/EPUB covers; local metadata.', flush=True)
        if args.keep:
            session = work / 'session.json'
            session.write_text(json.dumps({'baseUrl': base, 'token': token, 'userId': auth['User']['Id'], 'container': container, 'items': items}))
            session.chmod(0o600)
            print(f'Test server retained at {base}; private session: {session}', flush=True)
    finally:
        if not args.keep:
            if started:
                run('docker', 'rm', '-f', container)
            # Docker writes root-owned config. Remove it via the same isolated container mount.
            if started:
                run('docker', 'run', '--rm', '--entrypoint', '/bin/sh', '-v', f'{work}:/work', 'jellyfin/jellyfin:12.3', '-c', 'rm -rf /work/config /work/cache')
            shutil.rmtree(work)
        elif started:
            print(f'Container: {container}; files: {work}', flush=True)


if __name__ == '__main__':
    main()
