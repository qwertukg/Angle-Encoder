const form = document.getElementById("params");
const canvas = document.getElementById("dial");
const history = document.getElementById("history");
const layersList = document.getElementById("layers");
const seedOutput = document.getElementById("seed");
const ctx = canvas.getContext("2d");

// The dial and inactive detectors only change with the encoder, the canvas
// size or the hovered layer, so they are cached on an offscreen canvas.
const staticCanvas = document.createElement("canvas");
const staticCtx = staticCanvas.getContext("2d");

const HISTORY_SIZE = 5;
const LABEL_MARGIN = 56;
const LAYER_GAP = 0.6;

const FONT = "Consolas, ui-monospace, monospace";

const COLORS = {
    dial: "#00ff41",
    tick: "#008f11",
    detector: "#0b2e12",
    hoveredDetector: "#2a9d48",
    activeDetector: "#00ff41",
    ray: "#d4ffd4",
    glow: "rgba(0, 255, 65, 0.8)",
};

let encoder;
let slots;
let slotCount;
let angle = 0;
let pointer = null;
let codes = [];
let hoveredLayer = null;
let staticValid = false;
let frameRequested = false;

function readNumber(name) {
    return Number(form.elements[name].value);
}

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

// Impossible parameters are reported on the form, and the current encoder
// stays as it is.
function createEncoder() {
    const layersInput = form.elements.layersCount;

    try {
        encoder = new Encoder(
            readNumber("codeLength"),
            readNumber("layersCount"),
            readNumber("overlap"),
            readNumber("widestDetectors"),
            readNumber("narrowestDetectors"),
            crypto.getRandomValues(new Uint32Array(1))[0]
        );
    } catch (error) {
        if (!(error instanceof RangeError)) {
            throw error;
        }
        layersInput.setCustomValidity(error.message);
        layersInput.reportValidity();
        return;
    }

    seedOutput.textContent = encoder.seed;
    layoutSlots();
    codes = [];
    history.innerHTML = "";
    hoveredLayer = null;
    staticValid = false;

    renderLayers();
    requestFrame();
}

function renderLayers() {
    layersList.innerHTML = encoder.layers
        .map(
            (layer, l) =>
                `<li data-layer="${l}"><span>${l + 1}</span><span>${layer.length}</span></li>`
        )
        .join("");
}

// Each detector gets a radial slot, measured in track widths from the inner
// edge of the rings: overlapping detectors of one layer are spread over
// separate concentric tracks so that every arc stays visible.
function layoutSlots() {
    let offset = 0;

    slots = encoder.layers.map((layer) => {
        const trackOf = assignTracks(layer);
        const layerSlots = trackOf.map((track) => offset + track + 0.5);

        offset += Math.max(...trackOf) + 1 + LAYER_GAP;
        return layerSlots;
    });
    slotCount = offset - LAYER_GAP;
}

function assignTracks(layer) {
    const trackOf = [];

    layer.forEach((detector, i) => {
        const taken = new Set();

        for (let j = 0; j < i; j++) {
            const diff = Math.abs(detector.center - layer[j].center);
            const distance = Math.min(diff, 360.0 - diff);

            if (distance < (detector.width + layer[j].width) / 2.0 - 1e-9) {
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

function requestFrame() {
    if (!frameRequested) {
        frameRequested = true;
        requestAnimationFrame(frame);
    }
}

// All work happens once per animation frame, however many pointer events
// arrived since the previous one.
function frame() {
    frameRequested = false;

    if (pointer) {
        updateAngle(pointer);
        pointer = null;
    }

    updateHistory();
    draw();
}

function updateAngle({ x, y }) {
    const rect = canvas.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);

    if (dx === 0 && dy === 0) {
        return;
    }

    const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI;
    angle = ((degrees % 360.0) + 360.0) % 360.0;
}

// Only the new row is rendered; the rest stay in the DOM as they are.
function updateHistory() {
    const { codeString, hits } = encoder.encode(angle);

    if (codes.length > 0 && codes[0].codeString === codeString) {
        return;
    }

    codes.unshift({ angle, codeString, hits });
    history.insertAdjacentHTML("afterbegin", renderCode(0));

    if (codes.length > HISTORY_SIZE) {
        codes.pop();
        history.lastElementChild.remove();
        // The oldest row has nothing to compare with any more.
        history.lastElementChild.outerHTML = renderCode(codes.length - 1);
    }
}

// Bits that differ from the previous (older) code are highlighted, and so are
// bits set by more than one detector.
function renderCode(i) {
    const { angle, codeString, hits } = codes[i];
    const previous = codes[i + 1]?.codeString;
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
        `<li><span class="angle">${angle.toFixed(1)}°</span>` +
        `<span class="density">${density.toFixed(1)}%</span>` +
        `<span class="code">${html}</span></li>`
    );
}

function geometry() {
    const size = canvas.clientWidth;
    const center = size / 2;
    const available = center - LABEL_MARGIN;
    const radius = available * 0.55;
    const ringStart = radius + 10;
    const ringEnd = available - 14;

    return {
        size,
        center,
        radius,
        ringStart,
        unit: (ringEnd - ringStart) / slotCount,
        rayEnd: available,
    };
}

function draw() {
    const dpr = window.devicePixelRatio || 1;
    const g = geometry();
    const pixels = Math.round(g.size * dpr);

    if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
        staticCanvas.width = pixels;
        staticCanvas.height = pixels;
        staticValid = false;
    }

    if (!staticValid) {
        staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        staticCtx.clearRect(0, 0, g.size, g.size);
        drawDial(staticCtx, g);
        drawDetectors(staticCtx, g);
        staticValid = true;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixels, pixels);
    ctx.drawImage(staticCanvas, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawActiveDetectors(ctx, g);
    drawRay(ctx, g);
}

function drawDial(c, g) {
    const { center, radius } = g;

    c.strokeStyle = COLORS.dial;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(center, center, radius, 0, Math.PI * 2);
    c.stroke();

    c.strokeStyle = COLORS.tick;
    c.lineWidth = 1;
    c.beginPath();
    for (let degree = 0; degree < 360; degree++) {
        const length = degree % 10 === 0 ? 12 : degree % 5 === 0 ? 8 : 4;
        const cos = Math.cos(toRadians(degree));
        const sin = -Math.sin(toRadians(degree));

        c.moveTo(center + cos * radius, center + sin * radius);
        c.lineTo(center + cos * (radius - length), center + sin * (radius - length));
    }
    c.stroke();

    c.fillStyle = COLORS.dial;
    c.font = `11px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let degree = 0; degree < 360; degree += 30) {
        const r = radius - 26;

        c.fillText(
            `${degree}°`,
            center + Math.cos(toRadians(degree)) * r,
            center - Math.sin(toRadians(degree)) * r
        );
    }

    c.beginPath();
    c.arc(center, center, 3, 0, Math.PI * 2);
    c.fill();
}

// Every detector is drawn here in its inactive colour; active ones are drawn
// over it each frame.
function drawDetectors(c, g) {
    const { center, ringStart, unit } = g;

    c.lineWidth = Math.max(1, unit * 0.75);

    encoder.layers.forEach((layer, l) => {
        c.globalAlpha = layerAlpha(l);
        c.strokeStyle = l === hoveredLayer ? COLORS.hoveredDetector : COLORS.detector;

        layer.forEach((detector, i) => {
            strokeArc(c, center, ringStart + slots[l][i] * unit, detector);
        });
    });

    c.globalAlpha = 1;
}

function drawActiveDetectors(c, g) {
    const { center, ringStart, unit } = g;

    c.lineWidth = Math.max(1, unit * 0.75);
    c.strokeStyle = COLORS.activeDetector;
    c.shadowColor = COLORS.glow;
    c.shadowBlur = 6;

    encoder.layers.forEach((layer, l) => {
        c.globalAlpha = layerAlpha(l);

        layer.forEach((detector, i) => {
            if (encoder.isActive(detector, angle)) {
                strokeArc(c, center, ringStart + slots[l][i] * unit, detector);
            }
        });
    });

    c.shadowBlur = 0;
    c.globalAlpha = 1;
}

// While a layer is hovered in the list, the other layers fade out.
function layerAlpha(l) {
    return hoveredLayer === null || hoveredLayer === l ? 1 : 0.2;
}

// Angles grow counterclockwise from the positive x axis, while canvas angles
// grow clockwise, hence the negation.
function strokeArc(c, center, r, detector) {
    const half = Math.min(detector.width, 359.9) / 2.0;

    c.beginPath();
    c.arc(
        center,
        center,
        r,
        -toRadians(detector.center + half),
        -toRadians(detector.center - half)
    );
    c.stroke();
}

function drawRay(c, g) {
    const { center, rayEnd } = g;
    const cos = Math.cos(toRadians(angle));
    const sin = -Math.sin(toRadians(angle));
    const endX = center + cos * rayEnd;
    const endY = center + sin * rayEnd;

    c.shadowColor = COLORS.glow;
    c.shadowBlur = 8;

    c.strokeStyle = COLORS.ray;
    c.lineWidth = 1.5;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(center, center);
    c.lineTo(endX, endY);
    c.stroke();
    c.setLineDash([]);

    c.fillStyle = COLORS.ray;
    c.font = `700 14px ${FONT}`;
    c.textAlign = cos > 0.3 ? "left" : cos < -0.3 ? "right" : "center";
    c.textBaseline = sin < -0.3 ? "bottom" : sin > 0.3 ? "top" : "middle";
    c.fillText(`${angle.toFixed(1)}°`, endX + cos * 8, endY + sin * 8);

    c.shadowBlur = 0;
}

window.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    requestFrame();
});

// The dial is sized by its container, which also changes with the history.
new ResizeObserver(requestFrame).observe(canvas);

layersList.addEventListener("pointerover", (event) => {
    const item = event.target.closest("li");
    const layer = item ? Number(item.dataset.layer) : null;

    if (item && layer !== hoveredLayer) {
        hoveredLayer = layer;
        staticValid = false;
        requestFrame();
    }
});

layersList.addEventListener("pointerleave", () => {
    hoveredLayer = null;
    staticValid = false;
    requestFrame();
});

// A custom validity error blocks submitting, so it is cleared on any edit.
form.addEventListener("input", () => {
    form.elements.layersCount.setCustomValidity("");
});

form.addEventListener("submit", (event) => {
    event.preventDefault();
    createEncoder();
});

createEncoder();
