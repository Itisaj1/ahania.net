(function () {
    function openGallery(track) {
        track.classList.add('show-gallery');
        document.body.classList.add('gallery-open');
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', '#photography');
        }
    }

    function closeGallery(track) {
        track.classList.remove('show-gallery');
        document.body.classList.remove('gallery-open');
        if (window.history && window.history.replaceState) {
            const basePath = window.location.pathname + window.location.search;
            window.history.replaceState(null, '', basePath);
        }
    }

    function initPageSlider() {
        const track = document.getElementById('page-track');
        if (!track) {
            return;
        }

        document.querySelectorAll('[data-open-gallery]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                openGallery(track);
            });
        });

        document.querySelectorAll('[data-close-gallery]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                closeGallery(track);
            });
        });

        if (window.location.hash === '#photography') {
            openGallery(track);
        }
    }

    function mediaPath(base, filename) {
        return base + encodeURIComponent(filename);
    }

    async function loadManifest(manifestPath) {
        const response = await fetch(manifestPath);
        if (!response.ok) {
            throw new Error('Failed to load manifest');
        }
        return response.json();
    }

    function initViewer(options) {
        const stage = document.getElementById('gallery-stage');
        const strip = document.getElementById('gallery-strip');
        const caption = document.getElementById('gallery-caption');

        if (!stage || !strip) {
            return;
        }

        let items = [];
        let currentIndex = 0;

        function show(index) {
            const item = items[index];
            if (!item) {
                return;
            }

            currentIndex = index;
            const path = mediaPath(options.base, item.filename);

            stage.innerHTML = item.type === 'video'
                ? `<video src="${path}" controls preload="metadata"></video>`
                : `<img src="${path}" alt="${item.filename}">`;

            if (caption) {
                caption.textContent = `${item.filename} — ${index + 1} of ${items.length}`;
            }

            strip.querySelectorAll('.gallery-thumb').forEach((thumb, thumbIndex) => {
                thumb.classList.toggle('is-active', thumbIndex === index);
            });

            // Scroll the strip directly; scrollIntoView would also scroll the
            // hidden slide container and knock the panels out of alignment.
            const activeThumb = strip.children[index];
            if (activeThumb) {
                const offset = activeThumb.offsetLeft - (strip.clientWidth - activeThumb.clientWidth) / 2;
                strip.scrollLeft = Math.max(0, offset);
            }
        }

        function renderStrip() {
            strip.innerHTML = items.map((item, index) => {
                const path = mediaPath(options.base, item.filename);
                const inner = item.type === 'video'
                    ? '▶'
                    : `<img src="${path}" alt="" loading="lazy">`;
                const videoClass = item.type === 'video' ? ' is-video' : '';

                return `<button class="gallery-thumb${videoClass}" type="button" data-index="${index}" title="${item.filename}">${inner}</button>`;
            }).join('');

            strip.querySelectorAll('.gallery-thumb').forEach((thumb) => {
                thumb.addEventListener('click', () => {
                    show(Number(thumb.dataset.index));
                });
            });
        }

        document.addEventListener('keydown', (event) => {
            if (!document.body.classList.contains('gallery-open') || !items.length) {
                return;
            }

            if (event.key === 'ArrowRight') {
                show((currentIndex + 1) % items.length);
            } else if (event.key === 'ArrowLeft') {
                show((currentIndex - 1 + items.length) % items.length);
            }
        });

        return loadManifest(options.manifest).then((media) => {
            items = media;

            if (!items.length) {
                stage.innerHTML = '<p>No photos or videos yet.</p>';
                return [];
            }

            renderStrip();
            show(0);
            return items;
        }).catch(() => {
            stage.innerHTML = '<p>Could not load photography portfolio.</p>';
            return [];
        });
    }

    function initRandomImage(options) {
        const imageElement = document.getElementById(options.imageId);
        if (!imageElement) {
            return;
        }

        loadManifest(options.manifest).then((media) => {
            const images = media.filter((item) => item.type === 'image');
            if (!images.length) {
                return;
            }

            const randomImage = images[Math.floor(Math.random() * images.length)];
            imageElement.src = mediaPath(options.base, randomImage.filename);
        }).catch(() => {
            /* keep the fallback image already in the markup */
        });
    }

    window.Gallery = {
        initPageSlider,
        initViewer,
        initRandomImage,
    };
})();
