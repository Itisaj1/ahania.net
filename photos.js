(function () {
    'use strict';

    var FIXED_L = 0.7;
    var CHROMA_MAX = window.ColorWheel ? ColorWheel.CHROMA_MAX : 0.32;
    var SIGMA = 0.09;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function srgbToLinear(c) {
        c = c / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function linearToSrgb(c) {
        c = clamp(c, 0, 1);
        return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }

    function oklchToOklab(L, C, h) {
        var rad = (h * Math.PI) / 180;
        return { L: L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
    }

    function oklabToRgb(L, a, b) {
        var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
        var l = l_ * l_ * l_;
        var m = m_ * m_ * m_;
        var s = s_ * s_ * s_;
        var r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        var bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
        return {
            r: Math.round(linearToSrgb(r) * 255),
            g: Math.round(linearToSrgb(g) * 255),
            b: Math.round(linearToSrgb(bl) * 255),
        };
    }

    function hexToRgb(hex) {
        var h = hex.replace('#', '');
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }

    function rgbToOklab(r, g, b) {
        var lr = srgbToLinear(r);
        var lg = srgbToLinear(g);
        var lb = srgbToLinear(b);
        var l = Math.sqrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
        var m = Math.sqrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
        var s = Math.sqrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
        return {
            L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
        };
    }

    function toHex(r, g, b) {
        function part(n) {
            return clamp(n, 0, 255).toString(16).padStart(2, '0');
        }
        return '#' + part(r) + part(g) + part(b);
    }

    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var h = 0;
        var s = 0;
        var l = (max + min) / 2;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    break;
                case g:
                    h = ((b - r) / d + 2) / 6;
                    break;
                default:
                    h = ((r - g) / d + 4) / 6;
            }
        }
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100),
        };
    }

    // Distance in the a/b plane only — lightness is ignored for sorting.
    function abDistance(a1, b1, a2, b2) {
        var da = a1 - a2;
        var db = b1 - b2;
        return Math.sqrt(da * da + db * db);
    }

    function proximity(dist) {
        return Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA));
    }

    function scorePhoto(photo, selA, selB, selChroma) {
        var palette = photo.palette || [];
        var total = 0;
        for (var i = 0; i < palette.length; i += 1) {
            var entry = palette[i];
            var oklch = entry.oklch || [FIXED_L, 0, 0];
            var lab = oklchToOklab(oklch[0], oklch[1], oklch[2]);
            var dist;
            if (selChroma < 0.01) {
                // Neutral selection: prefer low-chroma colors.
                dist = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
            } else {
                dist = abDistance(selA, selB, lab.a, lab.b);
            }
            total += (entry.weight || 0) * proximity(dist);
        }
        return total;
    }

    function nearestPantone(hex, pantones) {
        var rgb = hexToRgb(hex);
        var lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
        var best = null;
        var bestDist = Infinity;
        for (var i = 0; i < pantones.length; i += 1) {
            var p = pantones[i];
            var d = abDistance(lab.a, lab.b, p.a, p.b) + Math.abs(lab.L - p.L) * 0.35;
            if (d < bestDist) {
                bestDist = d;
                best = p;
            }
        }
        return best;
    }

    function preparePantones(list) {
        return list.map(function (item) {
            var rgb = hexToRgb(item.hex);
            var lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
            return { name: item.name, hex: item.hex, L: lab.L, a: lab.a, b: lab.b };
        });
    }

    function mediaPath(src) {
        if (!src) {
            return '';
        }
        if (src.indexOf('%') !== -1 || src.indexOf('/') !== -1) {
            return src.startsWith('/') ? src : '/' + src;
        }
        return '/portfolio%20images/' + encodeURIComponent(src);
    }

    function init() {
        var wheelRoot = document.getElementById('photos-wheel');
        var grid = document.getElementById('photos-grid');
        var status = document.getElementById('photos-status');
        var hexEl = document.getElementById('swatch-hex');
        var hslEl = document.getElementById('swatch-hsl');
        var pantoneEl = document.getElementById('swatch-pantone');
        var detail = document.getElementById('photos-detail');
        var detailImg = document.getElementById('photos-detail-img');
        var detailStory = document.getElementById('photos-detail-story');
        var detailCaption = document.getElementById('photos-detail-caption');
        var detailClose = document.getElementById('photos-detail-close');

        if (!wheelRoot || !grid) {
            return;
        }

        var photos = [];
        var stories = {};
        var pantones = [];
        var cardById = {};
        var lastFocus = null;
        var reorderTimer = 0;
        var REORDER_DELAY_MS = 380;
        var selection = { hue: 0, chroma: 0 };

        function updateSwatch(sel) {
            var lab = oklchToOklab(FIXED_L, sel.chroma, sel.hue);
            var rgb = oklabToRgb(lab.L, lab.a, lab.b);
            var hex = toHex(rgb.r, rgb.g, rgb.b);
            var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            hexEl.textContent = hex;
            hslEl.textContent = hsl.h + '°, ' + hsl.s + '%, ' + hsl.l + '%';
            if (pantones.length) {
                var match = nearestPantone(hex, pantones);
                pantoneEl.textContent = match ? '≈ Pantone ' + match.name : '—';
            } else {
                pantoneEl.textContent = '—';
            }
        }

        function sortedPhotos(sel) {
            var lab = oklchToOklab(FIXED_L, sel.chroma, sel.hue);
            return photos
                .map(function (photo) {
                    return {
                        photo: photo,
                        score: scorePhoto(photo, lab.a, lab.b, sel.chroma),
                    };
                })
                .sort(function (a, b) {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return a.photo.id.localeCompare(b.photo.id);
                })
                .map(function (row) {
                    return row.photo;
                });
        }

        function flipReorder(ordered) {
            var first = {};
            Object.keys(cardById).forEach(function (id) {
                first[id] = cardById[id].getBoundingClientRect();
            });

            ordered.forEach(function (photo) {
                grid.appendChild(cardById[photo.id]);
            });

            if (reducedMotion) {
                return;
            }

            Object.keys(cardById).forEach(function (id) {
                var el = cardById[id];
                var last = el.getBoundingClientRect();
                var f = first[id];
                if (!f) {
                    return;
                }
                var dx = f.left - last.left;
                var dy = f.top - last.top;
                if (!dx && !dy) {
                    return;
                }
                el.style.transition = 'none';
                el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
                // Force reflow then animate back.
                el.getBoundingClientRect();
                el.style.transition = 'transform 0.55s ease';
                el.style.transform = '';
                el.addEventListener(
                    'transitionend',
                    function cleanup() {
                        el.style.transition = '';
                        el.removeEventListener('transitionend', cleanup);
                    },
                    { once: true }
                );
            });
        }

        function applySelection(sel) {
            selection = sel;
            updateSwatch(sel);
            flipReorder(sortedPhotos(sel));
        }

        function scheduleSelection(sel) {
            selection = sel;
            // Swatch updates immediately; grid waits so dragging stays light.
            updateSwatch(sel);
            if (reorderTimer) {
                clearTimeout(reorderTimer);
            }
            reorderTimer = setTimeout(function () {
                reorderTimer = 0;
                flipReorder(sortedPhotos(selection));
            }, REORDER_DELAY_MS);
        }

        function openDetail(photo) {
            lastFocus = document.activeElement;
            var src = mediaPath(photo.src || photo.id);
            var story = stories[photo.id] || '';
            var alt = story ? story.split('\n')[0] : photo.id;
            detailImg.src = src;
            detailImg.alt = alt;
            detailStory.textContent = story || 'No story written yet.';
            detailCaption.textContent = photo.id;
            detail.hidden = false;
            detailClose.focus();
            document.body.style.overflow = 'hidden';
        }

        function closeDetail() {
            detail.hidden = true;
            detailImg.removeAttribute('src');
            document.body.style.overflow = '';
            if (lastFocus && typeof lastFocus.focus === 'function') {
                lastFocus.focus();
            }
        }

        function buildGrid(items) {
            grid.innerHTML = '';
            cardById = {};
            items.forEach(function (photo) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'photos-grid__item';
                button.dataset.id = photo.id;
                button.setAttribute('aria-label', photo.id);
                var img = document.createElement('img');
                img.loading = 'lazy';
                img.decoding = 'async';
                img.alt = (stories[photo.id] || photo.id).split('\n')[0];
                img.src = mediaPath(photo.src || photo.id);
                button.appendChild(img);
                button.addEventListener('click', function () {
                    openDetail(photo);
                });
                grid.appendChild(button);
                cardById[photo.id] = button;
            });
        }

        // Focus trap while the detail view is open.
        detail.addEventListener('keydown', function (event) {
            if (detail.hidden) {
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDetail();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }
            var focusables = detail.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!focusables.length) {
                return;
            }
            var first = focusables[0];
            var last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        detailClose.addEventListener('click', closeDetail);
        detail.addEventListener('click', function (event) {
            if (event.target === detail) {
                closeDetail();
            }
        });

        var wheel = ColorWheel.create(wheelRoot, {
            indexUrl: '/portfolio%20images/color-index.json',
            onChange: scheduleSelection,
        });

        Promise.all([
            fetch('/portfolio%20images/color-index.json').then(function (r) {
                if (!r.ok) throw new Error('color-index');
                return r.json();
            }),
            fetch('/portfolio%20images/stories.json')
                .then(function (r) {
                    return r.ok ? r.json() : {};
                })
                .catch(function () {
                    return {};
                }),
            fetch('/photos/pantone.json')
                .then(function (r) {
                    if (!r.ok) throw new Error('pantone');
                    return r.json();
                })
                .catch(function () {
                    return [];
                }),
        ])
            .then(function (results) {
                photos = results[0];
                stories = results[1] || {};
                Object.keys(stories).forEach(function (key) {
                    if (key.charAt(0) === '_') {
                        delete stories[key];
                    }
                });
                pantones = preparePantones(results[2] || []);
                return wheel.loadIndex().then(function () {
                    buildGrid(photos);
                    applySelection(wheel.getSelection());
                    status.textContent = photos.length + ' photos · sorted by color match';
                });
            })
            .catch(function (error) {
                console.error(error);
                status.textContent = 'Could not load the photo index.';
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
