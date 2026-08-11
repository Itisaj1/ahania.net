(function () {
    function openGallery(track) {
        track.classList.add('show-gallery');
        document.body.classList.add('showing-gallery');
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', '#photography');
        }
    }

    function closeGallery(track) {
        track.classList.remove('show-gallery');
        document.body.classList.remove('showing-gallery');
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

    // Thumbnail widths by distance from the selected item, largest first.
    const THUMB_WIDTHS = [120, 100, 84, 68];
    const THUMB_WIDTHS_NARROW = [92, 78, 66, 54];
    const THUMB_ASPECT = 0.7;

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

    // Stories are hand written, so a missing or malformed file should leave the
    // gallery working rather than break it.
    async function loadStories(storiesPath) {
        if (!storiesPath) {
            return {};
        }

        try {
            const response = await fetch(storiesPath);
            return response.ok ? await response.json() : {};
        } catch (error) {
            return {};
        }
    }

    function initViewer(options) {
        const stage = document.getElementById('gallery-stage');
        const media = document.getElementById('gallery-media');
        const story = document.getElementById('gallery-story');
        const strip = document.getElementById('gallery-strip');
        const caption = document.getElementById('gallery-caption');

        if (!stage || !media || !strip) {
            return;
        }

        let items = [];
        let stories = {};
        let currentIndex = 0;

        function show(index) {
            const item = items[index];
            if (!item) {
                return;
            }

            currentIndex = index;
            const path = mediaPath(options.base, item.filename);

            media.innerHTML = item.type === 'video'
                ? `<video src="${path}" controls preload="metadata"></video>`
                : `<img src="${path}" alt="${item.filename}">`;

            if (story) {
                const text = stories[item.filename] || '';
                story.textContent = text;
                story.hidden = !text;
            }

            if (caption) {
                caption.textContent = `${item.filename} — ${index + 1} of ${items.length}`;
            }

            strip.querySelectorAll('.gallery-thumb').forEach((thumb, thumbIndex) => {
                thumb.classList.toggle('is-active', thumbIndex === index);
            });

            sizeThumbs(index);
            centerThumb(index);
        }

        function thumbWidth(index, activeIndex) {
            const widths = window.innerWidth <= 768 ? THUMB_WIDTHS_NARROW : THUMB_WIDTHS;
            const distance = Math.min(widths.length - 1, Math.abs(index - activeIndex));
            return widths[distance];
        }

        function sizeThumbs(activeIndex) {
            Array.prototype.forEach.call(strip.children, (thumb, index) => {
                const width = thumbWidth(index, activeIndex);
                thumb.style.width = `${width}px`;
                thumb.style.height = `${Math.round(width * THUMB_ASPECT)}px`;
            });
        }

        // Measuring the thumbs would read sizes mid-transition, so the target
        // scroll position is summed from the widths instead.
        function centerThumb(activeIndex) {
            const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
            let offset = 0;

            for (let index = 0; index < activeIndex; index += 1) {
                offset += thumbWidth(index, activeIndex) + gap;
            }

            strip.scrollLeft = offset - (strip.clientWidth - thumbWidth(activeIndex, activeIndex)) / 2;
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
            if (!document.body.classList.contains('showing-gallery') || !items.length) {
                return;
            }

            if (event.key === 'ArrowRight') {
                show((currentIndex + 1) % items.length);
            } else if (event.key === 'ArrowLeft') {
                show((currentIndex - 1 + items.length) % items.length);
            }
        });

        window.addEventListener('resize', () => {
            if (!items.length) {
                return;
            }

            sizeThumbs(currentIndex);
            centerThumb(currentIndex);
        });

        return Promise.all([
            loadManifest(options.manifest),
            loadStories(options.stories)
        ]).then(([mediaItems, storyText]) => {
            items = mediaItems;
            stories = storyText;

            if (!items.length) {
                media.innerHTML = '<p>No photos or videos yet.</p>';
                return [];
            }

            renderStrip();

            const firstImage = items.findIndex((item) => item.type === 'image');
            show(firstImage === -1 ? 0 : firstImage);
            return items;
        }).catch(() => {
            media.innerHTML = '<p>Could not load photos.</p>';
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
