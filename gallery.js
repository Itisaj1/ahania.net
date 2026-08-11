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

    async function loadGallery(manifestPath) {
        const gallery = document.getElementById('gallery');
        if (!gallery) {
            return [];
        }

        try {
            const response = await fetch(manifestPath);
            if (!response.ok) {
                throw new Error('Failed to load image manifest');
            }

            const images = await response.json();
            gallery.innerHTML = images.map((image) => (
                `<img src="${image.path}" alt="photo taken by yours truly" loading="lazy">`
            )).join('');

            return images;
        } catch (error) {
            gallery.innerHTML = '<p>Could not load photography gallery.</p>';
            return [];
        }
    }

    function pickRandomImage(images) {
        if (!images.length) {
            return null;
        }

        const randomIndex = Math.floor(Math.random() * images.length);
        return images[randomIndex];
    }

    function initRandomImage(manifestPath, imageId) {
        const imageElement = document.getElementById(imageId);
        if (!imageElement) {
            return;
        }

        loadGallery(manifestPath).then((images) => {
            const randomImage = pickRandomImage(images);
            if (randomImage) {
                imageElement.src = randomImage.path;
            }
        });
    }

    window.Gallery = {
        initPageSlider,
        loadGallery,
        initRandomImage,
    };
})();
