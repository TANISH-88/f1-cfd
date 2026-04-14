# F1 CFD Simulator

A real-time Formula 1 Computational Fluid Dynamics simulator with a 3D interactive car model, airflow visualization, and ML-powered aerodynamic predictions.

---

## What It Does

- Renders a 3D F1 car with real-time CFD airflow particle simulation
- Lets you select team, track, car speed, and DRS state
- Predicts drag coefficient, downforce, top speed, win probability, and air speed using a trained ML model
- Visualizes how airflow changes with DRS open vs closed
- Fully responsive — works on mobile and desktop

---

## Project Structure

```
f1-cfd/
├── backend/               # Python FastAPI + ML model
│   ├── main.py            # API server (FastAPI)
│   ├── model.py           # Random Forest model definition + training
│   ├── train.py           # Runs dataset generation + training
│   ├── dataset.py         # Synthetic physics-based dataset generator
│   ├── data.csv           # Generated training data
│   ├── model.pkl          # Trained model (saved by joblib)
│   ├── keep_alive.py      # Pings Render to prevent cold starts
│   ├── requirements.txt   # Python dependencies
│   └── render.yaml        # Render deployment config
│
└── frontend/              # Next.js 14 + React Three Fiber
    ├── app/
    │   ├── page.tsx        # Main app, state management
    │   ├── layout.tsx      # Root layout
    │   └── globals.css     # Global styles
    ├── components/
    │   ├── CarViewer.tsx   # 3D scene, car model, CFD particle simulation
    │   └── CFDPanel.tsx    # Controls panel (team, track, speed, DRS, predict)
    ├── public/
    │   └── models/         # (car.glb excluded from git — hosted on CDN)
    ├── package.json
    └── next.config.mjs
```

---

## Tech Stack

### Frontend
| Tech | Use |
|------|-----|
| Next.js 14 | React framework |
| React Three Fiber | 3D rendering in React |
| Three.js | WebGL 3D engine |
| @react-three/drei | 3D helpers (OrbitControls, lighting, etc.) |
| Tailwind CSS | Styling |
| TypeScript | Type safety |

### Backend
| Tech | Use |
|------|-----|
| FastAPI | REST API server |
| scikit-learn | Random Forest ML model |
| pandas | Data handling |
| numpy | Physics calculations |
| joblib | Model serialization |
| uvicorn | ASGI server |

---

## ML Model

The backend uses a **Random Forest Regressor** (scikit-learn) trained on synthetic physics-based data.

### Inputs (5 features)
- `team_aero_rating` — team aerodynamic efficiency (0.83–0.96)
- `track_straight_pct` — % of track that is straight (0–1)
- `corner_tightness` — how tight the corners are (0–1)
- `wind_angle` — wind direction (fixed at 0° headwind)
- `car_speed` — car speed in km/h (200–350)

### Outputs (5 predictions)
- `drag_coefficient` — aerodynamic drag (Cd)
- `downforce_N` — downforce in Newtons
- `top_speed_kmh` — predicted top speed
- `win_probability` — estimated win chance (0–1)
- `air_speed_ms` — airflow speed in m/s

### Teams supported
| Team | Aero Rating |
|------|-------------|
| Red Bull | 0.96 |
| McLaren | 0.93 |
| Ferrari | 0.91 |
| Mercedes | 0.89 |
| Aston Martin | 0.86 |
| Alpine | 0.83 |

### Tracks supported
| Track | Straights | Corner Tightness |
|-------|-----------|-----------------|
| Monza | 79% | 0.31 |
| Spa | 67% | 0.46 |
| Silverstone | 58% | 0.55 |
| Suzuka | 49% | 0.72 |
| Monaco | 32% | 0.93 |

---

## Running Locally

### Prerequisites
- Python 3.11+
- Node.js 18+
- npm

---

### 1. Backend

```bash
cd f1-cfd/backend
```

Install dependencies:
```bash
pip install -r requirements.txt
```

(Optional) Retrain the model:
```bash
python train.py
```

Start the API server:
```bash
uvicorn main:app --reload --port 8000
```

API will be live at `http://localhost:8000`

---

### 2. Frontend

```bash
cd f1-cfd/frontend
```

Install dependencies:
```bash
npm install
```

Create `.env.local` if it doesn't exist:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the dev server:
```bash
npm run dev
```

App will be live at `http://localhost:3000`

---

## Retraining the Model

The dataset is synthetically generated using physics-based formulas. To regenerate data and retrain:

```bash
cd f1-cfd/backend
python train.py
```

This will:
1. Run `dataset.py` — generates 300 rows (6 teams × 5 tracks × 10 speed/angle combos)
2. Run `model.py` — trains Random Forest with 300 estimators, prints R² scores
3. Save new `model.pkl`

To only view training scores without retraining:
```bash
python model.py
```

---

## API Endpoints

### `GET /` — Health check
```json
{ "status": "healthy", "model_loaded": true }
```

### `POST /predict` — Run prediction
Request:
```json
{
  "team": "red bull",
  "track": "monza",
  "car_speed": 320,
  "drs_active": true,
  "wind_effect": "high"
}
```
Response:
```json
{
  "drag": 0.2841,
  "downforce": 3120.5,
  "top_speed": 341.2,
  "win_chance": 0.7823,
  "air_speed": 87.34,
  "color": "#3671c6"
}
```

### DRS Effects on Predictions
| State | Drag | Downforce | Top Speed | Win Chance | Air Speed |
|-------|------|-----------|-----------|------------|-----------|
| DRS Active (open) | −25% | −35% | +15% | +25% | +12% |
| DRS Closed | baseline | baseline | baseline | baseline | baseline |

---

## Car Model

The 3D F1 car model (`.glb`) is hosted on Uploadthing CDN:
```
https://3dvl2e8ow7.ufs.sh/f/LwXIf852qnKPgGKJSiSecVEAFohQICn87qUMBXpYHRlWuvxe
```

It is excluded from git (137 MB, exceeds GitHub's 100 MB limit). The `CarViewer.tsx` loads it directly from the CDN URL.

---

## Deployment

### Backend — Render
- Configured via `backend/render.yaml`
- Live at: `https://f1-cfd.onrender.com`
- `keep_alive.py` pings the server periodically to prevent cold starts

### Frontend — Vercel / Netlify
- Configured via `frontend/render.yaml` and `frontend/netlify.toml`
- Set `NEXT_PUBLIC_API_URL` environment variable to your backend URL

---

## CFD Simulation Logic

The airflow particles are rendered using **Lagrangian particle tracking** in Three.js:

- **DRS Active** — clean laminar flow through rear wing gap, smooth streamlines
- **DRS Closed** — turbulent wake behind rear wing, recirculation zones
- Particles follow velocity fields calculated from car geometry
- Color mapped from blue (low velocity) → green → red (high velocity), matching real CFD output
- Ground effect, stagnation zones, and wake recirculation are all simulated

---

## Notes

- The `__pycache__/` folder is auto-generated by Python — ignore it
- `model.pkl` is the trained model binary — do not delete it unless retraining
- `data.csv` is the synthetic training dataset — regenerated by `train.py`
