import math
import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Detector:
    center: float
    width: float
    bit: int


@dataclass(frozen=True)
class Code:
    bit_code: int
    code_string: str


class Encoder:
    def __init__(
        self,
        code_length: int,
        layers_count: int,
        overlap: float,
        widest_detectors: int,
        narrowest_detectors: int,
    ):
        self._code_length = code_length
        self._layers_count = layers_count
        self._overlap = overlap
        self._widest_detectors = widest_detectors
        self._narrowest_detectors = narrowest_detectors
        self._layers = self._create_layers()

    def get_density(self) -> float:
        active_detectors = self._layers_count / (1.0 - self._overlap)

        return 1.0 - (1.0 - 1.0 / self._code_length) ** active_detectors

    def encode(self, angle_degrees: float) -> Code:
        angle = ((angle_degrees % 360.0) + 360.0) % 360.0
        bits = 0

        for layer in self._layers:
            for detector in layer:
                diff = abs(angle - detector.center)
                distance = min(diff, 360.0 - diff)

                if distance <= detector.width / 2.0:
                    bits |= 1 << detector.bit

        code_string = "".join(
            "1" if bits >> i & 1 else "0" for i in range(self._code_length)
        )

        return Code(
            bit_code=bits,
            code_string=code_string,
        )

    def _create_layers(self) -> list[list[Detector]]:
        ratio = (self._narrowest_detectors / self._widest_detectors) ** (
            1.0 / (self._layers_count - 1)
        )

        layers = []
        for layer in range(self._layers_count):
            if layer == 0:
                count = self._widest_detectors
            elif layer == self._layers_count - 1:
                count = self._narrowest_detectors
            else:
                # Kotlin roundToInt rounds half up, unlike Python's round()
                count = math.floor(self._widest_detectors * ratio**layer + 0.5)

            step = 360.0 / count
            width = step / (1.0 - self._overlap)

            layers.append(
                [
                    Detector(
                        center=i * step,
                        width=width,
                        bit=random.randrange(self._code_length),
                    )
                    for i in range(count)
                ]
            )

        return layers
