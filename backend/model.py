from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
from sklearn.model_selection import train_test_split

INPUT_COLUMNS = [
    "team_aero_rating",
    "track_straight_pct",
    "corner_tightness",
    "wind_angle",
    "car_speed",
]

OUTPUT_COLUMNS = [
    "drag_coefficient",
    "downforce_N",
    "top_speed_kmh",
    "win_probability",
    "air_speed_ms",
]


def train_model(
    data_path: Path | None = None,
    model_path: Path | None = None,
) -> Path:
    base_dir = Path(__file__).resolve().parent
    data_path = data_path or (base_dir / "data.csv")
    model_path = model_path or (base_dir / "model.pkl")

    df = pd.read_csv(data_path)
    x = df[INPUT_COLUMNS]
    y = df[OUTPUT_COLUMNS]

    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=42
    )

    model = RandomForestRegressor(
        n_estimators=300,
        random_state=42,
        min_samples_leaf=2,
    )
    model.fit(x_train, y_train)

    y_pred = model.predict(x_test)
    scores = {
        target: r2_score(y_test[target], y_pred[:, idx])
        for idx, target in enumerate(OUTPUT_COLUMNS)
    }

    for target, score in scores.items():
        print(f"R² {target}: {score:.4f}")

    joblib.dump(model, model_path)
    return model_path


if __name__ == "__main__":
    saved_model = train_model()
    print(f"Model saved to {saved_model}")
