const form = document.getElementById("params");
const canvas = document.getElementById("plane");
const history = document.getElementById("history");
const layersList = document.getElementById("layers");
const seedOutput = document.getElementById("seed");
const ctx = canvas.getContext("2d");

// The square, the rulers and inactive detectors only change with the encoder,
// the canvas size or the hovered layer, so they are cached offscreen.
const staticCanvas = document.createElement("canvas");
const staticCtx = staticCanvas.getContext("2d");

// Coordinates on the square run from 0 to PLANE_SIZE, with the origin in the
// top left corner, where the rulers meet.
const PLANE_SIZE = 100;

// Layout, in CSS pixels, from the top/left edge of the canvas inwards: room
// for the coordinate labels, the detector layers, a gap, the ruler, and then
// the square itself.
const LABEL_MARGIN = 64;
const LAYERS_SHARE = 0.24;
const RULER_GAP = 6;
const RULER = 34;
const EDGE_MARGIN = 12;

let encoder;
let slots;
let slotCount;
let position = { x: PLANE_SIZE / 2, y: PLANE_SIZE / 2 };
let pointer = null;
let codes = [];
let hoveredLayer = null;
let staticValid = false;
let frameRequested = false;

function linearDistance(a, b) {
    return Math.abs(a - b);
}

function clamp(value) {
    return Math.min(Math.max(value, 0), PLANE_SIZE);
}

function createEncoder() {
    const created = createFromForm(
        form,
        (p) =>
            new PlaneEncoder(
                p.codeLength,
                p.layersCount,
                p.overlap,
                p.widestDetectors,
                p.narrowestDetectors,
                PLANE_SIZE,
                randomSeed()
            )
    );

    if (!created) {
        return;
    }

    encoder = created;
    seedOutput.textContent = encoder.seed;
    // Both axes have the same detector positions, only their bits differ.
    ({ slots, slotCount } = layoutSlots(encoder.x.layers, linearDistance));
    codes = [];
    history.innerHTML = "";
    hoveredLayer = null;
    staticValid = false;

    renderLayersList(layersList, encoder.counts);
    requestFrame();
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
        updatePosition(pointer);
        pointer = null;
    }

    updateHistory();
    draw();
}

// Outside the square the position sticks to its nearest edge.
function updatePosition({ x, y }) {
    const rect = canvas.getBoundingClientRect();
    const g = geometry();

    position = {
        x: clamp((x - rect.left - g.origin) / g.scale),
        y: clamp((y - rect.top - g.origin) / g.scale),
    };
}

function updateHistory() {
    const x = encoder.x.encode(position.x);
    const y = encoder.y.encode(position.y);
    const last = codes[0];

    if (last && last.x.codeString === x.codeString && last.y.codeString === y.codeString) {
        return;
    }

    pushHistory(history, codes, { position, x, y }, renderEntry);
}

function renderEntry(i) {
    const { position, x, y } = codes[i];
    const previous = codes[i + 1];

    return (
        `<li>` +
        renderCodeLine(`x ${position.x.toFixed(1)}`, x, previous?.x.codeString) +
        renderCodeLine(`y ${position.y.toFixed(1)}`, y, previous?.y.codeString) +
        `</li>`
    );
}

function geometry() {
    const size = canvas.clientWidth;
    const band = (size - LABEL_MARGIN - EDGE_MARGIN) * LAYERS_SHARE;
    const bandInner = LABEL_MARGIN + band;
    const origin = bandInner + RULER_GAP + RULER;
    const side = size - origin - EDGE_MARGIN;

    return {
        size,
        bandInner,
        origin,
        side,
        scale: side / PLANE_SIZE,
        unit: band / slotCount,
    };
}

function draw() {
    const dpr = window.devicePixelRatio || 1;
    const g = geometry();

    if (fitCanvas(canvas, staticCanvas, g.size)) {
        staticValid = false;
    }

    if (!staticValid) {
        staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        staticCtx.clearRect(0, 0, g.size, g.size);
        drawSquare(staticCtx, g);
        drawRulers(staticCtx, g);
        drawDetectors(staticCtx, g);
        staticValid = true;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawActiveDetectors(ctx, g);
    drawCrosshair(ctx, g);
}

function drawSquare(c, g) {
    const { origin, side, scale } = g;

    c.strokeStyle = COLORS.grid;
    c.lineWidth = 1;
    c.beginPath();
    for (let value = 10; value < PLANE_SIZE; value += 10) {
        c.moveTo(origin + value * scale, origin);
        c.lineTo(origin + value * scale, origin + side);
        c.moveTo(origin, origin + value * scale);
        c.lineTo(origin + side, origin + value * scale);
    }
    c.stroke();

    c.strokeStyle = COLORS.dial;
    c.lineWidth = 1.5;
    c.strokeRect(origin, origin, side, side);
}

// The rulers run along the top and the left edges of the square, with their
// ticks pointing away from it.
function drawRulers(c, g) {
    const { origin, scale } = g;

    c.strokeStyle = COLORS.tick;
    c.lineWidth = 1;
    c.beginPath();
    for (let value = 0; value <= PLANE_SIZE; value++) {
        const length = value % 10 === 0 ? 10 : value % 5 === 0 ? 7 : 4;
        const at = origin + value * scale;

        c.moveTo(at, origin);
        c.lineTo(at, origin - length);
        c.moveTo(origin, at);
        c.lineTo(origin - length, at);
    }
    c.stroke();

    c.fillStyle = COLORS.dial;
    c.font = `10px ${FONT}`;
    for (let value = 0; value <= PLANE_SIZE; value += 10) {
        const at = origin + value * scale;

        c.textAlign = "center";
        c.textBaseline = "bottom";
        c.fillText(value, at, origin - 13);

        c.textAlign = "right";
        c.textBaseline = "middle";
        c.fillText(value, origin - 13, at);
    }
}

// Every detector is drawn here in its inactive colour; active ones are drawn
// over it each frame.
function drawDetectors(c, g) {
    c.lineWidth = Math.max(1, g.unit * 0.75);

    for (const axis of ["x", "y"]) {
        encoder[axis].layers.forEach((layer, l) => {
            c.globalAlpha = layerAlpha(l);
            c.strokeStyle = l === hoveredLayer ? COLORS.hoveredDetector : COLORS.detector;

            layer.forEach((detector, i) => {
                strokeDetector(c, g, axis, slots[l][i], detector);
            });
        });
    }

    c.globalAlpha = 1;
}

function drawActiveDetectors(c, g) {
    c.lineWidth = Math.max(1, g.unit * 0.75);
    c.strokeStyle = COLORS.activeDetector;
    c.shadowColor = COLORS.glow;
    c.shadowBlur = 6;

    for (const axis of ["x", "y"]) {
        const axisEncoder = encoder[axis];

        axisEncoder.layers.forEach((layer, l) => {
            c.globalAlpha = layerAlpha(l);

            layer.forEach((detector, i) => {
                if (axisEncoder.isActive(detector, position[axis])) {
                    strokeDetector(c, g, axis, slots[l][i], detector);
                }
            });
        });
    }

    c.shadowBlur = 0;
    c.globalAlpha = 1;
}

// While a layer is hovered in the list, the other layers fade out.
function layerAlpha(l) {
    return hoveredLayer === null || hoveredLayer === l ? 1 : 0.2;
}

// X detectors are horizontal segments above the top ruler, Y detectors are
// vertical segments left of the left ruler; both are cut to the square.
function strokeDetector(c, g, axis, slot, detector) {
    const half = detector.width / 2.0;
    const from = g.origin + clamp(detector.center - half) * g.scale;
    const to = g.origin + clamp(detector.center + half) * g.scale;
    const across = g.bandInner - slot * g.unit;

    c.beginPath();
    if (axis === "x") {
        c.moveTo(from, across);
        c.lineTo(to, across);
    } else {
        c.moveTo(across, from);
        c.lineTo(across, to);
    }
    c.stroke();
}

// Dashed lines from the point to the top and to the left, through the rulers
// and the detector layers, with the coordinates at their ends.
function drawCrosshair(c, g) {
    const px = g.origin + position.x * g.scale;
    const py = g.origin + position.y * g.scale;
    const end = LABEL_MARGIN - 6;

    c.shadowColor = COLORS.glow;
    c.shadowBlur = 8;

    c.strokeStyle = COLORS.ray;
    c.lineWidth = 1.5;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px, end);
    c.moveTo(px, py);
    c.lineTo(end, py);
    c.stroke();
    c.setLineDash([]);

    c.fillStyle = COLORS.ray;
    c.beginPath();
    c.arc(px, py, 3.5, 0, Math.PI * 2);
    c.fill();

    c.font = `700 14px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "bottom";
    c.fillText(`x ${position.x.toFixed(1)}`, px, end - 4);

    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillText(`y ${position.y.toFixed(1)}`, end - 4, py);

    c.shadowBlur = 0;
}

window.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    requestFrame();
});

// The square is sized by its container, which also changes with the history.
new ResizeObserver(requestFrame).observe(canvas);

bindLayerHover(layersList, (layer) => {
    hoveredLayer = layer;
    staticValid = false;
    requestFrame();
});

bindForm(form, createEncoder);

createEncoder();
