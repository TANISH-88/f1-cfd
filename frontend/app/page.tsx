"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import CFDPanel, { type PredictResponse, type WindEffectLevel } from "@/components/CFDPanel";

const CarViewer = dynamic(() => import("@/components/CarViewer"), { ssr: false });

const DEFAULT_COLOR = "#e10600";
/** Default until first `/predict`; matches typical surrogate mid-range. */
const DEFAULT_AIR_SPEED = 65;

export default function Home() {
  const [carColor, setCarColor] = useState(DEFAULT_COLOR);
  const [airSpeed, setAirSpeed] = useState(DEFAULT_AIR_SPEED);
  const [windDirection, setWindDirection] = useState(0);
  const [turnDirection, setTurnDirection] = useState<"left" | "right" | "straight">("straight");
  const [selectedCorner, setSelectedCorner] = useState<string>("");
  const [currentTrack, setCurrentTrack] = useState<string>("");
  const [currentTeam, setCurrentTeam] = useState<string>("");
  const [simWindAngle] = useState(0); // Wind angle removed but keeping for future use
  const [simCarSpeed, setSimCarSpeed] = useState(280);
  const [simWindEffect, setSimWindEffect] = useState<WindEffectLevel>("high");
  const [simDrsActive, setSimDrsActive] = useState(true);
  const [lastPrediction, setLastPrediction] = useState<PredictResponse | null>(null);

  const onPredict = useCallback((data: PredictResponse) => {
    setCarColor(data.color);
    setAirSpeed(data.air_speed);
    setLastPrediction(data); // Store the full prediction data
  }, []);

  const onCornerSelect = useCallback((
    windDir: number,
    turnDir: "left" | "right" | "straight",
    cornerName: string
  ) => {
    // Set wind direction for corner orientation, turn direction for aerodynamics
    setWindDirection(windDir);
    setTurnDirection(turnDir);
    setSelectedCorner(cornerName);
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0d12] text-slate-100">
      <header className="border-b border-white/10 px-3 py-2 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        <h1 className="text-lg sm:text-xl lg:text-2xl font-semibold tracking-tight text-white">F1 CFD lab</h1>
        <p className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs lg:text-sm text-slate-400">
          <span className="hidden sm:inline">(:</span>
          <span className="sm:hidden">Interactive F1 aerodynamics</span>
        </p>
        {selectedCorner && (
          <p className="mt-0.5 sm:mt-1 text-[9px] sm:text-xs text-cyan-400">
            <span className="hidden sm:inline">Simulating: <span className="font-medium">{selectedCorner}</span> - Wind: {windDirection}° - Turn: {turnDirection}</span>
            <span className="sm:hidden font-medium">{selectedCorner} - {windDirection}°</span>
          </p>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-3 py-2 sm:px-4 sm:py-6 lg:px-6 lg:py-8">
        {/* Mobile: Stack vertically with proper heights, Desktop: Side by side */}
        <div className="flex flex-col lg:grid lg:grid-cols-[1fr_380px] gap-3 lg:gap-6 h-[calc(100vh-120px)]">
          {/* 3D Visualization - Show first on mobile for better UX */}
          <div className="order-1 lg:order-1 flex-1 min-h-[280px] sm:min-h-[320px] lg:min-h-0">
            <CarViewer 
              color={carColor} 
              airSpeed={airSpeed} 
              windAngle={simWindAngle}
              carSpeed={simCarSpeed}
              windEffect={simWindEffect}
              drsActive={simDrsActive}
              windDirection={windDirection}
              turnDirection={turnDirection}
              selectedCorner={selectedCorner}
              currentTrack={currentTrack}
              currentTeam={currentTeam}
              predictionData={lastPrediction} // Pass prediction results
            />
          </div>
          {/* Controls Panel - Show second on mobile */}
          <div className="order-2 lg:order-2 flex-shrink-0">
            <CFDPanel 
              onResult={onPredict} 
              onControlsChange={({ carSpeed, windEffect, drsActive }) => {
                setSimCarSpeed(carSpeed);
                setSimWindEffect(windEffect);
                setSimDrsActive(drsActive);
              }}
              onCornerSelect={onCornerSelect}
              onTrackChange={setCurrentTrack}
              onTeamChange={setCurrentTeam}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
