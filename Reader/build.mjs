import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = new URL('../Jellyfin.Plugin.Bookshelf/Reader/', import.meta.url);
await build({ entryPoints: [fileURLToPath(new URL('./src/scroll.js', import.meta.url))], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: fileURLToPath(new URL('scroll.js', target)) });
await cp(new URL('./src/scroll.css', import.meta.url), new URL('scroll.css', target));
