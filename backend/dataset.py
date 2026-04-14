from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

TEAM_AERO_RATINGS: dict[str, float] = {
    "red bull": 0.96,
    "ferrari": 0.91,
    "mclaren": 0.93,
    "mercedes": 0.89,
    "aston martin": 0.86,
    "alpine": 0.83,
}

TRACK_PROFILES: dict[str, dict[str, float]] = {
    "monaco": {"track_straight_pct": 0.32, "corner_tightness": 0.93},
    "monza": {"track_straight_pct": 0.79, "corner_tightness": 0.31},
    "silverstone": {"track_straight_pct": 0.58, "corner_tightness": 0.55},
    "suzuka": {"track_straight_pct": 0.49, "corner_tightness": 0.72},
    "spa": {"track_straight_pct": 0.67, "corner_tightness": 0.46},
}

TEAMS: tuple[str, ...] = tuple(TEAM_AERO_RATINGS.keys())
TRACKS: tuple[str, ...] = tuple(TRACK_PROFILES.keys())


def _build_combo_grid() -> Iterable[tuple[float, float]]:
    # Exactly 10 angle/speed combinations for each team-track pair.
    combos = (
        (0.0, 200.0),
        (3.0, 215.0),
        (6.0, 235.0),
        (9.0, 250.0),
        (12.0, 270.0),
        (15.0, 285.0),
        (18.0, 300.0),
        (21.0, 315.0),
        (25.0, 335.0),
        (30.0, 350.0),
    )
    for wind_angle, car_speed in combos:
        yield wind_angle, car_speed


def _physics_like_outputs(
    team_aero_rating: float,
    track_straight_pct: float,
    corner_tightness: float,
    wind_angle: float,
    car_speed: float,
    rng: np.random.Generator,
) -> tuple[float, float, float, float, float]:
    speed_ms = car_speed / 3.6
    wind_penalty = 1.0 + (wind_angle / 30.0) * 0.06

    drag_coefficient = (
        0.42
        - 0.18 * team_aero_rating
        + 0.04 * corner_tightness
        - 0.03 * track_straight_pct
        + 0.0003 * (car_speed - 275.0)
    ) * wind_penalty
    drag_coefficient += rng.normal(0.0, 0.008)
    drag_coefficient = float(np.clip(drag_coefficient, 0.2, 0.52))

    downforce_n = (
        2100.0
        + 2200.0 * team_aero_rating
        + 1300.0 * corner_tightness
        - 650.0 * track_straight_pct
        + 9.2 * (car_speed - 200.0)
        - 6.8 * wind_angle
    )
    downforce_n += rng.normal(0.0, 95.0)
    downforce_n = float(np.clip(downforce_n, 1800.0, 7200.0))

    top_speed_kmh = (
        car_speed
        + 17.0 * track_straight_pct
        + 5.0 * team_aero_rating
        - 64.0 * drag_coefficient
        - 0.62 * corner_tightness * 10.0
        - 0.32 * wind_angle
    )
    top_speed_kmh += rng.normal(0.0, 2.5)
    top_speed_kmh = float(np.clip(top_speed_kmh, 215.0, 365.0))

    win_raw = (
        0.15
        + 0.55 * team_aero_rating
        + 0.15 * (1.0 - drag_coefficient)
        + 0.10 * (downforce_n / 7000.0)
        + 0.06 * track_straight_pct
        - 0.08 * (wind_angle / 30.0)
        - 0.06 * corner_tightness
    )
    win_probability = float(np.clip(win_raw + rng.normal(0.0, 0.02), 0.02, 0.95))

    air_speed_ms = (
        speed_ms
        * (1.0 + 0.04 * track_straight_pct + 0.01 * team_aero_rating)
        * (1.0 - 0.025 * (wind_angle / 30.0))
    )
    air_speed_ms += rng.normal(0.0, 0.45)
    air_speed_ms = float(np.clip(air_speed_ms, 48.0, 110.0))

    return drag_coefficient, downforce_n, top_speed_kmh, win_probability, air_speed_ms


def generate_dataset(output_path: Path | None = None) -> Path:
    output_path = output_path or Path(__file__).resolve().parent / "data.csv"
    rng = np.random.default_rng(42)

    rows: list[dict[str, float]] = []
    combo_grid = tuple(_build_combo_grid())

    for team in TEAMS:
        team_rating = TEAM_AERO_RATINGS[team]
        for track in TRACKS:
            track_profile = TRACK_PROFILES[track]
            for wind_angle, car_speed in combo_grid:
                drag, downforce, top_speed, win_prob, air_speed = _physics_like_outputs(
                    team_rating,
                    track_profile["track_straight_pct"],
                    track_profile["corner_tightness"],
                    wind_angle,
                    car_speed,
                    rng,
                )
                rows.append(
                    {
                        "team_aero_rating": team_rating,
                        "track_straight_pct": track_profile["track_straight_pct"],
                        "corner_tightness": track_profile["corner_tightness"],
                        "wind_angle": wind_angle,
                        "car_speed": car_speed,
                        "drag_coefficient": drag,
                        "downforce_N": downforce,
                        "top_speed_kmh": top_speed,
                        "win_probability": win_prob,
                        "air_speed_ms": air_speed,
                    }
                )

    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    return output_path


if __name__ == "__main__":
    csv_path = generate_dataset()
    print(f"Dataset saved to {csv_path}")
