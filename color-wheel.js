(function (global) {
    'use strict';

    // Max OKLCH chroma treated as the wheel rim (sRGB-safe).
    var CHROMA_MAX = 0.32;
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
        // CSS conic starts at top (-90deg); match that so red sits at 12 o'clock.
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
            // Selector doubles as the live color swatch.
            puck.style.background = 'oklch(' + FIXED_L + ' ' + chroma + ' ' + hue + ')';
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

    global.ColorWheel = { create: createColorWheel, CHROMA_MAX: CHROMA_MAX, FIXED_L: FIXED_L };
})(window);
