const GOLDEN_RATIO_FRACTION = (Math.sqrt(5) - 1) / 2;

// Mulberry32: a small seedable generator of numbers in [0, 1), so that an
// encoder can be reproduced from its seed.
function mulberry32(seed) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Detector counts grow geometrically from the widest layer to the narrowest.
// Rounding can give neighbouring layers the same count, so each layer is
// pushed to at least one more than the previous one, and then capped so that
// the narrowest layer keeps its exact count.
function layerCounts(layersCount, widestDetectors, narrowestDetectors) {
    const last = layersCount - 1;

    if (narrowestDetectors - widestDetectors < last) {
        throw new RangeError(
            `Для ${layersCount} слоёв с разным числом детекторов нужно, ` +
                `чтобы в узком слое было хотя бы на ${last} больше, чем в широком`
        );
    }

    const ratio = (narrowestDetectors / widestDetectors) ** (1.0 / last);
    const counts = [];

    for (let layer = 0; layer <= last; layer++) {
        if (layer === 0) {
            counts.push(widestDetectors);
        } else if (layer === last) {
            counts.push(narrowestDetectors);
        } else {
            const count = Math.round(widestDetectors * ratio ** layer);
            counts.push(Math.max(count, counts[layer - 1] + 1));
        }
    }

    for (let layer = last - 1; layer > 0; layer--) {
        counts[layer] = Math.min(counts[layer], counts[layer + 1] - 1);
    }

    return counts;
}

// Each layer is shifted by its own fraction of a step so that the layers do
// not all line up at the origin, which would make the code density depend on
// the position.
function layerPhase(layer) {
    return (layer * GOLDEN_RATIO_FRACTION) % 1.0;
}

function encodeLayers(encoder, position) {
    const bits = new Uint8Array(encoder.codeLength);
    // How many active detectors set each bit: more than one means they share
    // it.
    const hits = new Uint8Array(encoder.codeLength);

    for (const layer of encoder.layers) {
        for (const detector of layer) {
            if (encoder.isActive(detector, position)) {
                bits[detector.bit] = 1;
                hits[detector.bit]++;
            }
        }
    }

    const codeString = bits.join("");

    return { bitCode: bits, codeString, hits };
}

class Encoder {
    constructor(codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, seed) {
        this.codeLength = codeLength;
        this.layersCount = layersCount;
        this.overlap = overlap;
        this.widestDetectors = widestDetectors;
        this.narrowestDetectors = narrowestDetectors;
        this.seed = seed;
        this.random = mulberry32(seed);
        this.counts = layerCounts(layersCount, widestDetectors, narrowestDetectors);
        this.layers = this.createLayers();
    }

    getDensity() {
        const activeDetectors = this.layersCount / (1.0 - this.overlap);

        return 1.0 - (1.0 - 1.0 / this.codeLength) ** activeDetectors;
    }

    encode(angleDegrees) {
        const angle = ((angleDegrees % 360.0) + 360.0) % 360.0;

        return encodeLayers(this, angle);
    }

    isActive(detector, angle) {
        const diff = Math.abs(angle - detector.center);
        const distance = Math.min(diff, 360.0 - diff);

        return distance <= detector.width / 2.0;
    }

    createLayers() {
        return this.counts.map((count, layer) => {
            const step = 360.0 / count;
            const width = step / (1.0 - this.overlap);
            const phase = layerPhase(layer);

            const detectors = [];
            for (let i = 0; i < count; i++) {
                detectors.push({
                    center: (i + phase) * step,
                    width,
                    bit: Math.floor(this.random() * this.codeLength),
                });
            }
            return detectors;
        });
    }
}

// The same layered encoder for a position on a segment [0, length]. A layer
// of `count` detectors has `count` steps along the segment.
class LinearEncoder {
    constructor(codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, length, random) {
        this.codeLength = codeLength;
        this.layersCount = layersCount;
        this.overlap = overlap;
        this.length = length;
        this.random = random;
        this.counts = layerCounts(layersCount, widestDetectors, narrowestDetectors);
        this.layers = this.createLayers();
    }

    encode(position) {
        return encodeLayers(this, Math.min(Math.max(position, 0), this.length));
    }

    isActive(detector, position) {
        return Math.abs(position - detector.center) <= detector.width / 2.0;
    }

    // Unlike a circle, a segment has ends. Every detector that reaches into
    // the segment is kept, including those centred past its ends, so that the
    // ends are covered as densely as the middle.
    createLayers() {
        return this.counts.map((count, layer) => {
            const step = this.length / count;
            const width = step / (1.0 - this.overlap);
            const phase = layerPhase(layer);
            const halfSteps = width / 2.0 / step;
            const first = Math.floor(-halfSteps - phase) + 1;
            const last = Math.ceil(count + halfSteps - phase) - 1;

            const detectors = [];
            for (let i = first; i <= last; i++) {
                detectors.push({
                    center: (i + phase) * step,
                    width,
                    bit: Math.floor(this.random() * this.codeLength),
                });
            }
            return detectors;
        });
    }
}

// A position on a square is encoded as a pair of codes, one per axis. Both
// axes draw their detector bits from one generator, so one seed reproduces
// the whole encoder.
class PlaneEncoder {
    constructor(codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, size, seed) {
        const random = mulberry32(seed);

        this.seed = seed;
        this.size = size;
        this.x = new LinearEncoder(
            codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, size, random
        );
        this.y = new LinearEncoder(
            codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, size, random
        );
        this.counts = this.x.counts;
    }
}
