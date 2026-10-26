/** A bounded set of decoded pages over lightweight, correctly sized page frames. */
export default class PageView {
    constructor({ container, pages, renderPage, onPosition, page = 0, offset = 0 }) {
        this.container = container;
        this.pages = pages;
        this.renderPage = renderPage;
        this.onPosition = onPosition;
        this.page = Math.max(0, Math.min(pages.length - 1, Math.floor(page) || 0));
        this.offset = offset;
        this.destroyed = false;
        this.frames = pages.map(({ width, height }, index) => {
            const element = document.createElement('div');
            element.className = 'bookPage';
            element.setAttribute('data-page', index);
            element.style.aspectRatio = `${width} / ${height}`;
            container.appendChild(element);
            return { element, generation: 0 };
        });
        container.className = 'bookPages bookPages--continuous';
        container.setAttribute('dir', 'ltr');
        this.onScroll = this.onScroll.bind(this);
        this.onResize = this.onResize.bind(this);
        container.addEventListener('scroll', this.onScroll, { passive: true });
        window.addEventListener('resize', this.onResize);
        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const index = Number(entry.target.getAttribute('data-page'));
                if (entry.isIntersecting) this.load(index);
                else this.unload(index);
            }
        }, { root: container, rootMargin: '100% 0px' });
        this.frames.forEach(frame => {
            this.observer.observe(frame.element);
        });
        this.goTo(this.page, offset);
    }

    async load(index) {
        const frame = this.frames[index];
        if (this.destroyed || !frame || frame.loading || frame.result) return;
        frame.loading = true;
        const generation = ++frame.generation;
        frame.abort = new AbortController();
        try {
            const result = await this.renderPage(index, frame.abort.signal);
            if (this.destroyed || generation !== frame.generation) {
                result.dispose?.();
                return;
            }
            frame.result = result;
            frame.element.textContent = '';
            frame.element.appendChild(result.node);
        } catch (error) {
            if (!this.destroyed && generation === frame.generation) {
                frame.element.textContent = 'Unable to load page';
                frame.element.setAttribute('role', 'alert');
                console.error('[PageView] Unable to load page', index, error);
            }
        } finally {
            if (generation === frame.generation) frame.loading = false;
        }
    }

    unload(index) {
        const frame = this.frames[index];
        ++frame.generation;
        frame.abort?.abort();
        frame.loading = false;
        frame.result?.dispose?.();
        frame.result = null;
        frame.element.textContent = '';
    }

    position() {
        if (this.frames.length) {
            const top = this.container.scrollTop;
            // First visible page, including an offset within very tall webtoon images.
            let low = 0;
            let high = this.frames.length - 1;
            while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                if (this.frames[mid].element.offsetTop <= top + 1) low = mid;
                else high = mid - 1;
            }
            this.page = low;
            const element = this.frames[low].element;
            this.offset = Math.max(0, Math.min(0.999, (top - element.offsetTop) / (element.offsetHeight || 1)));
        }
        return { page: this.page, offset: this.offset };
    }

    onScroll() {
        this.position();
        clearTimeout(this.positionTimer);
        this.positionTimer = setTimeout(() => this.onPosition?.(this.position()), 200);
    }

    onResize() {
        const { page, offset } = { page: this.page, offset: this.offset };
        const loaded = this.frames.map((frame, index) => frame.result || frame.loading ? index : -1).filter(index => index >= 0);
        loaded.forEach(index => {
            this.unload(index);
        });
        loaded.forEach(index => {
            this.load(index);
        });
        this.goTo(page, offset);
    }

    goTo(page, offset = 0) {
        this.page = Math.max(0, Math.min(this.pages.length - 1, Math.floor(page) || 0));
        this.offset = Math.max(0, Math.min(0.999, offset));
        const element = this.frames[this.page]?.element;
        if (element) this.container.scrollTop = element.offsetTop + element.offsetHeight * this.offset;
        this.load(this.page);
        this.onPosition?.({ page: this.page, offset: this.offset });
    }

    next() {
        this.goTo(this.page + 1);
    }

    previous() {
        this.goTo(this.page - 1);
    }

    destroy() {
        this.destroyed = true;
        clearTimeout(this.positionTimer);
        this.observer?.disconnect();
        this.container.removeEventListener('scroll', this.onScroll);
        window.removeEventListener('resize', this.onResize);
        this.frames.forEach((_, index) => {
            this.unload(index);
        });
        this.container.textContent = '';
    }
}
