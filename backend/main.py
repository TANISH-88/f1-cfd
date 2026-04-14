from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from dataset import TEAM_AERO_RATINGS, TRACK_PROFILES

TEAM_COLORS: dict[str, str] = {
    "red bull": "#3671c6",
    "ferrari": "#e10600",
    "mclaren": "#ff8700",
    "mercedes": "#27f4d2",
    "aston martin": "#229971",
    "alpine": "#ff87bc",
}

MODEL_PATH = Path(__file__).resolve().parent / "model.pkl"
MODEL = None

app = FastAPI(title="F1 CFD ML API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://localhost:3001",
        "https://*.vercel.app",   # Vercel deployments
        "https://*.netlify.app",  # Netlify deployments
        "https://*.render.com",   # Render deployments
        "*"  # Allow all for now - restrict in production
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.get("/")
async def health_check():
    """Health check endpoint for Render and monitoring services"""
    return {
        "status": "healthy",
        "service": "F1 CFD Surrogate API",
        "version": "1.0.0",
        "model_loaded": MODEL is not None
    }

@app.get("/health")
async def detailed_health():
    """Detailed health check with model status"""
    return {
        "status": "healthy",
        "model_path": str(MODEL_PATH),
        "model_exists": MODEL_PATH.exists(),
        "model_loaded": MODEL is not None,
        "teams": list(TEAM_COLORS.keys()),
        "tracks": list(TRACK_PROFILES.keys())
    }


class CFDRequest(BaseModel):
    team: str
    track: str
    car_speed: float = Field(ge=200, le=350)
    drs_active: bool = False
    wind_effect: str = "high"


@app.on_event("startup")
def load_model() -> None:
    global MODEL
    MODEL = joblib.load(MODEL_PATH)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.options("/predict")
def predict_options():
    return {"message": "OK"}


@app.post("/predict")
def predict_performance(req: CFDRequest) -> dict[str, float | str]:
    if MODEL is None:
        load_model()

    # Debug logging to see what we're receiving
    print(f"DEBUG: Received request - team: {req.team}, track: {req.track}, car_speed: {req.car_speed}, drs_active: {req.drs_active}, wind_effect: {req.wind_effect}")

    team_key = req.team.strip().lower()
    track_key = req.track.strip().lower()

    if team_key not in TEAM_AERO_RATINGS:
        team_key = "alpine"
    if track_key not in TRACK_PROFILES:
        track_key = "silverstone"

    track = TRACK_PROFILES[track_key]
    features = pd.DataFrame(
        [
            {
                "team_aero_rating": TEAM_AERO_RATINGS[team_key],
                "track_straight_pct": track["track_straight_pct"],
                "corner_tightness": track["corner_tightness"],
                "wind_angle": 0,  # Fixed at 0 (headwind)
                "car_speed": req.car_speed,
            }
        ]
    )

    prediction = MODEL.predict(features)[0]

    # Base predictions from ML model
    base_drag = float(prediction[0])
    base_downforce = float(prediction[1])
    base_top_speed = float(prediction[2])
    base_win_chance = float(prediction[3])
    base_air_speed = float(prediction[4])

    print(f"DEBUG: Base predictions - drag: {base_drag}, downforce: {base_downforce}, top_speed: {base_top_speed}")

    # Apply DRS effects
    if req.drs_active:
        # DRS ACTIVE - Rear wing flap open, reduced drag and downforce
        drag_multiplier = 0.75  # 25% drag reduction
        downforce_multiplier = 0.65  # 35% downforce reduction
        speed_multiplier = 1.15  # 15% top speed increase
        win_chance_multiplier = 1.25  # 25% win chance increase (better straight line speed)
        air_speed_multiplier = 1.12  # 12% air speed increase
        print("DEBUG: Applying DRS ACTIVE multipliers")
    else:
        # DRS CLOSED - Normal aerodynamic configuration
        drag_multiplier = 1.0
        downforce_multiplier = 1.0
        speed_multiplier = 1.0
        win_chance_multiplier = 1.0
        air_speed_multiplier = 1.0
        print("DEBUG: Applying DRS CLOSED multipliers (no change)")

    # Apply DRS effects to all values
    final_drag = base_drag * drag_multiplier
    final_downforce = base_downforce * downforce_multiplier
    final_top_speed = base_top_speed * speed_multiplier
    final_win_chance = base_win_chance * win_chance_multiplier
    final_air_speed = base_air_speed * air_speed_multiplier

    print(f"DEBUG: Final predictions - drag: {final_drag}, downforce: {final_downforce}, top_speed: {final_top_speed}")

    return {
        "drag": round(final_drag, 4),
        "downforce": round(final_downforce, 1),
        "top_speed": round(final_top_speed, 1),
        "win_chance": round(final_win_chance, 4),
        "air_speed": round(final_air_speed, 2),
        "color": TEAM_COLORS.get(team_key, "#cbd5e1"),
    }
