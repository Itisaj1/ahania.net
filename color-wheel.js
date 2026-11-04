(function (global) {
    'use strict';

    // Rim chroma at L=0.7. Photo dominants top out near 0.13, so 0.2 covers
    // them and still lets a drag go more saturated. This is not sRGB-safe;
    // the puck is gamut-mapped for display.
    var CHROMA_MAX = 0.2;
    var FIXED_L = 0.7;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function polarFromEvent(wheel, clientX, clientY) {
        var rect = wheel.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        // Usable radius stays inside the hue ring.
        var ring = parseFloat(getComputedStyle(wheel).getPropertyValue('--cw-ring')) || 10;
        var maxR = rect.width / 2 - ring;
        var dx = clientX - cx;
        var dy = clientY - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var clamped = Math.min(dist, maxR);
        var angle = Math.atan2(dy, dx);
        // CSS conic starts at 12 o'clock with no offset, so hue 0 is red at the top.
        var hue = ((angle * 180) / Math.PI + 90 + 360) % 360;
        var chroma = (clamped / maxR) * CHROMA_MAX;
        return { hue: hue, chroma: chroma, x: dx * (clamped / (dist || 1)), y: dy * (clamped / (dist || 1)), maxR: maxR };
    }

    function positionFromPolar(hue, chroma, maxR) {
        var t = clamp(chroma / CHROMA_MAX, 0, 1);
        var angle = ((hue - 90) * Math.PI) / 180;
        var r = t * maxR;
        return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }

    function createColorWheel(root, options) {
        options = options || {};
        var indexUrl = options.indexUrl || 'portfolio%20images/color-index.json';
        var onChange = typeof options.onChange === 'function' ? options.onChange : null;

        root.classList.add('color-wheel');
        root.setAttribute('role', 'slider');
        root.setAttribute('tabindex', '0');
        root.setAttribute('aria-label', 'Color wheel. Arrow keys move the selector. Hue is angle; chroma is distance from center.');
        root.setAttribute('aria-valuemin', '0');
        root.setAttribute('aria-valuemax', '360');
        root.setAttribute('aria-valuenow', '0');
        root.setAttribute('aria-valuetext', 'neutral center');

        root.innerHTML =
            '<div class="color-wheel__disc" aria-hidden="true"></div>' +
            '<div class="color-wheel__ring" aria-hidden="true"></div>' +
            '<div class="color-wheel__crosshair color-wheel__crosshair--h" aria-hidden="true"></div>' +
            '<div class="color-wheel__crosshair color-wheel__crosshair--v" aria-hidden="true"></div>' +
            '<div class="color-wheel__dots" aria-hidden="true"></div>' +
            '<div class="color-wheel__puck" aria-hidden="true"></div>';

        var dotsEl = root.querySelector('.color-wheel__dots');
        var puck = root.querySelector('.color-wheel__puck');

        var state = { hue: 0, chroma: 0 };
        var dragging = false;
        var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function maxRadius() {
            var ring = parseFloat(getComputedStyle(root).getPropertyValue('--cw-ring')) || 10;
            return root.clientWidth / 2 - ring;
        }

        function placePuck(hue, chroma) {
            var pos = positionFromPolar(hue, chroma, maxRadius());
            puck.style.left = 50 + (pos.x / root.clientWidth) * 100 + '%';
            puck.style.top = 50 + (pos.y / root.clientHeight) * 100 + '%';
            // Display the in-gamut chroma. Selection still stores the unmapped value.
            var shown = gamutMapChroma(FIXED_L, chroma, hue);
            puck.style.background = 'oklch(' + FIXED_L + ' ' + shown + ' ' + hue + ')';
        }

        function emit() {
            var detail = { hue: state.hue, chroma: state.chroma, lightness: FIXED_L };
            root.setAttribute('aria-valuenow', String(Math.round(state.hue)));
            if (state.chroma < 0.01) {
                root.setAttribute('aria-valuetext', 'neutral center');
            } else {
                root.setAttribute(
                    'aria-valuetext',
                    'hue ' + Math.round(state.hue) + ' degrees, chroma ' + state.chroma.toFixed(3)
                );
            }
            root.dispatchEvent(new CustomEvent('colorwheel:change', { detail: detail, bubbles: true }));
            if (onChange) {
                onChange(detail);
            }
        }

        function setSelection(hue, chroma, silent) {
            state.hue = ((hue % 360) + 360) % 360;
            state.chroma = clamp(chroma, 0, CHROMA_MAX);
            placePuck(state.hue, state.chroma);
            if (!silent) {
                emit();
            }
        }

        function applyFromPointer(clientX, clientY) {
            var polar = polarFromEvent(root, clientX, clientY);
            setSelection(polar.hue, polar.chroma);
        }

        function onPointerDown(event) {
            if (event.button != null && event.button !== 0) {
                return;
            }
            dragging = true;
            root.classList.add('is-dragging');
            root.setPointerCapture(event.pointerId);
            applyFromPointer(event.clientX, event.clientY);
            event.preventDefault();
        }

        function onPointerMove(event) {
            if (!dragging) {
                return;
            }
            applyFromPointer(event.clientX, event.clientY);
            event.preventDefault();
        }

        function onPointerUp(event) {
            if (!dragging) {
                return;
            }
            dragging = false;
            root.classList.remove('is-dragging');
            try {
                root.releasePointerCapture(event.pointerId);
            } catch (err) {
                /* already released */
            }
        }

        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerup', onPointerUp);
        root.addEventListener('pointercancel', onPointerUp);

        root.addEventListener('keydown', function (event) {
            var stepHue = event.shiftKey ? 8 : 3;
            var stepChroma = event.shiftKey ? 0.02 : 0.008;
            var handled = true;

            if (event.key === 'ArrowLeft') {
                setSelection(state.hue - stepHue, state.chroma);
            } else if (event.key === 'ArrowRight') {
                setSelection(state.hue + stepHue, state.chroma);
            } else if (event.key === 'ArrowUp') {
                setSelection(state.hue, state.chroma + stepChroma);
            } else if (event.key === 'ArrowDown') {
                setSelection(state.hue, Math.max(0, state.chroma - stepChroma));
            } else if (event.key === 'Home') {
                setSelection(0, 0);
            } else {
                handled = false;
            }

            if (handled) {
                event.preventDefault();
            }
        });

        var cachedItems = [];

        function plotDots(items) {
            cachedItems = items || cachedItems;
            dotsEl.innerHTML = '';
            var maxR = maxRadius();
            cachedItems.forEach(function (item) {
                var oklch = (item.dominant && item.dominant.oklch) || [FIXED_L, 0, 0];
                var L = oklch[0];
                var C = oklch[1];
                var h = oklch[2];
                var pos = positionFromPolar(h, C, maxR);
                var dot = document.createElement('span');
                dot.className = 'color-wheel__dot';
                dot.style.left = 50 + (pos.x / root.clientWidth) * 100 + '%';
                dot.style.top = 50 + (pos.y / root.clientHeight) * 100 + '%';
                dot.style.background = (item.dominant && item.dominant.hex) || 'oklch(' + L + ' ' + C + ' ' + h + ')';
                dot.title = item.id || '';
                dotsEl.appendChild(dot);
            });
        }

        function loadIndex() {
            return fetch(indexUrl)
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error('Failed to load color index');
                    }
                    return response.json();
                })
                .then(function (items) {
                    plotDots(items);
                    return items;
                });
        }

        window.addEventListener('resize', function () {
            placePuck(state.hue, state.chroma);
            if (cachedItems.length) {
                plotDots(cachedItems);
            }
        });

        setSelection(0, 0, true);
        placePuck(0, 0);

        return {
            loadIndex: loadIndex,
            setSelection: setSelection,
            getSelection: function () {
                return { hue: state.hue, chroma: state.chroma, lightness: FIXED_L };
            },
            CHROMA_MAX: CHROMA_MAX,
            reducedMotion: reducedMotion,
        };
    }

    function oklchToLinearRgb(L, C, h) {
        var rad = (h * Math.PI) / 180;
        var a = C * Math.cos(rad);
        var b = C * Math.sin(rad);
        var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
        var l = l_ * l_ * l_;
        var m = m_ * m_ * m_;
        var s = s_ * s_ * s_;
        return [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        ];
    }

    function inGamut(L, C, h) {
        var channels = oklchToLinearRgb(L, C, h);
        return channels[0] >= 0 && channels[0] <= 1 && channels[1] >= 0 && channels[1] <= 1 && channels[2] >= 0 && channels[2] <= 1;
    }

    // Largest chroma at or below C that stays inside linear sRGB, at this L and h.
    function gamutMapChroma(L, C, h) {
        if (!(C > 0)) {
            return 0;
        }
        if (inGamut(L, C, h)) {
            return C;
        }
        var lo = 0;
        var hi = C;
        for (var step = 0; step < 20; step += 1) {
            var mid = (lo + hi) / 2;
            if (inGamut(L, mid, h)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    global.ColorWheel = {
        create: createColorWheel,
        CHROMA_MAX: CHROMA_MAX,
        FIXED_L: FIXED_L,
        gamutMapChroma: gamutMapChroma,
    };
})(window);
