import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { install, patchBookReader, patchComicReader } from '../src/scroll.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const navigation = '<button class="paper-icon-button-light"><span class="material-icons navigate_before"></span></button><button class="paper-icon-button-light"><span class="material-icons navigate_next"></span></button><div class="bookOsdSpacer"></div>';
const firstPage = reader => reader.mediaElement.querySelector('.bookshelf-first-page-button');
const lastPage = reader => reader.mediaElement.querySelector('.bookshelf-last-page-button');

function environment() {
    const dom = new JSDOM('<!doctype html><body></body>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.MutationObserver = dom.window.MutationObserver;
    const preferences = new Map();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => preferences.get(key) || null, setItem: (key, value) => preferences.set(key, value) } });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
        offsetTop: { configurable: true, get() { return this.classList.contains('bookPage') ? Number(this.dataset.page) * 1200 : 0; } },
        offsetHeight: { configurable: true, get() { return this.classList.contains('bookPage') ? 1200 : 0; } },
        clientWidth: { configurable: true, get() { return 600; } },
        clientHeight: { configurable: true, get() { return 900; } }
    });
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
    globalThis.Image = function () {
        const image = document.createElement('img');
        Object.defineProperties(image, {
            naturalWidth: { value: 600 }, naturalHeight: { value: 1200 },
            src: { set() { queueMicrotask(() => image.onload?.()); } }
        });
        return image;
    };
    class Reader {
        constructor() {
            this.mediaElement = document.createElement('div');
            this.mediaElement.innerHTML = `<div class="bookOsdRow"></div><div class="bookOsdRow">${navigation}<button><span class="material-icons devices_fold"></span></button><button><span class="material-icons fullscreen"></span></button></div><div class="swiper"></div>`;
            document.body.appendChild(this.mediaElement);
            this.currentPage = 0;
            this.comicsPlayerSettings = { pagesPerView: 1, langDir: 'ltr' };
            this.archiveSource = { urls: ['blob:page0', 'blob:page1'] };
            this.swiperInstance = {
                el: this.mediaElement.querySelector('.swiper'), keyboard: { enabled: true, disable() {}, enable() {} },
                disable() {}, enable() {}, update() {}, slideTo() {}, on() {}, changeLanguageDirection() {}
            };
        }
        setCurrentSrc(element, options) { this.currentPage = options.startPositionTicks / 10000; return Promise.resolve(); }
        stop() { this.savedPosition = this.currentTime(); this.mediaElement.remove(); this.mediaElement = null; }
        currentTime() { return this.currentPage; }
        next() { this.currentPage++; }
        previous() { this.currentPage--; }
        onViewChanged() { this.comicsPlayerSettings.pagesPerView = this.comicsPlayerSettings.pagesPerView === 1 ? 2 : 1; }
        changeView() {}
        changeLanguageDirection() {}
        getImgFromUrl() {}
    }
    patchComicReader(Reader);
    return { dom, Reader };
}

test('keeps the existing icons and paged behavior, adding the reader buttons', async () => {
    const { dom, Reader } = environment();
    const reader = new Reader();
    const icon = reader.mediaElement.querySelector('.devices_fold');
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });
    assert.equal(reader.mediaElement.querySelector('.devices_fold'), icon);
    assert.equal(reader.mediaElement.querySelectorAll('.bookshelf-vertical-button').length, 1);
    assert.ok(firstPage(reader).nextElementSibling.querySelector('.navigate_before'));
    assert.ok(lastPage(reader).previousElementSibling.querySelector('.navigate_next'));
    reader.next();
    assert.equal(reader.currentTime(), 1);
    reader.onViewChanged();
    assert.equal(reader.comicsPlayerSettings.pagesPerView, 2);
    reader.stop();
    dom.window.close();
});

test('comic jumps use source order in paged RTL and return to the top of a vertical page', async () => {
    const { dom, Reader } = environment();
    const reader = new Reader();
    reader.comicsPlayerSettings.langDir = 'rtl';
    const slides = [];
    reader.swiperInstance.slideTo = page => { slides.push(page); };
    const reported = [];
    reader._callbacks = { pause: [() => { reported.push(reader.currentTime()); }] };
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });

    lastPage(reader).click();
    firstPage(reader).click();
    assert.deepEqual(slides, [1, 0]);

    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    await tick();
    const pages = reader.mediaElement.querySelector('.bookPages');
    lastPage(reader).click();
    assert.equal(pages.scrollTop, 1200);
    pages.scrollTop = 1600;
    lastPage(reader).click();
    assert.equal(pages.scrollTop, 1200);
    const lastFrame = pages.lastElementChild;
    Object.defineProperty(lastFrame, 'offsetHeight', { value: 600 });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(lastFrame.style.marginBottom, '300px');
    firstPage(reader).click();
    assert.equal(pages.scrollTop, 0);
    assert.deepEqual(reported.slice(-3), [1, 1, 0]);
    assert.deepEqual(slides, [1, 0]);
    reader.stop();
    dom.window.close();
});

test('vertical mode retains the stock reader and exits through its original layout control', async () => {
    const { dom, Reader } = environment();
    const reader = new Reader();
    const originalSwiper = reader.swiperInstance;
    const icon = reader.mediaElement.querySelector('.devices_fold');
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });
    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    await tick();
    assert.equal(reader.swiperInstance, originalSwiper);
    assert.equal(reader.comicsPlayerSettings.verticalScrolling, true);
    assert.ok(reader.mediaElement.querySelector('.bookshelf-vertical'));
    assert.equal(reader.mediaElement.querySelector('.devices_fold'), icon);
    reader.onViewChanged();
    assert.equal(reader.comicsPlayerSettings.verticalScrolling, false);
    assert.equal(reader.comicsPlayerSettings.pagesPerView, 2);
    assert.equal(reader.mediaElement.querySelector('.bookshelf-vertical'), null);
    reader.stop();
    dom.window.close();
});

test('the existing stop handler sees the fractional vertical position before cleanup', async () => {
    const { dom, Reader } = environment();
    const reader = new Reader();
    reader.comicsPlayerSettings.verticalScrolling = true;
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 15000 });
    const root = reader.mediaElement.querySelector('.bookPages');
    [...root.children].forEach((node, index) => Object.defineProperties(node, { offsetTop: { value: index * 1200 }, offsetHeight: { value: 1200 } }));
    root.scrollTop = 1800;
    assert.equal(reader.currentTime(), 1.5);
    reader.stop();
    assert.equal(reader.savedPosition, 1.5);
    dom.window.close();
});

test('Webpack push wrapping preserves the runtime parent chain without recursion', () => {
    const chunks = [];
    install(chunks);
    const parent = chunks.push.bind(chunks);
    let calls = 0;
    chunks.push = function (payload) { calls++; return parent(payload); };
    chunks.push([[1], {}]);
    assert.equal(calls, 1);
    assert.equal(chunks.length, 1);
});

test('vertical page navigation scrolls the existing view and returning to it keeps the anchor', async () => {
    const { dom, Reader } = environment();
    const reader = new Reader();
    reader.comicsPlayerSettings.verticalScrolling = true;
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });
    let root = reader.mediaElement.querySelector('.bookPages');
    [...root.children].forEach((node, index) => Object.defineProperties(node, { offsetTop: { value: index * 1200 }, offsetHeight: { value: 1200 } }));
    reader.next();
    assert.equal(root.scrollTop, 1200);
    reader.stop();
    dom.window.close();
});

test('PDF jumps report progress in both modes and vertical mode restores the original canvas reader', async () => {
    const { dom } = environment();
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
    class Pdf {
        constructor() {
            this.mediaElement = document.createElement('div');
            this.mediaElement.innerHTML = `<div class="bookOsdRow"></div><div class="bookOsdRow">${navigation}<button><span class="material-icons fullscreen"></span></button></div><div id="container"><canvas id="canvas"></canvas></div>`;
            document.body.appendChild(this.mediaElement);
            this.item = { ServerId: 'server', Id: 'pdf' };
            this.book = { numPages: 2, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale }), render: () => ({ promise: Promise.resolve(), cancel() {} }) }) };
            this.progress = 0;
        }
        setCurrentSrc() { this.loaded = true; return Promise.resolve(); }
        stop() { this.mediaElement.remove(); this.mediaElement = null; }
        currentTime() { return this.progress; }
        next() { this.progress++; }
        previous() { this.progress--; }
        loadPage(number) { this.restored = number; }
        renderPage() {}
        addSwipeGestures() {}
    }
    patchBookReader(Pdf);
    const reader = new Pdf();
    const documentReference = reader.book;
    const canvas = reader.mediaElement.querySelector('#canvas');
    const reported = [];
    reader._callbacks = { pause: [() => { reported.push(reader.currentTime()); }] };
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });
    lastPage(reader).click();
    assert.equal(reader.restored, 2);
    assert.equal(reported.at(-1), 1);
    firstPage(reader).click();
    assert.equal(reader.restored, 1);
    assert.equal(reported.at(-1), 0);
    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    await tick();
    assert.equal(reader.book, documentReference);
    assert.equal(reader.mediaElement.querySelector('#container').style.display, 'none');
    lastPage(reader).click();
    assert.equal(reader.mediaElement.querySelector('.bookPages').scrollTop, 1200);
    assert.equal(reported.at(-1), 1);
    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    assert.equal(reader.mediaElement.querySelector('#canvas'), canvas);
    assert.equal(reader.mediaElement.querySelector('#container').style.display, '');
    assert.equal(reader.restored, 2);
    reader.stop();
    dom.window.close();
});

test('EPUB jumps reach the spine endpoints in both flows and preserve theme and font size', async () => {
    const { dom } = environment();
    class Book {
        constructor() {
            this.mediaElement = document.createElement('div');
            this.mediaElement.innerHTML = `<div class="bookOsdRow"></div><div class="bookOsdRow">${navigation}<button><span class="material-icons text_increase"></span></button></div><div id="bookPlayerContainer"></div>`;
            document.body.appendChild(this.mediaElement);
            this.item = { ServerId: 'server', Id: 'epub' };
            this.theme = 'sepia'; this.fontSize = 'large';
            const book = {
                spine: { first: () => ({ href: 'first.xhtml' }), last: () => ({ href: 'last.xhtml' }) },
                locations: { cfiFromPercentage: () => 'resume', percentageFromCfi: cfi => cfi === 'last-cfi' ? 0.75 : 0 },
                renderTo: (container, options) => {
                    this.options = options;
                    const viewport = { scrollWidth: 1800, scrollHeight: 2400, scrollLeft: 0, scrollTop: 0 };
                    const settings = { axis: options.manager ? 'vertical' : 'horizontal', direction: 'rtl', rtlScrollType: 'negative' };
                    let onRelocated;
                    return {
                        book, manager: { container: viewport, settings }, currentLocation: () => ({ start: { cfi: 'saved-cfi' } }), destroy() {},
                        on(event, callback) { if (event === 'relocated') onRelocated = callback; },
                        display: async target => { this.target = target; },
                        reportLocation: async () => { onRelocated?.({ start: { cfi: viewport.scrollTop ? 'last-cfi' : 'first-cfi' } }); }
                    };
                }
            };
            this.rendition = book.renderTo(null, {});
        }
        setCurrentSrc() { this.loaded = true; return Promise.resolve(); }
        currentTime() { return this.progress * 1000; }
        stop() { this.mediaElement.remove(); this.mediaElement = null; }
        next() {} previous() {} addSwipeGestures() {} openTableOfContents() {} bindEvents() {} unbindEvents() {}
        setTheme(theme, fontSize) { this.appliedTheme = [theme, fontSize]; }
    }
    patchBookReader(Book);
    const reader = new Book();
    const icon = reader.mediaElement.querySelector('.text_increase');
    await reader.setCurrentSrc(reader.mediaElement, { startPositionTicks: 0 });
    lastPage(reader).click();
    await tick();
    assert.equal(reader.target, 'last.xhtml');
    assert.equal(reader.rendition.manager.container.scrollLeft, -1800);
    firstPage(reader).click();
    await tick();
    assert.equal(reader.target, 'first.xhtml');
    assert.equal(reader.rendition.manager.container.scrollLeft, 0);
    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    await tick();
    assert.equal(reader.options.manager, 'continuous');
    assert.equal(reader.options.gap, 0);
    assert.equal(reader.target, 'saved-cfi');
    assert.deepEqual(reader.appliedTheme, ['sepia', 'large']);
    assert.equal(reader.mediaElement.querySelector('.text_increase'), icon);
    lastPage(reader).click();
    await tick();
    assert.equal(reader.target, 'last.xhtml');
    assert.equal(reader.rendition.manager.container.scrollTop, 2400);
    assert.equal(reader.currentTime(), 750);
    firstPage(reader).click();
    await tick();
    assert.equal(reader.target, 'first.xhtml');
    assert.equal(reader.rendition.manager.container.scrollTop, 0);
    assert.equal(reader.currentTime(), 0);
    reader.mediaElement.querySelector('.bookshelf-vertical-button').click();
    await tick();
    assert.equal(reader.options.flow, 'paginated');
    reader.stop();
    dom.window.close();
});
