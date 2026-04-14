"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PredictPayload = {
  team: string;
  track: string;
  car_speed: number;
  drs_active: boolean;
  wind_effect: "low" | "medium" | "high";
};

export type PredictResponse = {
  drag: number;
  win_chance: number;
  air_speed: number;
  top_speed: number;
  downforce: number;
  color: string;
};

type CFDPanelProps = {
  onResult: (data: PredictResponse) => void;
  onControlsChange?: (controls: { carSpeed: number; windEffect: WindEffectLevel; drsActive: boolean }) => void;
  onCornerSelect?: (windDirection: number, turnDirection: "left" | "right" | "straight", cornerName: string) => void;
  onTrackChange?: (track: string) => void;
  onTeamChange?: (team: string) => void;
};
export type WindEffectLevel = "low" | "medium" | "high";
const WIND_EFFECT_OPTIONS: WindEffectLevel[] = ["low", "medium", "high"];

const TEAMS = [
  "Red Bull",
  "Ferrari", 
  "McLaren",
  "Mercedes",
  "Aston Martin",
  "Alpine",
];

export const TRACKS = ["Monaco", "Monza", "Silverstone", "Suzuka", "Spa"] as const;

type TrackId = (typeof TRACKS)[number];

type CornerKind = "downforce" | "speed";

type CornerDef = {
  label: string;
  kind: CornerKind;
  /** SVG coordinates in viewBox space */
  x: number;
  y: number;
  /** Nudge label away from dot */
  lx?: number;
  ly?: number;
  /** Wind direction when car goes through this corner (degrees) */
  windDirection?: number;
  /** Turn direction for aerodynamic simulation */
  turnDirection?: "left" | "right" | "straight";
};

type TrackMiniMapDef = {
  path: string;
  /** Optional start dot */
  start?: { x: number; y: number };
  corners: CornerDef[];
};

const TRACK_MINIMAPS: Record<TrackId, TrackMiniMapDef> = {
  Monaco: {
    path: "M 28 98 L 92 94 Q 108 88 118 72 L 124 48 Q 126 32 108 22 L 72 18 Q 48 16 38 34 L 32 58 Q 30 78 28 98",
    start: { x: 28, y: 98 },
    corners: [
      // Casino Square - Right turn after Massenet, ~90° right turn
      { label: "Casino", kind: "downforce", x: 118, y: 72, lx: 8, ly: -10, windDirection: 90, turnDirection: "right" },
      // Grand Hotel Hairpin - Slowest corner in F1, 180° hairpin turn  
      { label: "Loews", kind: "downforce", x: 108, y: 22, lx: 10, ly: -8, windDirection: 180, turnDirection: "right" },
      { label: "Tunnel", kind: "speed", x: 72, y: 18, lx: 0, ly: -12, windDirection: 0, turnDirection: "straight" },
    ],
  },
  Monza: {
    path: "M 36 78 L 188 78 L 198 62 L 192 44 L 168 32 L 96 28 L 52 38 L 36 56 L 36 78",
    start: { x: 36, y: 78 },
    corners: [
      // Lesmo 1&2 - Two consecutive right turns, ~45° each
      { label: "Lesmo 1&2", kind: "downforce", x: 192, y: 44, lx: 10, ly: 0, windDirection: 45, turnDirection: "right" },
      { label: "Ascari", kind: "speed", x: 96, y: 28, lx: 0, ly: -12, windDirection: 0, turnDirection: "straight" },
      // Parabolica - Long sweeping left turn, ~120° arc
      { label: "Parabolica", kind: "downforce", x: 52, y: 38, lx: -36, ly: 8, windDirection: -120, turnDirection: "left" },
    ],
  },
  Silverstone: {
    path: "M 32 72 Q 72 22 128 28 Q 176 34 196 58 L 188 88 Q 140 98 88 92 Q 44 86 32 72",
    start: { x: 32, y: 72 },
    corners: [
      // Copse - Fast right turn, ~60° at 300km/h
      { label: "Copse", kind: "speed", x: 100, y: 24, lx: 0, ly: -12, windDirection: 60, turnDirection: "right" },
      // Maggots-Becketts - Left-right-left sequence, starts with left ~45°
      { label: "Maggots–Becketts", kind: "downforce", x: 158, y: 36, lx: 6, ly: -12, windDirection: -45, turnDirection: "left" },
      // Chapel - Final left of the sequence, ~30° left
      { label: "Chapel", kind: "speed", x: 120, y: 92, lx: 0, ly: 12, windDirection: -30, turnDirection: "left" },
    ],
  },
  Suzuka: {
    path: "M 42 76 L 168 76 L 178 52 L 152 28 L 98 22 L 54 36 L 38 58 L 42 76",
    start: { x: 42, y: 76 },
    corners: [
      // S-curves - Multiple direction changes, left-right-left sequence
      { label: "S-curves", kind: "downforce", x: 168, y: 76, lx: 6, ly: 12, windDirection: -35, turnDirection: "left" },
      // 130R - High-speed left sweeper, 130° radius (now 85°+340° double apex)
      { label: "130R", kind: "speed", x: 152, y: 28, lx: 10, ly: -8, windDirection: 85, turnDirection: "right" },
      // Spoon - Tight left hairpin, ~150° turn
      { label: "Spoon", kind: "downforce", x: 98, y: 22, lx: 0, ly: -12, windDirection: -150, turnDirection: "left" },
    ],
  },
  Spa: {
    path: "M 34 52 L 96 42 L 132 26 L 168 38 L 192 64 L 168 92 L 48 88 Q 28 72 34 52",
    start: { x: 34, y: 52 },
    corners: [
      // Eau Rouge - Uphill left kink, ~25° left
      { label: "Eau Rouge", kind: "downforce", x: 132, y: 26, lx: -18, ly: -10, windDirection: -25, turnDirection: "left" },
      { label: "Raidillon", kind: "speed", x: 168, y: 38, lx: 10, ly: -8, windDirection: 0, turnDirection: "straight" },
      // Pouhon - Long left sweeper, ~90° sustained left
      { label: "Pouhon", kind: "downforce", x: 192, y: 64, lx: 8, ly: 10, windDirection: -90, turnDirection: "left" },
    ],
  },
};

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function CFDPanel({ onResult, onControlsChange, onCornerSelect, onTrackChange, onTeamChange }: CFDPanelProps) {
  const [team, setTeam] = useState(TEAMS[0]);
  const [track, setTrack] = useState<TrackId>(TRACKS[0]);
  const [windAngle] = useState(0); // Fixed at 0 (headwind)
  const [carSpeed, setCarSpeed] = useState(280);
  const [windEffect, setWindEffect] = useState<WindEffectLevel>("high");
  const [drsActive, setDrsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<PredictResponse | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<string | null>(null);

  const mapDef = TRACK_MINIMAPS[track];

  useEffect(() => {
    onControlsChange?.({ carSpeed, windEffect, drsActive });
  }, [carSpeed, windEffect, drsActive, onControlsChange]);

  // Notify parent when team/track changes
  const handleTeamChange = (newTeam: string) => {
    setTeam(newTeam);
    onTeamChange?.(newTeam);
  };

  const handleTrackChange = (newTrack: TrackId) => {
    setTrack(newTrack);
    onTrackChange?.(newTrack);
    setSelectedCorner(null); // Reset corner when track changes
  };

  const runPredict = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, track, car_speed: carSpeed, drs_active: drsActive, wind_effect: windEffect } satisfies PredictPayload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as PredictResponse;
      setLast(data);
      onResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [team, track, carSpeed, drsActive, windEffect, onResult]);

  return (
    <div className="flex flex-col gap-2 lg:gap-4 rounded-xl bg-[#141821] p-2 sm:p-3 lg:p-5 ring-1 ring-white/10">
      {/* Header - show on desktop, minimal on mobile */}
      <div className="hidden lg:block">
        <h2 className="text-base lg:text-lg font-semibold text-white">CFD surrogate</h2>
        <p className="mt-1 text-xs lg:text-sm text-slate-400">
          Deep Learning CNN Surrogate Model - Neural Concept Style
        </p>
        <p className="text-[10px] lg:text-xs text-slate-500">
          Inference: &lt;0.1s (vs 2-8hrs traditional CFD)
        </p>
      </div>

      <div className="grid gap-2 lg:gap-3 grid-cols-2">
        <label className="flex flex-col gap-1 text-xs lg:text-sm">
          <span className="text-slate-400">Team</span>
          <select
            className="rounded-lg border border-white/10 bg-[#0f1117] px-2 lg:px-3 py-2 text-white text-xs lg:text-sm outline-none focus:ring-2 focus:ring-cyan-500/50 touch-manipulation"
            value={team}
            onChange={(e) => handleTeamChange(e.target.value)}
          >
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs lg:text-sm">
          <span className="text-slate-400">Track</span>
          <select
            className="rounded-lg border border-white/10 bg-[#0f1117] px-2 lg:px-3 py-2 text-white text-xs lg:text-sm outline-none focus:ring-2 focus:ring-cyan-500/50 touch-manipulation"
            value={track}
            onChange={(e) => handleTrackChange(e.target.value as TrackId)}
          >
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs lg:text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-slate-400">Wind effect</span>
          <div className="grid grid-cols-1 gap-1">
            {WIND_EFFECT_OPTIONS.map((option) => {
              const isActive = windEffect === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setWindEffect(option)}
                  className={`rounded border px-2 py-1.5 text-xs font-medium capitalize transition touch-manipulation ${
                    isActive
                      ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                      : "border-white/10 bg-[#0f1117] text-slate-300 hover:border-cyan-500/40 active:bg-cyan-500/10"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-slate-400">DRS</span>
          <button
            type="button"
            onClick={() => setDrsActive(!drsActive)}
            className={`rounded border px-2 py-3 text-xs font-medium transition touch-manipulation ${
              drsActive
                ? "border-green-400/70 bg-green-500/20 text-green-200"
                : "border-white/10 bg-[#0f1117] text-slate-300 hover:border-green-500/40 active:bg-green-500/10"
            }`}
          >
            {drsActive ? "DRS ACTIVE" : "DRS CLOSED"}
          </button>
        </div>
      </div>

      {/* Speed slider gets full width and more space for better mobile usability */}
      <div className="flex flex-col gap-2 text-xs lg:text-sm">
        <span className="text-slate-400">Car speed: {carSpeed} km/h</span>
        <div className="relative">
          <input
            type="range"
            min={200}
            max={350}
            step={5}
            value={carSpeed}
            onChange={(e) => setCarSpeed(Number(e.target.value))}
            className="w-full accent-cyan-500 bg-slate-700 rounded appearance-none h-6 sm:h-5 lg:h-4 cursor-pointer touch-manipulation"
            style={{
              background: `linear-gradient(to right, 
                #1e40af 0%, #3b82f6 20%, #06b6d4 35%, #10b981 50%, 
                #f59e0b 65%, #f97316 80%, #dc2626 90%, #991b1b 100%)`
            }}
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
            <span>200</span>
            <span>275</span>
            <span>350</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={runPredict}
        disabled={loading}
        className="rounded border bg-cyan-600 px-2 py-1.5 sm:py-2 text-[10px] sm:text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50 touch-manipulation"
      >
        {loading ? "Running…" : "Run prediction"}
      </button>

      {error && (
        <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/30">
          {error}
        </p>
      )}

      {last && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <AnimatedMetric label="Drag coefficient" value={last.drag} decimals={4} suffix="" />
            <AnimatedMetric label="Win chance" value={last.win_chance * 100} decimals={1} suffix="%" />
            <AnimatedMetric label="Air speed" value={last.air_speed} decimals={1} suffix=" m/s" />
            <AnimatedMetric label="Top speed" value={last.top_speed} decimals={1} suffix=" km/h" />
            <AnimatedMetric label="Downforce" value={last.downforce} decimals={0} suffix=" N" />
            <div className="col-span-2 flex items-center gap-2 justify-center lg:justify-start">
              <span className="text-slate-400 text-xs">Livery</span>
              <span
                className="inline-block h-4 w-4 rounded border border-white/20"
                style={{ backgroundColor: last.color }}
                title={last.color}
              />
              <span className="font-mono text-xs text-slate-300">{last.color}</span>
            </div>
          </dl>
        </>
      )}

      <TrackMiniMap 
        def={mapDef} 
        title={track} 
        selectedCorner={selectedCorner}
        onCornerClick={(corner) => {
          setSelectedCorner(corner.label);
          if (onCornerSelect && corner.windDirection !== undefined && corner.turnDirection) {
            onCornerSelect(corner.windDirection, corner.turnDirection, corner.label);
          }
        }}
      />
    </div>
  );
}

const CORNER_FILL: Record<CornerKind, string> = {
  downforce: "#f87171",
  speed: "#60a5fa",
};

function TrackMiniMap({ 
  def, 
  title, 
  selectedCorner, 
  onCornerClick 
}: { 
  def: TrackMiniMapDef; 
  title: string;
  selectedCorner?: string | null;
  onCornerClick?: (corner: CornerDef) => void;
}) {
  const vb = "0 0 220 128";

  return (
    <div className="rounded bg-black/35 p-1.5 sm:p-2 lg:p-3 ring-1 ring-white/8">
      <div className="mb-1 sm:mb-2 flex flex-wrap items-center justify-between gap-1">
        <span className="text-[8px] sm:text-[9px] lg:text-xs font-medium uppercase tracking-wide text-slate-400">Track</span>
        <span className="text-[9px] sm:text-xs lg:text-sm font-semibold text-white">{title}</span>
      </div>
      {selectedCorner && (
        <div className="mb-1 text-[8px] sm:text-[9px] lg:text-xs text-cyan-400">
          <span className="font-medium">{selectedCorner}</span>
        </div>
      )}
      <svg
        viewBox={vb}
        className="h-auto w-full max-h-16 sm:max-h-24 lg:max-h-36 text-slate-500 touch-manipulation"
        role="img"
        aria-label={`${title} interactive corner map`}
      >
        <rect x="0" y="0" width="220" height="128" fill="#0c0e14" rx="6" />
        <path
          d={def.path}
          fill="none"
          stroke="#64748b"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {def.start && (
          <circle cx={def.start.x} cy={def.start.y} r={3} fill="#22d3ee" opacity={0.85} />
        )}
        {def.corners.map((c) => {
          const fill = CORNER_FILL[c.kind];
          const isSelected = selectedCorner === c.label;
          const tx = c.x + (c.lx ?? 0);
          const ty = c.y + (c.ly ?? 0);
          const anchor = (c.lx ?? 0) < -15 ? "end" : (c.lx ?? 0) > 15 ? "start" : "middle";
          
          return (
            <g key={c.label}>
              <circle 
                cx={c.x} 
                cy={c.y} 
                r={isSelected ? 7 : 5} 
                fill={fill} 
                stroke={isSelected ? "#22d3ee" : "#0f172a"} 
                strokeWidth={isSelected ? 2 : 1}
                className="cursor-pointer hover:stroke-cyan-400 transition-all duration-200"
                onClick={() => onCornerClick?.(c)}
              />
              {isSelected && (
                <circle 
                  cx={c.x} 
                  cy={c.y} 
                  r={10} 
                  fill="none" 
                  stroke="#22d3ee" 
                  strokeWidth={1}
                  opacity={0.6}
                  className="animate-pulse"
                />
              )}
              <text
                x={tx}
                y={ty}
                fill={isSelected ? "#22d3ee" : "#cbd5e1"}
                fontSize={9}
                fontFamily="system-ui, sans-serif"
                textAnchor={anchor}
                className={`cursor-pointer transition-colors duration-200 ${isSelected ? 'font-bold' : ''}`}
                style={{ paintOrder: "stroke", stroke: "#0c0e14", strokeWidth: 3 }}
                onClick={() => onCornerClick?.(c)}
              >
                {c.label}
              </text>
              {/* Wind direction indicator */}
              {isSelected && c.windDirection !== undefined && (
                <g>
                  <line
                    x1={c.x}
                    y1={c.y}
                    x2={c.x + Math.cos((c.windDirection - 90) * Math.PI / 180) * 15}
                    y2={c.y + Math.sin((c.windDirection - 90) * Math.PI / 180) * 15}
                    stroke="#22d3ee"
                    strokeWidth={2}
                    markerEnd="url(#arrowhead)"
                  />
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="10"
                      markerHeight="7"
                      refX="9"
                      refY="3.5"
                      orient="auto"
                    >
                      <polygon
                        points="0 0, 10 3.5, 0 7"
                        fill="#22d3ee"
                      />
                    </marker>
                  </defs>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-1 sm:gap-2 text-[7px] sm:text-[9px] text-slate-500">
        <span className="inline-flex items-center gap-0.5">
          <span className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-red-400" />
          <span>DF</span>
        </span>
        <span className="inline-flex items-center gap-0.5">
          <span className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-blue-400" />
          <span>Speed</span>
        </span>
        <span className="text-cyan-400 font-medium text-[7px] sm:text-[8px]">
          Tap corners
        </span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/30 px-2 sm:px-3 py-1.5 sm:py-2 ring-1 ring-white/5">
      <dt className="text-[10px] sm:text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-white text-xs sm:text-sm">{value}</dd>
    </div>
  );
}

function AnimatedMetric({
  label,
  value,
  decimals,
  suffix,
}: {
  label: string;
  value: number;
  decimals: number;
  suffix: string;
}) {
  const display = useAnimatedNumber(value, 450);
  const formatted = useMemo(() => `${display.toFixed(decimals)}${suffix}`, [decimals, display, suffix]);
  return <Metric label={label} value={formatted} />;
}

function useAnimatedNumber(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const startValue = valueRef.current;
    const diff = target - startValue;
    if (Math.abs(diff) < 1e-6) {
      return;
    }
    const startTs = performance.now();
    let raf = 0;

    const tick = (ts: number) => {
      const progress = Math.min((ts - startTs) / durationMs, 1);
      const eased = 1 - (1 - progress) ** 3;
      setValue(startValue + diff * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
