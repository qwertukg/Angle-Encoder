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

const PARAM_NAMES = [
    "codeLength",
    "layersCount",
    "overlap",
    "widestDetectors",
    "narrowestDetectors",
];

function randomSeed() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
}

// The configuration of both tabs lives in the query string, so a link shares
// it. Each tab has its own keys, prefixed with the tab name (e.g.
// angle.layersCount, position.x), and changes only those, so switching tabs
// keeps the configuration of each.

// Fills the form from the link; values the form would not accept are left at
// their defaults. Returns the seed from the link, or null when there is none.
function loadConfig(form, prefix) {
    const query = new URLSearchParams(location.search);

    for (const name of PARAM_NAMES) {
        const input = form.elements[name];
        const value = query.get(`${prefix}.${name}`);

        if (value !== null) {
            input.value = value;
            if (value.trim() === "" || !input.checkValidity()) {
                input.value = input.defaultValue;
            }
        }
    }

    const key = `${prefix}.seed`;
    const seed = Number(query.get(key));
    const validSeed = query.has(key) && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;

    return validSeed ? seed : null;
}

// The input of a tab (the angle, or x and y) from the link; names that are
// missing or not numbers are left out.
function readInput(prefix, names) {
    const query = new URLSearchParams(location.search);
    const input = {};

    for (const name of names) {
        const value = query.get(`${prefix}.${name}`);

        if (value !== null && value.trim() !== "" && Number.isFinite(Number(value))) {
            input[name] = Number(value);
        }
    }

    return input;
}

let saveTimer = 0;

// Saves the parameters, the seed and the input of the tab to the link. The
// pages keep their code history in a global named `history`, hence
// window.history here.
function saveConfig(form, prefix, seed, input) {
    clearTimeout(saveTimer);

    const query = new URLSearchParams(location.search);

    for (const name of PARAM_NAMES) {
        query.set(`${prefix}.${name}`, form.elements[name].value);
    }
    query.set(`${prefix}.seed`, seed);
    for (const [name, value] of Object.entries(input)) {
        query.set(`${prefix}.${name}`, Number(value.toFixed(2)));
    }

    const search = `?${query}`;
    try {
        window.history.replaceState(null, "", search);
    } catch {
        // Some browsers refuse to change the link of a page opened as a local
        // file; the page works without it.
    }

    // The tabs carry the whole link, with the configuration of both.
    document.querySelectorAll(".tabs a").forEach((tab) => {
        tab.search = search;
    });
}

// Browsers limit how often the link may change, so pointer moves are saved
// only once the pointer rests.
function saveConfigLater(form, prefix, seed, input) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveConfig(form, prefix, seed, input), 500);
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

// For impossible parameters null is returned, so the caller keeps its
// current encoder; with `report` the reason is also shown on the form.
function createFromForm(form, create, report = true) {
    const layersInput = form.elements.layersCount;

    try {
        const created = create(readParams(form));
        layersInput.setCustomValidity("");
        return created;
    } catch (error) {
        if (!(error instanceof RangeError)) {
            throw error;
        }
        if (report) {
            layersInput.setCustomValidity(error.message);
            layersInput.reportValidity();
        }
        return null;
    }
}

// Creates the first encoder from the link. A link whose parameters cannot
// work together falls back to the defaults, without a seed.
function startFromConfig(form, prefix, createEncoder) {
    const seed = loadConfig(form, prefix);

    if (!createEncoder(seed ?? randomSeed(), false)) {
        form.reset();
        createEncoder();
    }
}

function bindForm(form, onSubmit) {
    // A custom validity error blocks submitting, so it is cleared on any edit.
    form.addEventListener("input", () => {
        form.elements.layersCount.setCustomValidity("");
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        onSubmit(randomSeed());
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
