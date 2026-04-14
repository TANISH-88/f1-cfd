from dataset import generate_dataset
from model import train_model


def main() -> None:
    generate_dataset()
    train_model()
    print("Model ready!")


if __name__ == "__main__":
    main()
