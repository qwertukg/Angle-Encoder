const GOLDEN_RATIO_FRACTION = (Math.sqrt(5) - 1) / 2;

class Encoder {
    constructor(codeLength, layersCount, overlap, widestDetectors, narrowestDetectors) {
        this.codeLength = codeLength;
        this.layersCount = layersCount;
        this.overlap = overlap;
        this.widestDetectors = widestDetectors;
        this.narrowestDetectors = narrowestDetectors;
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

    createLayers() {
        const ratio =
            (this.narrowestDetectors / this.widestDetectors) ** (1.0 / (this.layersCount - 1));

        const layers = [];
        for (let layer = 0; layer < this.layersCount; layer++) {
            let count;
            if (layer === 0) {
                count = this.widestDetectors;
            } else if (layer === this.layersCount - 1) {
                count = this.narrowestDetectors;
            } else {
                count = Math.round(this.widestDetectors * ratio ** layer);
            }

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
                    bit: Math.floor(Math.random() * this.codeLength),
                });
            }
            layers.push(detectors);
        }

        return layers;
    }
}
