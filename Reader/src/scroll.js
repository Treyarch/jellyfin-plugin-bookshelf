import PageView from './PageView.js';

const patched = Symbol.for('Bookshelf.verticalMode.patched');
const states = new WeakMap();

function progress(player) {
    // Use the existing reader's progress listeners and server reporting.
    for (const callback of [...(player._callbacks?.pause || [])]) callback.call(player, { type: 'pause' });
}

function dispose(state) {
    ++state.generation;
    state.abort?.abort();
    state.observer?.disconnect();
    state.view?.destroy();
    state.root?.remove();
    state.button?.remove();
    state.active = false;
}

function setChoice(player, state, enabled) {
    if (!state.kind) player.comicsPlayerSettings.verticalScrolling = enabled;
    else {
        state.settings.verticalScrolling = enabled;
        try { localStorage.setItem(state.key, String(enabled)); } catch { /* Reader still works if storage is disabled. */ }
    }
}

function stopScrolling(player, state) {
    if (state.kind === 'epub') return setEpubScrolling(player, state, false);
    ++state.generation;
    state.abort?.abort();
    const position = state.view?.position() || state.position;
    state.position = position;
    state.view?.destroy();
    state.view = null;
    state.root?.remove();
    state.root = null;
    state.active = false;
    setChoice(player, state, false);
    if (state.kind === 'pdf') {
        player.mediaElement.querySelector('#container').style.display = state.originalDisplay || '';
        player.progress = position.page;
        player.loadPage(position.page + 1);
        state.button?.setAttribute('aria-pressed', 'false');
        return;
    }
    const swiper = player.swiperInstance;
    if (swiper?.el) {
        swiper.el.style.display = state.originalDisplay || '';
        swiper.enable();
        swiper.update();
        swiper.slideTo(position.page, 0, false);
        if (state.keyboardEnabled) swiper.keyboard?.enable();
    }
    state.position = position;
    player.currentPage = position.page;
    state.button?.setAttribute('aria-pressed', 'false');
}

function dimensions(url, signal) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const finish = () => { image.onload = null; image.onerror = null; image.removeAttribute('src'); signal.removeEventListener('abort', cancel); };
        const cancel = () => { finish(); reject(new Error('Reader closed')); };
        image.onload = () => { const size = { width: image.naturalWidth, height: image.naturalHeight }; finish(); resolve(size); };
        image.onerror = () => { finish(); reject(new Error('Unable to read comic image dimensions')); };
        if (signal.aborted) return cancel();
        signal.addEventListener('abort', cancel, { once: true });
        image.src = url;
    });
}

async function startScrolling(player, state, position) {
    if (state.kind === 'epub') return setEpubScrolling(player, state, true);
    const generation = ++state.generation;
    state.abort?.abort();
    state.abort = new AbortController();
    const { signal } = state.abort;
    if (state.button) state.button.disabled = true;
    try {
        const urls = player.archiveSource?.urls;
        if (!state.sizes) {
            const sizes = [];
            if (state.kind === 'pdf') {
                const book = player.book;
                for (let number = 1; number <= book.numPages; number++) {
                    const page = await book.getPage(number);
                    if (signal.aborted) return;
                    const { width, height } = page.getViewport({ scale: 1 });
                    sizes.push({ width, height });
                }
            } else {
                for (const url of urls) sizes.push(await dimensions(url, signal));
            }
            if (signal.aborted || generation !== state.generation) return;
            state.sizes = sizes;
        }
        if (!player.mediaElement || signal.aborted || generation !== state.generation) return;
        const swiper = player.swiperInstance;
        const currentPage = state.kind === 'pdf' ? player.progress : player.currentPage;
        const spread = player.comicsPlayerSettings?.pagesPerView || 1;
        const remembered = state.position?.page >= currentPage && state.position?.page < currentPage + spread;
        position = position || (remembered ? state.position : { page: currentPage, offset: 0 });
        const pagedElement = state.kind === 'pdf' ? player.mediaElement.querySelector('#container') : swiper.el;
        state.originalDisplay = pagedElement.style.display;
        if (swiper) {
            state.keyboardEnabled = swiper.keyboard?.enabled;
            swiper.keyboard?.disable();
            swiper.disable();
        }
        pagedElement.style.display = 'none';
        const root = state.root = document.createElement('div');
        root.className = 'bookshelf-vertical';
        const container = document.createElement('div');
        container.tabIndex = 0;
        root.appendChild(container);
        const counter = document.createElement('div');
        counter.className = 'swiper-pagination bookshelf-vertical-counter';
        if (!state.kind) root.appendChild(counter);
        player.mediaElement.appendChild(root);
        state.active = true;
        setChoice(player, state, true);
        state.view = new PageView({
            container, pages: state.sizes, page: position.page, offset: position.offset,
            onPosition: current => {
                state.position = current;
                if (state.kind === 'pdf') player.progress = current.page;
                else player.currentPage = current.page;
                counter.textContent = `${current.page + 1} / ${state.sizes.length}`;
                progress(player);
            },
            renderPage: async (index, pageSignal) => {
                if (state.kind === 'pdf') return renderPdf(player, state, index, pageSignal);
                const image = new Image();
                image.alt = `Page ${index + 1}`;
                image.src = urls[index];
                return { node: image, dispose: () => image.removeAttribute('src') };
            }
        });
        container.addEventListener('keydown', event => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); state.view.previous(); }
            if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); state.view.next(); }
        });
        container.focus({ preventScroll: true });
        state.button?.setAttribute('aria-pressed', 'true');
    } catch (error) {
        if (!signal.aborted) {
            console.error('[Bookshelf] Vertical mode could not start', error);
            if (state.active) stopScrolling(player, state);
            if (state.button) state.button.disabled = false;
        }
    } finally {
        if (state.button && generation === state.generation) state.button.disabled = false;
    }
}

function addButton(player, state) {
    const row = player.mediaElement?.querySelectorAll('.bookOsdRow')[1];
    if (!row || state.button) return;
    const template = row.querySelector('button');
    if (!template) return;
    const button = state.button = document.createElement('button');
    button.type = 'button';
    button.className = template.className + ' bookshelf-vertical-button';
    const language = document.documentElement.lang || navigator.language;
    button.title = language.startsWith('fr') ? 'Défilement vertical' : 'Vertical scrolling';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(state.active));
    const icon = document.createElement('span');
    icon.className = 'material-icons view_day';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    button.addEventListener('click', () => {
        if (state.active) stopScrolling(player, state);
        else void startScrolling(player, state);
    });
    const fullscreen = [...row.querySelectorAll('button')].find(node => node.querySelector('.fullscreen, .fullscreen_exit'));
    row.insertBefore(button, fullscreen || null);
    state.observer?.disconnect();
}

/** Extend only the existing comic reader; leave its paged renderer and React controls intact. */
export function patchComicReader(Reader) {
    const proto = Reader?.prototype;
    if (!proto?.getImgFromUrl || !proto.changeView || !proto.onViewChanged || proto[patched]) return;
    proto[patched] = true;
    const original = Object.fromEntries(['setCurrentSrc', 'stop', 'currentTime', 'next', 'previous', 'onViewChanged', 'changeLanguageDirection'].map(name => [name, proto[name]]));
    proto.setCurrentSrc = async function (element, options) {
        const previous = states.get(this);
        if (previous) dispose(previous);
        const value = Math.max(0, Number(options.startPositionTicks) || 0) / 10000;
        const state = { generation: 0, active: false, position: { page: Math.floor(value), offset: value % 1 } };
        states.set(this, state);
        await original.setCurrentSrc.call(this, element, { ...options, startPositionTicks: Math.floor(value) * 10000 });
        if (states.get(this) !== state || !this.mediaElement || !this.swiperInstance || !this.archiveSource.urls.length) return;
        state.observer = new MutationObserver(() => addButton(this, state));
        state.observer.observe(this.mediaElement, { childList: true, subtree: true });
        addButton(this, state);
        this.swiperInstance.on('slideChange', () => {
            if (!state.active) state.position = { page: this.currentPage, offset: 0 };
        });
        if (this.comicsPlayerSettings.verticalScrolling) await startScrolling(this, state, state.position);
    };
    proto.currentTime = function () {
        const state = states.get(this);
        if (state?.active) { const position = state.view?.position() || state.position; return position.page + position.offset; }
        return original.currentTime.call(this);
    };
    for (const name of ['next', 'previous']) proto[name] = function (...args) {
        const state = states.get(this);
        return state?.active ? state.view[name]() : original[name].apply(this, args);
    };
    proto.onViewChanged = function (...args) {
        const state = states.get(this);
        if (!state?.active) return original.onViewChanged.apply(this, args);
        const position = state.view.position();
        stopScrolling(this, state);
        const result = original.onViewChanged.apply(this, args);
        state.position = position;
        return result;
    };
    proto.changeLanguageDirection = function (direction) {
        if (states.get(this)?.active) this.swiperInstance.changeLanguageDirection(direction);
        else return original.changeLanguageDirection.call(this, direction);
    };
    proto.stop = function (...args) {
        const state = states.get(this);
        try { return original.stop.apply(this, args); }
        finally { if (state) dispose(state); states.delete(this); }
    };
}

async function renderPdf(player, state, index, signal) {
    const page = await player.book.getPage(index + 1);
    if (signal.aborted) throw new Error('Page closed');
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(state.root.clientWidth / original.width * (window.devicePixelRatio || 1), Math.sqrt(8000000 / (original.width * original.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    const cancel = () => task.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { await task.promise; }
    catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
    finally { signal.removeEventListener('abort', cancel); }
    return { node: canvas, dispose: () => { canvas.width = 0; canvas.height = 0; } };
}

async function setEpubScrolling(player, state, enabled) {
    const generation = ++state.generation;
    if (state.button) state.button.disabled = true;
    const book = player.rendition.book;
    const location = player.rendition.currentLocation()?.start?.cfi || book.locations.cfiFromPercentage(player.progress || 0);
    player.unbindEvents();
    player.rendition.destroy();
    const container = player.mediaElement.querySelector('#bookPlayerContainer');
    container.classList.toggle('bookshelf-epub-vertical', enabled);
    state.active = enabled;
    const options = enabled ? { manager: 'continuous', flow: 'scrolled-continuous', spread: 'none', gap: 0 } : { flow: 'paginated' };
    const rendition = player.rendition = book.renderTo(container, { width: '100%', height: '100%', ...options });
    player.bindEvents();
    rendition.on('relocated', locations => {
        if (states.get(player) !== state || generation !== state.generation) return;
        player.progress = book.locations.percentageFromCfi(locations.start.cfi);
        progress(player);
    });
    try {
        await rendition.display(location || undefined);
        if (generation !== state.generation || !player.mediaElement) return;
        player.setTheme(player.theme, player.fontSize);
        setChoice(player, state, enabled);
        state.button?.setAttribute('aria-pressed', String(enabled));
    } catch (error) {
        if (generation === state.generation) console.error('[Bookshelf] Unable to change EPUB mode', error);
    } finally {
        if (generation === state.generation && state.button) state.button.disabled = false;
    }
}

/** Add only a vertical toggle to the stock PDF and EPUB readers. */
export function patchBookReader(Reader) {
    const proto = Reader?.prototype;
    const kind = proto?.setTheme && proto?.openTableOfContents ? 'epub' : proto?.renderPage && proto?.loadPage ? 'pdf' : null;
    if (!kind || proto[patched]) return;
    proto[patched] = true;
    const original = Object.fromEntries(['setCurrentSrc', 'stop', 'currentTime', 'next', 'previous', 'addSwipeGestures'].map(name => [name, proto[name]]));
    proto.setCurrentSrc = async function (element, options) {
        const previous = states.get(this);
        if (previous) dispose(previous);
        const value = Math.max(0, Number(options.startPositionTicks) || 0) / 10000;
        const state = { kind, generation: 0, active: false, position: { page: Math.floor(value), offset: value % 1 }, settings: {} };
        states.set(this, state);
        await original.setCurrentSrc.call(this, element, kind === 'pdf' ? { ...options, startPositionTicks: Math.floor(value) * 10000 } : options);
        if (states.get(this) !== state || !this.mediaElement || !this.loaded) return;
        state.key = `bookshelfVertical:${this.item.ServerId}:${this.item.Id}`;
        try { state.settings.verticalScrolling = localStorage.getItem(state.key) === 'true'; } catch { /* Optional preference. */ }
        state.observer = new MutationObserver(() => addButton(this, state));
        state.observer.observe(this.mediaElement, { childList: true, subtree: true });
        addButton(this, state);
        if (state.settings.verticalScrolling) await startScrolling(this, state, state.position);
    };
    proto.currentTime = function () {
        const state = states.get(this);
        if (state?.kind === 'pdf' && state.active) { const position = state.view?.position() || state.position; return position.page + position.offset; }
        return original.currentTime.call(this);
    };
    for (const name of ['next', 'previous']) proto[name] = function (...args) {
        const state = states.get(this);
        if (state?.kind === 'pdf' && state.active) return state.view[name]();
        const result = original[name].apply(this, args);
        if (state?.kind === 'pdf') state.position = { page: this.progress, offset: 0 };
        return result;
    };
    proto.addSwipeGestures = function (...args) {
        if (!states.get(this)?.active) return original.addSwipeGestures.apply(this, args);
    };
    proto.stop = function (...args) {
        const state = states.get(this);
        try { return original.stop.apply(this, args); }
        finally { if (state) dispose(state); states.delete(this); }
    };
}

/** Hook lazy plugin exports before their reader instance is created by Jellyfin. */
export function install(chunkArray) {
    let push = chunkArray.push;
    const wrap = payload => {
        const modules = payload?.[1];
        if (!modules) return;
        for (const id of Object.keys(modules)) {
            const factory = modules[id];
            if (factory[patched] || !['comicsplayer', 'pdfplayer', 'bookplayer'].some(name => factory.toString().includes(name))) continue;
            const replacement = function (...args) {
                const result = factory.apply(this, args);
                for (const value of Object.values(args[0].exports || {})) {
                    if (typeof value === 'function') { patchComicReader(value); patchBookReader(value); }
                }
                return result;
            };
            replacement[patched] = true;
            modules[id] = replacement;
        }
    };
    chunkArray.forEach(wrap);
    // Each getter closes over its current delegate, preserving Webpack's parent-push chain.
    Object.defineProperty(chunkArray, 'push', {
        configurable: true,
        get() { const delegate = push; return function (...payloads) { payloads.forEach(wrap); return delegate.apply(this, payloads); }; },
        set(value) { push = value; }
    });
}

if (typeof window !== 'undefined') install(window.webpackChunk = window.webpackChunk || []);
