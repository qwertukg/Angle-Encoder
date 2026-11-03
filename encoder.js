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

class Encoder {
    constructor(codeLength, layersCount, overlap, widestDetectors, narrowestDetectors, seed) {
        this.codeLength = codeLength;
        this.layersCount = layersCount;
        this.overlap = overlap;
        this.widestDetectors = widestDetectors;
        this.narrowestDetectors = narrowestDetectors;
        this.seed = seed;
        this.random = mulberry32(seed);
        this.layers = this.createLayers();
    }

    getDensity() {
        const activeDetectors = this.layersCount / (1.0 - this.overlap);

        return 1.0 - (1.0 - 1.0 / this.codeLength) ** activeDetectors;
    }

    encode(angleDegrees) {
        const angle = ((angleDegrees % 360.0) + 360.0) % 360.0;
        const bits = new Uint8Array(this.codeLength);
        // How many active detectors set each bit: more than one means they
        // share it.
        const hits = new Uint8Array(this.codeLength);

        for (const layer of this.layers) {
            for (const detector of layer) {
                if (this.isActive(detector, angle)) {
                    bits[detector.bit] = 1;
                    hits[detector.bit]++;
                }
            }
        }

        const codeString = bits.join("");

        return { bitCode: bits, codeString, hits };
    }

    isActive(detector, angle) {
        const diff = Math.abs(angle - detector.center);
        const distance = Math.min(diff, 360.0 - diff);

        return distance <= detector.width / 2.0;
    }

    // Detector counts grow geometrically from the widest layer to the
    // narrowest. Rounding can give neighbouring layers the same count, so each
    // layer is pushed to at least one more than the previous one, and then
    // capped so that the narrowest layer keeps its exact count.
    layerCounts() {
        const last = this.layersCount - 1;

        if (this.narrowestDetectors - this.widestDetectors < last) {
            throw new RangeError(
                `Для ${this.layersCount} слоёв с разным числом детекторов нужно, ` +
                    `чтобы в узком слое было хотя бы на ${last} больше, чем в широком`
            );
        }

        const ratio = (this.narrowestDetectors / this.widestDetectors) ** (1.0 / last);
        const counts = [];

        for (let layer = 0; layer <= last; layer++) {
            if (layer === 0) {
                counts.push(this.widestDetectors);
            } else if (layer === last) {
                counts.push(this.narrowestDetectors);
            } else {
                const count = Math.round(this.widestDetectors * ratio ** layer);
                counts.push(Math.max(count, counts[layer - 1] + 1));
            }
        }

        for (let layer = last - 1; layer > 0; layer--) {
            counts[layer] = Math.min(counts[layer], counts[layer + 1] - 1);
        }

        return counts;
    }

    createLayers() {
        const layers = [];

        this.layerCounts().forEach((count, layer) => {
            const step = 360.0 / count;
            const width = step / (1.0 - this.overlap);
            // Each layer is rotated by its own fraction of a step so that the
            // layers do not all line up at 0°, which would make the code
            // density depend on the angle.
            const phase = (layer * GOLDEN_RATIO_FRACTION) % 1.0;

            const detectors = [];
            for (let i = 0; i < count; i++) {
                detectors.push({
                    center: (i + phase) * step,
                    width,
                    bit: Math.floor(this.random() * this.codeLength),
                });
            }
            layers.push(detectors);
        });

        return layers;
    }
}
