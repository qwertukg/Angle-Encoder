from encoder import Encoder


def main():
    encoder = Encoder(
        code_length=128,
        layers_count=22,
        overlap=0.4,
        widest_detectors=2,
        narrowest_detectors=180,
    )

    print(f"Ожидаемая плотность: {encoder.get_density() * 100}%")

    code0 = encoder.encode(0.0)
    code1 = encoder.encode(1.0)

    print()
    print("0°")
    print(code0.code_string)

    print()
    print("1°")
    print(code1.code_string)


if __name__ == "__main__":
    main()
