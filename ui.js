// Shared by the angle and the plane pages.

const HISTORY_SIZE = 5;
const LAYER_GAP = 0.6;

const FONT = "Consolas, ui-monospace, monospace";

const COLORS = {
    dial: "#00ff41",
    tick: "#008f11",
    grid: "#06260d",
    detector: "#0b2e12",
    hoveredDetector: "#2a9d48",
    activeDetector: "#00ff41",
    ray: "#d4ffd4",
    glow: "rgba(0, 255, 65, 0.8)",
};

function randomSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
}

function readParams(form) {
    const number = (name) => Number(form.elements[name].value);

    return {
        codeLength: number("codeLength"),
        layersCount: number("layersCount"),
        overlap: number("overlap"),
        widestDetectors: number("widestDetectors"),
        narrowestDetectors: number("narrowestDetectors"),
    };
}

// Impossible parameters are reported on the form and null is returned, so
// the caller keeps its current encoder.
function createFromForm(form, create) {
    const layersInput = form.elements.layersCount;

    try {
        return create(readParams(form));
    } catch (error) {
        if (!(error instanceof RangeError)) {
            throw error;
        }
        layersInput.setCustomValidity(error.message);
        layersInput.reportValidity();
        return null;
    }
}

function bindForm(form, onSubmit) {
    // A custom validity error blocks submitting, so it is cleared on any edit.
    form.addEventListener("input", () => {
        form.elements.layersCount.setCustomValidity("");
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        onSubmit();
    });
}

function renderLayersList(list, counts) {
    list.innerHTML = counts
        .map((count, l) => `<li data-layer="${l}"><span>${l + 1}</span><span>${count}</span></li>`)
        .join("");
}

// onHover gets the index of the hovered layer, or null when the pointer
// leaves the list.
function bindLayerHover(list, onHover) {
    let hovered = null;

    list.addEventListener("pointerover", (event) => {
        const item = event.target.closest("li");
        const layer = item ? Number(item.dataset.layer) : null;

        if (item && layer !== hovered) {
            hovered = layer;
            onHover(layer);
        }
    });

    list.addEventListener("pointerleave", () => {
        hovered = null;
        onHover(null);
    });
}

// Each detector gets a slot, measured in track widths from the inner edge of
// the layers: overlapping detectors of one layer are spread over separate
// tracks so that every detector stays visible. `distance` measures how far
// apart two detector centres are.
function layoutSlots(layers, distance) {
    let offset = 0;

    const slots = layers.map((layer) => {
        const trackOf = assignTracks(layer, distance);
        const layerSlots = trackOf.map((track) => offset + track + 0.5);

        offset += Math.max(...trackOf) + 1 + LAYER_GAP;
        return layerSlots;
    });

    return { slots, slotCount: offset - LAYER_GAP };
}

function assignTracks(layer, distance) {
    const trackOf = [];

    layer.forEach((detector, i) => {
        const taken = new Set();

        for (let j = 0; j < i; j++) {
            const apart = distance(detector.center, layer[j].center);

            if (apart < (detector.width + layer[j].width) / 2.0 - 1e-9) {
                taken.add(trackOf[j]);
            }
        }

        let track = 0;
        while (taken.has(track)) {
            track++;
        }
        trackOf.push(track);
    });

    return trackOf;
}

// One line of the code history. Bits that differ from the previous (older)
// code are highlighted, and so are bits set by more than one detector.
function renderCodeLine(label, code, previous) {
    const { codeString, hits } = code;
    let ones = 0;
    let html = "";

    for (let j = 0; j < codeString.length; j++) {
        const bit = codeString[j];
        const one = bit === "1";
        const diff = previous !== undefined && previous[j] !== bit;
        let classes = "";

        if (one) {
            ones++;
            classes += " one";
        }
        if (hits[j] > 1) {
            classes += " shared";
        }
        if (diff) {
            classes += " diff";
        }

        html += classes ? `<span class="${classes.slice(1)}">${bit}</span>` : bit;
    }

    const density = (ones / codeString.length) * 100;

    return (
        `<div class="line"><span class="value">${label}</span>` +
        `<span class="density">${density.toFixed(1)}%</span>` +
        `<span class="code">${html}</span></div>`
    );
}

// Keeps the last HISTORY_SIZE entries in `entries` and in the list. Only the
// new row is rendered; the rest stay in the DOM as they are. render(i)
// returns the HTML of entry i, compared with entry i + 1.
function pushHistory(list, entries, entry, render) {
    entries.unshift(entry);
    list.insertAdjacentHTML("afterbegin", render(0));

    if (entries.length > HISTORY_SIZE) {
        entries.pop();
        list.lastElementChild.remove();
        // The oldest row has nothing to compare with any more.
        list.lastElementChild.outerHTML = render(entries.length - 1);
    }
}

// Resizes the visible and the cached canvas to the CSS size of the visible
// one; returns true when the cache has to be redrawn.
function fitCanvas(canvas, staticCanvas, size) {
    const dpr = window.devicePixelRatio || 1;
    const pixels = Math.round(size * dpr);

    if (canvas.width === pixels) {
        return false;
    }

    canvas.width = pixels;
    canvas.height = pixels;
    staticCanvas.width = pixels;
    staticCanvas.height = pixels;
    return true;
}
