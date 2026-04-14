"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const STREAMLINE_COUNT = 864;
const TRAIL_LEN = 25; // Longer trails for smoother appearance
const HUG_GAP = 0.3;
const AIR_REF = 65;
const CAR_MODEL_URL = "/models/car.glb";
const FIT_MAX_EXTENT = 4.2;

useGLTF.preload(CAR_MODEL_URL);

export type CarFitDimensions = {
  halfWidth: number;
  halfHeight: number;
  halfLength: number;
  forwardAxis: "x" | "z";
};

const DEFAULT_CAR_DIMS: CarFitDimensions = {
  halfWidth: 1.1,
  halfHeight: 0.225,
  halfLength: 2.1,
  forwardAxis: "z",
};

// MATHEMATICAL FIX: Force wind tunnel to flow from Nose to Tail based on native orientation
function carToWorld(d: CarFitDimensions, lateral: number, y: number, longitudinal: number): THREE.Vector3 {
  longitudinal = -longitudinal; // This single line flips the entire wind simulation
  
  if (d.forwardAxis === "z") {
    return new THREE.Vector3(lateral, y, longitudinal);
  }
  return new THREE.Vector3(longitudinal, y, lateral);
}

function crv(pts: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(pts);
}

function buildAirflowCurves(d: CarFitDimensions): THREE.CatmullRomCurve3[] {
  const W = d.halfWidth;
  const H = d.halfHeight;
  const L = d.halfLength;
  const g = HUG_GAP * 0.15; // Much tighter to body
  const c = (lat: number, y: number, lng: number) => carToWorld(d, lat, y, lng);

  // Over nose and roof - tight to body
  const noseRoof = crv([
    c(0, H * 0.15, L * 1.3),
    c(0, H * 0.25, L * 0.95),
    c(0, H + g, L * 0.5),
    c(0, H + g, 0),
    c(0, H + g, -L * 0.5),
    c(0, H * 0.6, -L * 0.9),
    c(0, H * 0.4, -L * 1.2),
  ]);

  // Front wing left side - hugs wing then flows under with more reactive elements
  const frontWingPort = crv([
    c(-W * 0.4, -H * 0.85, L * 1.25),
    c(-W * 0.7, -H - g, L * 0.95), // Wider for wing tip vortex
    c(-W * 0.6, -H - g * 0.8, L * 0.6),
    c(-W * 0.5, -H - g * 0.6, L * 0.2),
    c(-W * 0.4, -H - g * 0.4, -L * 0.1),
    c(-W * 0.3, -H * 0.5, -L * 0.5),
    c(-W * 0.2, -H * 0.2, -L * 0.95),
    c(-W * 0.1, -H * 0.1, -L * 1.25),
  ]);

  // Front wing right side - mirror with reactive elements
  const frontWingStarboard = crv([
    c(W * 0.4, -H * 0.85, L * 1.25),
    c(W * 0.7, -H - g, L * 0.95), // Wider for wing tip vortex
    c(W * 0.6, -H - g * 0.8, L * 0.6),
    c(W * 0.5, -H - g * 0.6, L * 0.2),
    c(W * 0.4, -H - g * 0.4, -L * 0.1),
    c(W * 0.3, -H * 0.5, -L * 0.5),
    c(W * 0.2, -H * 0.2, -L * 0.95),
    c(W * 0.1, -H * 0.1, -L * 1.25),
  ]);

  // Sidepod flow - hugs side of car
  const sidepod = crv([
    c(W + g, -H * 0.1, L * 0.95),
    c(W + g, -H * 0.15, L * 0.6),
    c(W + g, -H * 0.2, L * 0.2),
    c(W + g, -H * 0.25, -L * 0.2),
    c(W * 0.85 + g, -H * 0.2, -L * 0.6),
    c(W * 0.7, -H * 0.15, -L * 0.95),
    c(W * 0.5, -H * 0.1, -L * 1.2),
  ]);

  // Floor - very tight under car
  const floor = crv([
    c(0, -H - g * 0.5, L * 1.1),
    c(W * 0.15, -H - g * 0.5, L * 0.6),
    c(-W * 0.15, -H - g * 0.5, L * 0.1),
    c(W * 0.1, -H - g * 0.5, -L * 0.4),
    c(0, -H - g * 0.3, -L * 0.8),
    c(0, -H * 0.4, -L * 1.15),
  ]);

  // Diffuser - accelerates upward at rear
  const diffuser = crv([
    c(W * 0.25, -H - g * 0.4, -L * 0.65),
    c(W * 0.15, -H * 0.7, -L * 0.85),
    c(-W * 0.15, -H * 0.4, -L * 1.05),
    c(W * 0.2, -H * 0.1, -L * 1.35),
    c(0, H * 0.05, -L * 1.75),
    c(0, H * 0.15, -L * 2.2),
  ]);

  // Rear wing - over and around
  const rearWing = crv([
    c(0, H * 0.7, -L * 0.25),
    c(W * 0.15, H + g * 2, -L * 0.55),
    c(0, H + g * 2.5, -L * 0.8),
    c(-W * 0.15, H + g * 2, -L * 1.05),
    c(0, H * 0.5, -L * 1.35),
    c(0, H * 0.2, -L * 1.75),
    c(0, 0, -L * 2.2),
  ]);

  // Wake - turbulent behind car
  const wake = crv([
    c(0, H * 0.3, -L * 0.85),
    c(W * 0.35, -H * 0.15, -L * 1.15),
    c(-W * 0.45, H * 0.25, -L * 1.55),
    c(W * 0.3, -H * 0.35, -L * 2.05),
    c(-W * 0.2, H * 0.1, -L * 2.6),
    c(0, 0, -L * 3.2),
  ]);

  // NEW: Front wheel turbulence - left
  const frontWheelLeft = crv([
    c(-W * 0.7, -H * 0.6, L * 0.7),
    c(-W * 0.75, -H * 0.4, L * 0.5),
    c(-W * 0.8, -H * 0.2, L * 0.3),
    c(-W * 0.85, 0, L * 0.1),
    c(-W * 0.9, H * 0.2, -L * 0.1),
    c(-W * 0.8, H * 0.1, -L * 0.4),
    c(-W * 0.6, 0, -L * 0.8),
  ]);

  // NEW: Front wheel turbulence - right
  const frontWheelRight = crv([
    c(W * 0.7, -H * 0.6, L * 0.7),
    c(W * 0.75, -H * 0.4, L * 0.5),
    c(W * 0.8, -H * 0.2, L * 0.3),
    c(W * 0.85, 0, L * 0.1),
    c(W * 0.9, H * 0.2, -L * 0.1),
    c(W * 0.8, H * 0.1, -L * 0.4),
    c(W * 0.6, 0, -L * 0.8),
  ]);

  // NEW: Rear wheel turbulence - left
  const rearWheelLeft = crv([
    c(-W * 0.6, -H * 0.5, -L * 0.3),
    c(-W * 0.7, -H * 0.3, -L * 0.5),
    c(-W * 0.8, -H * 0.1, -L * 0.7),
    c(-W * 0.9, H * 0.1, -L * 0.9),
    c(-W * 0.85, H * 0.3, -L * 1.2),
    c(-W * 0.7, H * 0.2, -L * 1.5),
    c(-W * 0.5, 0, -L * 1.8),
  ]);

  // NEW: Rear wheel turbulence - right
  const rearWheelRight = crv([
    c(W * 0.6, -H * 0.5, -L * 0.3),
    c(W * 0.7, -H * 0.3, -L * 0.5),
    c(W * 0.8, -H * 0.1, -L * 0.7),
    c(W * 0.9, H * 0.1, -L * 0.9),
    c(W * 0.85, H * 0.3, -L * 1.2),
    c(W * 0.7, H * 0.2, -L * 1.5),
    c(W * 0.5, 0, -L * 1.8),
  ]);

  // NEW: More incoming wind streams
  const incomingHigh = crv([
    c(0, H * 0.8, L * 1.6),
    c(W * 0.1, H * 0.7, L * 1.3),
    c(-W * 0.1, H * 0.6, L * 1.0),
    c(0, H * 0.5, L * 0.7),
    c(0, H * 0.4, L * 0.4),
    c(0, H * 0.3, 0),
    c(0, H * 0.2, -L * 0.5),
  ]);

  const incomingMid = crv([
    c(W * 0.3, 0, L * 1.8),
    c(W * 0.25, -H * 0.1, L * 1.4),
    c(W * 0.2, -H * 0.2, L * 1.0),
    c(W * 0.15, -H * 0.3, L * 0.6),
    c(W * 0.1, -H * 0.4, L * 0.2),
    c(W * 0.05, -H * 0.5, -L * 0.2),
    c(0, -H * 0.6, -L * 0.8),
  ]);

  const incomingLow = crv([
    c(-W * 0.2, -H * 0.9, L * 1.5),
    c(-W * 0.15, -H * 0.85, L * 1.2),
    c(-W * 0.1, -H * 0.8, L * 0.8),
    c(-W * 0.05, -H * 0.75, L * 0.4),
    c(0, -H * 0.7, 0),
    c(W * 0.05, -H * 0.65, -L * 0.4),
    c(W * 0.1, -H * 0.6, -L * 0.9),
  ]);

  return [
    noseRoof, frontWingPort, frontWingStarboard, sidepod, floor, diffuser, rearWing, wake,
    frontWheelLeft, frontWheelRight, rearWheelLeft, rearWheelRight, // Wheel turbulence
    incomingHigh, incomingMid, incomingLow // More incoming wind
  ];
}

const StreamRegion = {
  Top: 0,
  Sidepod: 1,
  Floor: 2,
  Diffuser: 3,
  Front: 4,
  Wake: 5,
  WheelFront: 6,
  WheelRear: 7,
  Incoming: 8,
} as const;
type StreamRegionNum = (typeof StreamRegion)[keyof typeof StreamRegion];

type StreamState = {
  curveId: Uint8Array;
  region: Uint8Array;
  side: Int8Array;
  shell: Float32Array;
  lateralJitter: Float32Array;
  progress: Float32Array;
};
type WindEffectLevel = "low" | "medium" | "high";

function _hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function initStreamState(): StreamState {
  const curveId = new Uint8Array(STREAMLINE_COUNT);
  const region = new Uint8Array(STREAMLINE_COUNT);
  const side = new Int8Array(STREAMLINE_COUNT);
  const shell = new Float32Array(STREAMLINE_COUNT);
  const lateralJitter = new Float32Array(STREAMLINE_COUNT);
  const progress = new Float32Array(STREAMLINE_COUNT);

  let i = 0;
  const seedShell = (idx: number, lo: number, hi: number) => {
    shell[idx] = lo + _hash01(idx * 17) * (hi - lo);
  };
  const seedLat = (idx: number, scale: number) => {
    lateralJitter[idx] = (_hash01(idx * 31) - 0.5) * 2 * scale;
  };

  const assignBlock = (
    count: number,
    r: StreamRegionNum,
    cid: number,
    shellLo: number,
    shellHi: number,
    latScale: number,
  ) => {
    for (let k = 0; k < count; k++, i++) {
      curveId[i] = cid;
      region[i] = r;
      side[i] = 0;
      seedShell(i, shellLo, shellHi);
      seedLat(i, latScale);
      progress[i] = _hash01(i * 7) * 0.97;
    }
  };

  // Top/roof - dense over body
  assignBlock(140, StreamRegion.Top, 0, 0.08, 0.85, 0.1);
  assignBlock(70, StreamRegion.Top, 6, 0.15, 0.88, 0.08);
  
  // Sidepods - medium density along sides
  assignBlock(120, StreamRegion.Sidepod, 3, 0.02, 0.5, 0.045);
  for (let j = i - 120; j < i; j++) {
    side[j] = j % 2 === 0 ? 1 : -1;
  }
  
  // Floor - very dense under car
  assignBlock(100, StreamRegion.Floor, 4, 0.0, 0.25, 0.035);
  
  // Diffuser - concentrated at rear underside
  assignBlock(90, StreamRegion.Diffuser, 5, 0.0, 0.2, 0.028);

  // Front wings - dense around wing elements with more reactive flow
  for (let k = 0; k < 40; k++, i++) {
    curveId[i] = 1; region[i] = StreamRegion.Front; side[i] = 0;
    seedShell(i, 0.005, 0.25); seedLat(i, 0.008);
    progress[i] = _hash01(i * 11) * 0.96;
  }
  for (let k = 0; k < 40; k++, i++) {
    curveId[i] = 2; region[i] = StreamRegion.Front; side[i] = 0;
    seedShell(i, 0.005, 0.25); seedLat(i, 0.008);
    progress[i] = _hash01(i * 19) * 0.96;
  }

  // NEW: Extra reactive front wing flows
  for (let k = 0; k < 30; k++, i++) {
    curveId[i] = 1; region[i] = StreamRegion.Front; side[i] = 0;
    seedShell(i, 0.25, 0.45); seedLat(i, 0.015); // Higher shell for upper wing elements
    progress[i] = _hash01(i * 13) * 0.94;
  }
  for (let k = 0; k < 30; k++, i++) {
    curveId[i] = 2; region[i] = StreamRegion.Front; side[i] = 0;
    seedShell(i, 0.25, 0.45); seedLat(i, 0.015);
    progress[i] = _hash01(i * 17) * 0.94;
  }

  // Wake - turbulent, more chaotic
  assignBlock(100, StreamRegion.Wake, 7, 0.1, 0.95, 0.15);

  // NEW: Front wheel turbulence
  for (let k = 0; k < 25; k++, i++) {
    curveId[i] = 8; region[i] = StreamRegion.WheelFront; side[i] = 0;
    seedShell(i, 0.05, 0.4); seedLat(i, 0.08);
    progress[i] = _hash01(i * 23) * 0.94;
  }
  for (let k = 0; k < 25; k++, i++) {
    curveId[i] = 9; region[i] = StreamRegion.WheelFront; side[i] = 0;
    seedShell(i, 0.05, 0.4); seedLat(i, 0.08);
    progress[i] = _hash01(i * 29) * 0.94;
  }

  // NEW: Rear wheel turbulence
  for (let k = 0; k < 20; k++, i++) {
    curveId[i] = 10; region[i] = StreamRegion.WheelRear; side[i] = 0;
    seedShell(i, 0.08, 0.45); seedLat(i, 0.1);
    progress[i] = _hash01(i * 31) * 0.92;
  }
  for (let k = 0; k < 20; k++, i++) {
    curveId[i] = 11; region[i] = StreamRegion.WheelRear; side[i] = 0;
    seedShell(i, 0.08, 0.45); seedLat(i, 0.1);
    progress[i] = _hash01(i * 37) * 0.92;
  }

  // NEW: More incoming wind streams
  for (let k = 0; k < 30; k++, i++) {
    curveId[i] = 12; region[i] = StreamRegion.Incoming; side[i] = 0;
    seedShell(i, 0.1, 0.7); seedLat(i, 0.06);
    progress[i] = _hash01(i * 41) * 0.98;
  }
  for (let k = 0; k < 25; k++, i++) {
    curveId[i] = 13; region[i] = StreamRegion.Incoming; side[i] = 0;
    seedShell(i, 0.05, 0.6); seedLat(i, 0.05);
    progress[i] = _hash01(i * 43) * 0.98;
  }
  for (let k = 0; k < 25; k++, i++) {
    curveId[i] = 14; region[i] = StreamRegion.Incoming; side[i] = 0;
    seedShell(i, 0.03, 0.5); seedLat(i, 0.04);
    progress[i] = _hash01(i * 47) * 0.98;
  }

  while (i < STREAMLINE_COUNT) {
    curveId[i] = 7; region[i] = StreamRegion.Wake;
    seedShell(i, 0.15, 0.88); seedLat(i, 0.1);
    progress[i] = _hash01(i) * 0.95;
    i++;
  }

  return { curveId, region, side, shell, lateralJitter, progress };
}

const _tmpUp = new THREE.Vector3();
const _tmpSide = new THREE.Vector3();
const _tmpNorm = new THREE.Vector3();
const _tmpLocal = new THREE.Vector3();
const _tmpSeg = new THREE.Vector3();
const _col = new THREE.Color();

function worldToCarLocal(p: THREE.Vector3, d: CarFitDimensions, out: THREE.Vector3): void {
  if (d.forwardAxis === "z") {
    out.set(p.x, p.y, p.z);
  } else {
    out.set(p.z, p.y, p.x);
  }
}

function hullDistance(local: THREE.Vector3, W: number, H: number, L: number): number {
  const { x, y, z } = local;
  const ix = W - Math.abs(x);
  const iy = H - Math.abs(y);
  const iz = L - Math.abs(z);
  const inside = ix >= 0 && iy >= 0 && iz >= 0;
  if (inside) return -Math.min(ix, iy, iz);
  const dx = Math.max(Math.abs(x) - W, 0);
  const dy = Math.max(Math.abs(y) - H, 0);
  const dz = Math.max(Math.abs(z) - L, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cfdVelocityColor(mag: number, target: THREE.Color): void {
  // Realistic CFD color mapping: Blue (low velocity) → Red (high velocity)
  const t = THREE.MathUtils.clamp(mag, 0, 1.0);
  
  // CFD-style velocity color map (like in the reference image)
  const darkBlue = new THREE.Color(0.0, 0.0, 0.5);    // Very low velocity (stagnation)
  const blue = new THREE.Color(0.0, 0.4, 1.0);        // Low velocity
  const cyan = new THREE.Color(0.0, 0.8, 1.0);        // Low-medium velocity
  const green = new THREE.Color(0.0, 1.0, 0.5);       // Medium velocity
  const yellow = new THREE.Color(1.0, 1.0, 0.0);      // Medium-high velocity
  const orange = new THREE.Color(1.0, 0.5, 0.0);      // High velocity
  const red = new THREE.Color(1.0, 0.0, 0.0);         // Very high velocity
  
  // Smooth transitions between CFD colors
  if (t < 0.1) {
    // Stagnation zone - very dark blue
    target.copy(darkBlue).lerp(blue, t / 0.1);
  } else if (t < 0.25) {
    // Low velocity - blue to cyan
    target.copy(blue).lerp(cyan, (t - 0.1) / 0.15);
  } else if (t < 0.45) {
    // Medium-low velocity - cyan to green
    target.copy(cyan).lerp(green, (t - 0.25) / 0.2);
  } else if (t < 0.65) {
    // Medium velocity - green to yellow
    target.copy(green).lerp(yellow, (t - 0.45) / 0.2);
  } else if (t < 0.85) {
    // High velocity - yellow to orange
    target.copy(yellow).lerp(orange, (t - 0.65) / 0.2);
  } else {
    // Very high velocity - orange to red
    target.copy(orange).lerp(red, (t - 0.85) / 0.15);
  }
}

function sampleStreamlinePosition(
  curves: THREE.CatmullRomCurve3[],
  st: StreamState,
  idx: number,
  t: number,
  d: CarFitDimensions,
  elapsed: number,
  pos: THREE.Vector3,
  tan: THREE.Vector3,
  airSpeed: number,
  windVelocity: number,
  windEffectMultiplier: number,
  windAngle: number = 0,
  windDirection: number = 0,
  turnDirection: "left" | "right" | "straight" = "straight",
  drsActive: boolean = false,
): void {
  const cid = st.curveId[idx];
  const curve = curves[cid];
  const angleNorm = THREE.MathUtils.clamp(windAngle / 30, -1, 1);
  const crosswind = THREE.MathUtils.clamp(Math.abs(windAngle) / 30, 0, 1);
  // Variables kept for potential future wind angle features
  curve.getPoint(t, pos);
  curve.getTangent(t, tan).normalize();

  _tmpUp.set(0, 1, 0);
  _tmpSide.crossVectors(_tmpUp, tan);
  if (_tmpSide.lengthSq() < 1e-6) _tmpSide.set(1, 0, 0);
  _tmpSide.normalize();
  _tmpNorm.crossVectors(tan, _tmpSide).normalize();

  const shell = st.shell[idx];
  const latJ = st.lateralJitter[idx];
  const reg = st.region[idx] as StreamRegionNum;
  const speedBoost = THREE.MathUtils.clamp(airSpeed / AIR_REF, 0.85, 1.9);
  const windVelocityBoost = THREE.MathUtils.clamp(windVelocity / 20, 0.35, 2.2);
  // Separate concepts: angle controls direction/interaction, velocity controls intensity.
  const windIntensity = speedBoost * windVelocityBoost * windEffectMultiplier;

  let nOff = shell * 0.28; // Tighter to body
  let sOff = latJ * (reg === StreamRegion.Top ? 0.95 : reg === StreamRegion.Wake ? 1.2 : 0.7);
  sOff *= 1 + windIntensity * 0.2;
  nOff *= 1 + windIntensity * 0.08;

  if (reg === StreamRegion.Floor || reg === StreamRegion.Diffuser) {
    nOff = shell * 0.12 + 0.008; // Very tight under floor
    sOff *= 0.45;
  }
  if (reg === StreamRegion.Front) {
    nOff = shell * 0.08 + 0.008; // Tight around front wing
    sOff *= 0.25;
  }
  if (reg === StreamRegion.Sidepod) {
    nOff = shell * 0.15 + 0.01; // Hug sidepod contour
    sOff *= 0.5;
  }
  if (reg === StreamRegion.WheelFront || reg === StreamRegion.WheelRear) {
    nOff = shell * 0.2 + 0.02; // Turbulent around wheels
    sOff *= 0.8;
  }
  if (reg === StreamRegion.Incoming) {
    nOff = shell * 0.35 + 0.05; // Spread out incoming flow
    sOff *= 1.1;
  }

  // Preserve longitudinal baseline so wind-angle logic cannot push forward/backward.
  const zBaseline = pos.z;
  const tanZBaseline = tan.z;
  const xBaseline = pos.x;

  // DRS creates completely different simulation based on real F1 aerodynamics
  if (!drsActive) {
    // DRS ACTIVE - Rear wing flap open (78% drag reduction, 53% downforce reduction)
    if (reg === StreamRegion.Wake) {
      // Much cleaner, narrower wake with DRS open
      pos.x *= 0.4; // Dramatically reduced wake width (78% drag reduction)
      pos.y *= 0.3; // Much less vertical turbulence
      // Smoother, laminar flow behind car
      const cleanWake = Math.sin(elapsed * 1.5 + idx * 0.15) * 0.05;
      pos.x += cleanWake;
      pos.y += cleanWake * 0.3;
    }
    
    else if (reg === StreamRegion.Diffuser) {
      // Enhanced ground effect with reduced rear wing interference
      pos.y -= 0.3; // More aggressive downward flow
      pos.x *= 0.6; // Tighter, more efficient flow
      // Less wake interference allows better diffuser performance
      pos.y += Math.sin(elapsed * 2.2 + idx * 0.25) * 0.1;
    }
    
    else if (reg === StreamRegion.Top) {
      // Smoother roof flow with open DRS flap
      pos.y += 0.2; // Higher, smoother flow over car
      pos.x *= 0.7; // Less lateral spread
      // Reduced pressure differential over roof
      pos.y += Math.sin(elapsed * 1.8 + idx * 0.2) * 0.08;
    }
    
    else if (reg === StreamRegion.Front) {
      // Front wing works more efficiently with less rear interference
      pos.y -= 0.1; // Slightly more downward flow
      pos.x *= 0.9; // Tighter flow around front wing
    }
  } else {
    // DRS CLOSED - High downforce configuration with turbulent wake
    if (reg === StreamRegion.Wake) {
      // Large, turbulent wake with closed DRS
      pos.x += Math.sin(elapsed * 5.0 + idx * 0.8) * 0.6; // Wide turbulent wake
      pos.y += Math.cos(elapsed * 4.5 + idx * 0.7) * 0.5; // Strong vertical turbulence
      // Vortex shedding from rear wing
      pos.x += Math.sin(elapsed * 7.0 + idx * 1.0) * 0.4;
      pos.y += Math.cos(elapsed * 6.5 + idx * 0.9) * 0.3;
      
      // STRONG UPWARD WIND from rear wing/spoiler when DRS closed
      const rearWingZ = -d.halfLength * 0.8; // Rear wing position
      if (pos.z <= rearWingZ && pos.z >= rearWingZ - 1.0) { // Behind rear wing
        // Strong upward airflow from spoiler effect
        pos.y += 0.8; // Strong upward wind
        pos.x += Math.sin(elapsed * 4.0 + idx * 0.6) * 0.3; // Turbulent upward flow
        // Spoiler creates vertical wind streams
        pos.y += Math.sin(elapsed * 5.0 + idx * 0.8) * 0.4;
      }
    }
    
    else if (reg === StreamRegion.Top) {
      // Complex roof flow with high downforce rear wing
      pos.y += 0.05; // Lower flow over car
      pos.x += Math.sin(elapsed * 4.0 + idx * 0.6) * 0.25; // More lateral turbulence
      // Pressure buildup from rear wing
      pos.y += Math.cos(elapsed * 3.5 + idx * 0.5) * 0.15;
      
      // ADDITIONAL UPWARD STREAMS from rear spoiler
      const rearWingZ = -d.halfLength * 0.8;
      if (pos.z <= rearWingZ) { // Behind rear wing
        pos.y += 0.6; // Extra upward wind from spoiler
        pos.y += Math.sin(elapsed * 6.0 + idx * 0.9) * 0.3; // Pulsating upward flow
      }
    }
    
    else if (reg === StreamRegion.Diffuser) {
      // Diffuser performance reduced by rear wing wake interference
      pos.y -= 0.15; // Less aggressive ground effect
      pos.x *= 0.85; // Slightly wider flow
      // Wake interference effects
      pos.y += Math.sin(elapsed * 3.8 + idx * 0.55) * 0.2;
    }
  }

  // Wind angle creates incident wind at proper angle - wind hits car from specified direction
  if (Math.abs(windAngle) > 0.01) {
    // Convert wind angle to radians for proper trigonometric rotation
    const windAngleRad = (windAngle * Math.PI) / 180;
    const cosAngle = Math.cos(windAngleRad);
    const sinAngle = Math.sin(windAngleRad);
    
    // Store original position before rotation
    const origX = pos.x;
    const origZ = pos.z;
    
    // Rotate the entire airflow field around the car to create incident wind angle
    // This makes wind come from the specified angle and hit the car properly
    pos.x = origX * cosAngle - origZ * sinAngle;
    pos.z = origX * sinAngle + origZ * cosAngle;
    
    // Also rotate the tangent vector for proper flow direction
    const origTanX = tan.x;
    const origTanZ = tan.z;
    tan.x = origTanX * cosAngle - origTanZ * sinAngle;
    tan.z = origTanX * sinAngle + origTanZ * cosAngle;
  }

  pos.addScaledVector(_tmpNorm, nOff);
  pos.addScaledVector(_tmpSide, sOff);

  if (st.side[idx] !== 0 && cid === 3) {
    if (d.forwardAxis === "z") pos.x *= st.side[idx];
    else pos.z *= st.side[idx];
  }

  // Apply wind direction rotation ONLY for corner selection (not wind angle slider)
  // This rotates the entire flow field to simulate different track orientations
  if (windDirection !== 0) {
    const windRad = (windDirection * Math.PI) / 180;
    const cosWind = Math.cos(windRad);
    const sinWind = Math.sin(windRad);
    
    // Store original position for reference
    const origX = pos.x;
    const origZ = pos.z;
    
    // Rotate position around Y axis - this simulates the track orientation
    pos.x = origX * cosWind - origZ * sinWind;
    pos.z = origX * sinWind + origZ * cosWind;
    
    // Rotate tangent as well for proper flow direction
    const origTanX = tan.x;
    const origTanZ = tan.z;
    tan.x = origTanX * cosWind - origTanZ * sinWind;
    tan.z = origTanX * sinWind + origTanZ * cosWind;
  }

  // Enhanced cornering effects - creates distinct aerodynamic behavior for each turn
  if (turnDirection !== "straight") {
    const corneringForce = turnDirection === "left" ? -1 : 1;
    const corneringIntensity = 0.4 + windIntensity * 0.2; // More intense with higher speeds
    
    // Lateral aerodynamic effects during cornering - varies by region
    const lateralEffect = corneringForce * corneringIntensity * shell;
    if (reg === StreamRegion.Front) {
      // Front wing creates strong lateral flow in turns
      pos.x += lateralEffect * 0.8;
      pos.y += Math.abs(lateralEffect) * 0.3; // Upwash in turns
    } else if (reg === StreamRegion.Sidepod) {
      // Sidepods experience strong lateral pressure
      pos.x += lateralEffect * 1.2;
      pos.y += lateralEffect * 0.2; // Slight vertical displacement
    } else if (reg === StreamRegion.Wake || reg === StreamRegion.Diffuser) {
      // Wake becomes asymmetric in turns
      pos.x += lateralEffect * 0.9;
      pos.y += Math.sin(elapsed * 3.5 + idx * 0.7) * Math.abs(lateralEffect) * 0.4;
    } else {
      pos.x += lateralEffect * 0.6;
    }
    
    // Yaw-induced flow changes - creates realistic cornering aerodynamics
    const yawEffect = corneringForce * 0.25 * (1 + windIntensity * 0.15);
    const lateralPosition = xBaseline / Math.max(d.halfWidth, 1e-6);
    
    // Flow attachment/separation effects in corners
    if (Math.abs(lateralPosition) > 0.5) {
      // Outer side experiences flow separation
      const separationEffect = Math.sign(lateralPosition) * corneringForce;
      pos.z += separationEffect * yawEffect * 0.4;
      pos.y += Math.abs(separationEffect) * yawEffect * 0.3;
    }
    
    // Enhanced wheel turbulence during cornering
    if (reg === StreamRegion.WheelFront || reg === StreamRegion.WheelRear) {
      const wheelTurbulence = corneringForce * 0.6 * shell * (1 + windIntensity * 0.3);
      pos.x += wheelTurbulence;
      pos.y += Math.abs(wheelTurbulence) * 0.4;
      
      // Tire slip effects
      const slipPhase = elapsed * 4.2 + idx * 0.83;
      pos.x += Math.sin(slipPhase) * Math.abs(wheelTurbulence) * 0.3;
      pos.z += Math.cos(slipPhase) * wheelTurbulence * 0.2;
    }
  }

  if (reg === StreamRegion.Wake) {
    const amp = Math.max(0.035, d.halfLength * 0.045) * (1 + windIntensity * 0.24);
    const ph = elapsed * 4.8 + idx * 0.67;
    pos.x += Math.sin(ph) * amp * (0.5 + shell * 0.7);
    pos.y += Math.cos(ph * 1.13) * amp * 0.48;
    pos.z += Math.sin(ph * 0.83 + 1.9) * amp * 0.42;
    pos.addScaledVector(_tmpSide, Math.sin(ph * 2.1) * amp * 0.3);
  } else if (reg === StreamRegion.Diffuser) {
    const amp = Math.max(0.018, d.halfLength * 0.022) * (1 + windIntensity * 0.16);
    const ph = elapsed * 3.2 + idx * 0.47;
    pos.x += Math.sin(ph) * amp * 0.85;
    pos.y += Math.cos(ph * 0.95) * amp * 0.38;
  } else if (reg === StreamRegion.Floor) {
    // Minimal turbulence under floor - smooth laminar flow
    const amp = Math.max(0.008, d.halfLength * 0.01);
    const ph = elapsed * 2.1 + idx * 0.31;
    pos.y += Math.sin(ph) * amp * 0.25;
  } else if (reg === StreamRegion.WheelFront || reg === StreamRegion.WheelRear) {
    // Strong wheel turbulence - rotating vortices with tire collision avoidance
    const amp = Math.max(0.045, d.halfLength * 0.06) * (1 + windIntensity * 0.28);
    const ph = elapsed * 8.5 + idx * 0.89; // Faster rotation
    
    // Check if we're too close to tire center and deflect around it
    worldToCarLocal(pos, d, _tmpLocal);
    const wheelZ = reg === StreamRegion.WheelFront ? d.halfLength * 0.5 : -d.halfLength * 0.5;
    const wheelX = st.side[idx] !== 0 ? st.side[idx] * d.halfWidth * 0.75 : (cid === 8 || cid === 10) ? -d.halfWidth * 0.75 : d.halfWidth * 0.75;
    const distToWheel = Math.sqrt(
      Math.pow(_tmpLocal.x - wheelX, 2) + 
      Math.pow(_tmpLocal.z - wheelZ, 2)
    );
    const tireRadius = d.halfHeight * 0.4;
    
    if (distToWheel < tireRadius * 1.2) {
      // Deflect around tire instead of through it
      const deflectAngle = Math.atan2(_tmpLocal.x - wheelX, _tmpLocal.z - wheelZ);
      pos.x += Math.cos(deflectAngle) * amp * 0.8;
      pos.z += Math.sin(deflectAngle) * amp * 0.6;
      pos.y += Math.sin(ph * 2.2) * amp * 0.5; // Vertical deflection over/under tire
    } else {
      // Normal turbulence when away from tire
      pos.x += Math.sin(ph) * amp * (0.8 + shell * 0.6);
      pos.y += Math.cos(ph * 1.3) * amp * 0.7;
      pos.z += Math.sin(ph * 0.7 + 3.1) * amp * 0.5;
    }
    
    // Circular motion around wheel
    pos.addScaledVector(_tmpSide, Math.cos(ph * 1.8) * amp * 0.6);
    pos.addScaledVector(_tmpNorm, Math.sin(ph * 1.8) * amp * 0.4);
  } else if (reg === StreamRegion.Front) {
    // Enhanced front wing reactivity - multiple wing elements
    const amp = Math.max(0.025, d.halfLength * 0.035) * (1 + windIntensity * 0.2);
    const ph = elapsed * 6.2 + idx * 0.73; // Faster response
    pos.x += Math.sin(ph) * amp * 0.6;
    pos.y += Math.cos(ph * 1.4) * amp * 0.8; // Strong vertical deflection
    pos.z += Math.sin(ph * 0.9 + 2.3) * amp * 0.4;
    // Wing tip vortices
    pos.addScaledVector(_tmpSide, Math.sin(ph * 2.8) * amp * 0.7);
    pos.addScaledVector(_tmpNorm, Math.cos(ph * 1.6) * amp * 0.5);
  } else if (reg === StreamRegion.Incoming) {
    // Gentle incoming flow variation
    const amp = Math.max(0.012, d.halfLength * 0.015);
    const ph = elapsed * 1.8 + idx * 0.23;
    pos.x += Math.sin(ph) * amp * 0.3;
    pos.y += Math.cos(ph * 0.8) * amp * 0.2;
  }

  // CRITICAL: Preserve longitudinal position at the very end to prevent forward/backward movement from wind angle
  // This ensures that ONLY lateral (X) and vertical (Y) effects are applied, never longitudinal (Z) movement
  if (windDirection === 0) { // Only preserve baseline for wind angle slider, not corner wind direction
    pos.z = zBaseline;
    tan.z = tanZBaseline;
    tan.normalize();
  }

  // Intentionally no additional angle blocks here to keep z-axis stable.
}

function velocityMagnitudeForVertex(
  worldPos: THREE.Vector3,
  d: CarFitDimensions,
  shell: number,
  tan: THREE.Vector3,
  trailPhase: number,
  airSpeed: number,
): number {
  worldToCarLocal(worldPos, d, _tmpLocal);
  const W = d.halfWidth;
  const H = d.halfHeight;
  const L = d.halfLength;
  const dist = hullDistance(_tmpLocal, W, H, L);
  
  // Realistic CFD-based velocity field calculation
  const speedFactor = THREE.MathUtils.clamp(airSpeed / AIR_REF, 0.3, 2.0);
  
  // 1. STAGNATION ZONE (Front of car) - Very low velocity (blue)
  if (_tmpLocal.z > L * 0.6) {
    const stagnationIntensity = (_tmpLocal.z - L * 0.6) / (L * 0.4);
    const stagnationRadius = Math.sqrt(_tmpLocal.x * _tmpLocal.x + _tmpLocal.y * _tmpLocal.y) / Math.max(W, H);
    
    if (stagnationRadius < 1.2) {
      // Direct stagnation point - nearly zero velocity
      const stagnationFactor = Math.exp(-stagnationRadius * 2) * stagnationIntensity;
      return THREE.MathUtils.clamp(0.05 + (1 - stagnationFactor) * 0.15, 0, 0.2);
    }
  }
  
  // 2. ACCELERATION ZONES (Around car sides) - High velocity (yellow/orange)
  const lateralDist = Math.abs(_tmpLocal.x);
  if (lateralDist > W * 0.8 && lateralDist < W * 1.5 && _tmpLocal.z > -L * 0.2 && _tmpLocal.z < L * 0.6) {
    // Flow acceleration around car body (Bernoulli effect)
    const accelerationFactor = 1.0 - Math.abs(lateralDist - W * 1.1) / (W * 0.4);
    const bodyProximity = Math.exp(-(lateralDist - W) / (W * 0.3));
    return THREE.MathUtils.clamp(0.6 + accelerationFactor * 0.4 + bodyProximity * 0.3, 0.4, 1.0) * speedFactor;
  }
  
  // 3. WAKE REGION (Behind car) - Complex recirculation patterns
  if (_tmpLocal.z < -L * 0.1) {
    const wakeDistance = Math.abs(_tmpLocal.z + L * 0.1) / (L * 0.9);
    const lateralWakePos = Math.abs(_tmpLocal.x) / W;
    const verticalWakePos = Math.abs(_tmpLocal.y) / H;
    
    // Near-wake recirculation (low velocity, turbulent)
    if (wakeDistance < 0.3 && lateralWakePos < 1.2 && verticalWakePos < 1.5) {
      const recirculationIntensity = (0.3 - wakeDistance) / 0.3;
      const turbulentMixing = Math.sin(_tmpLocal.x * 8) * Math.cos(_tmpLocal.y * 6) * 0.1;
      return THREE.MathUtils.clamp(0.2 + recirculationIntensity * 0.3 + turbulentMixing, 0.1, 0.5) * speedFactor;
    }
    
    // Far-wake recovery (gradually increasing velocity)
    else if (wakeDistance < 1.0) {
      const recoveryFactor = (wakeDistance - 0.3) / 0.7;
      const wakeDeficit = Math.exp(-lateralWakePos * 2) * (1 - recoveryFactor);
      return THREE.MathUtils.clamp(0.7 - wakeDeficit * 0.4, 0.3, 0.8) * speedFactor;
    }
  }
  
  // 4. UNDERBODY FLOW (Ground effect) - Accelerated flow
  if (_tmpLocal.y < -H * 0.3 && _tmpLocal.z > -L * 0.8 && _tmpLocal.z < L * 0.3) {
    const groundProximity = Math.abs(_tmpLocal.y + H * 0.3) / (H * 0.7);
    const venturiEffect = Math.exp(-groundProximity * 3); // Venturi acceleration
    const diffuserExpansion = _tmpLocal.z < -L * 0.3 ? Math.abs(_tmpLocal.z + L * 0.3) / (L * 0.5) : 0;
    
    return THREE.MathUtils.clamp(0.5 + venturiEffect * 0.4 + diffuserExpansion * 0.3, 0.4, 0.9) * speedFactor;
  }
  
  // 5. UPPER SURFACE FLOW (Over car body) - Moderate acceleration
  if (_tmpLocal.y > H * 0.2 && _tmpLocal.z > -L * 0.5 && _tmpLocal.z < L * 0.5) {
    const roofProximity = Math.abs(_tmpLocal.y - H * 0.5) / (H * 0.8);
    const roofAcceleration = Math.exp(-roofProximity * 2);
    return THREE.MathUtils.clamp(0.4 + roofAcceleration * 0.3, 0.3, 0.7) * speedFactor;
  }
  
  // 6. FREE STREAM (Far from car) - Undisturbed flow
  if (dist > Math.max(W, H, L) * 1.5) {
    return THREE.MathUtils.clamp(0.6, 0.5, 0.8) * speedFactor;
  }
  
  // 7. BOUNDARY LAYER (Very close to car surface) - Very low velocity
  if (dist <= 0) {
    const boundaryLayerThickness = Math.min(W, H, L) * 0.1;
    const wallDistance = Math.abs(dist) / boundaryLayerThickness;
    const boundaryProfile = Math.min(wallDistance * wallDistance, 1.0); // Quadratic boundary layer profile
    return THREE.MathUtils.clamp(boundaryProfile * 0.3, 0.02, 0.3) * speedFactor;
  }
  
  // Default case - transition regions
  const transitionVelocity = 0.4 + shell * 0.2 + trailPhase * 0.1;
  return THREE.MathUtils.clamp(transitionVelocity, 0.2, 0.8) * speedFactor;
}

function StreamlineField({ 
  airSpeed, 
  windVelocity,
  windEffectMultiplier,
  windAngle = 0,
  layerMode = "base",
  carDims, 
  windDirection = 0,
  turnDirection = "straight",
  drsActive = false
}: { 
  airSpeed: number; 
  windVelocity: number;
  windEffectMultiplier: number;
  windAngle?: number;
  layerMode?: "base" | "yaw";
  carDims: CarFitDimensions;
  windDirection?: number;
  turnDirection?: "left" | "right" | "straight";
  drsActive?: boolean;
}) {
  const curves = useMemo(() => buildAirflowCurves(carDims), [carDims]);
  const lineRef = useRef<THREE.LineSegments>(null);
  const stateRef = useRef<StreamState>(initStreamState());
  const historyRef = useRef(new Float32Array(STREAMLINE_COUNT * TRAIL_LEN * 3));
  const primedRef = useRef(new Uint8Array(STREAMLINE_COUNT));

  const segVerts = STREAMLINE_COUNT * (TRAIL_LEN - 1) * 2;
  const linePos = useMemo(() => new Float32Array(segVerts * 3), [segVerts]);
  const lineCol = useMemo(() => new Float32Array(segVerts * 3), [segVerts]);

  const scratchPos = useRef(new THREE.Vector3());
  const scratchTan = useRef(new THREE.Vector3());

  useEffect(() => {
    stateRef.current = initStreamState();
    historyRef.current = new Float32Array(STREAMLINE_COUNT * TRAIL_LEN * 3);
    primedRef.current = new Uint8Array(STREAMLINE_COUNT);
  }, [carDims.halfWidth, carDims.halfHeight, carDims.halfLength, carDims.forwardAxis]);

  useFrame((state, delta) => {
    const lines = lineRef.current;
    if (!lines) return;

    const geom = lines.geometry as THREE.BufferGeometry;
    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geom.getAttribute("color") as THREE.BufferAttribute;

    const st = stateRef.current;
    const hist = historyRef.current;
    const elapsed = state.clock.elapsedTime;
    const speedFactor = Math.max(0.1, airSpeed / AIR_REF);
    const baseAdvance = 0.175 * speedFactor;

    const pos = scratchPos.current;
    const tan = scratchTan.current;

    for (let i = 0; i < STREAMLINE_COUNT; i++) {
      const jitter = 0.9 + _hash01(i * 41) * 0.14;
      let t1 = st.progress[i] + delta * baseAdvance * jitter;
      const wrapped = t1 >= 1;
      if (wrapped) t1 -= 1;
      st.progress[i] = t1;

      sampleStreamlinePosition(
        curves,
        st,
        i,
        t1,
        carDims,
        elapsed,
        pos,
        tan,
        airSpeed,
        windVelocity,
        windEffectMultiplier,
        windAngle,  // Wind angle slider for lateral crosswind effects
        windDirection, // Wind direction for corner orientation
        turnDirection,
        drsActive, // DRS state
      );

      if (layerMode === "yaw" && Math.abs(windAngle) > 0.01) {
        const crosswindIntensity = Math.abs(windAngle) / 30;
        const windSide = windAngle > 0 ? 1 : -1;
        const jitterPhase = elapsed * 3.0 + i * 0.25;
        
        // Enhanced crosswind aerodynamic effects
        if (st.region[i] === StreamRegion.Wake) {
          // Asymmetric wake with vortex shedding
          const wakeDeflection = windSide * crosswindIntensity * 0.8;
          const vortexShedding = Math.sin(jitterPhase * 2.2) * crosswindIntensity * 0.4;
          pos.x += wakeDeflection + vortexShedding;
          pos.y += Math.cos(jitterPhase * 1.8) * crosswindIntensity * 0.3;
          
          // Chaotic turbulence in crosswind wake
          pos.x += Math.sin(jitterPhase * 3.5 + crosswindIntensity * 5) * 0.2;
          pos.y += Math.cos(jitterPhase * 2.9 + crosswindIntensity * 3) * 0.15;
        }
        
        else if (st.region[i] === StreamRegion.Sidepod) {
          // Pressure differential between windward/leeward sides
          const isWindwardSide = (st.side[i] * windSide) > 0;
          if (isWindwardSide) {
            // High pressure side - compressed flow
            pos.x += windSide * crosswindIntensity * 0.3;
            pos.y -= crosswindIntensity * 0.1;
          } else {
            // Low pressure side - flow separation
            pos.x += windSide * crosswindIntensity * 0.7;
            pos.y += crosswindIntensity * 0.4 * Math.sin(jitterPhase * 2.5);
          }
        }
        
        else if (st.region[i] === StreamRegion.Front) {
          // Stagnation point shift and corner flow acceleration
          pos.x += windSide * crosswindIntensity * 0.4;
          pos.y += crosswindIntensity * 0.2 * Math.sin(jitterPhase * 3.0);
          
          // Corner vortices
          if (Math.abs(st.lateralJitter[i]) > 0.2) {
            const cornerVortex = crosswindIntensity * 0.3 * Math.sign(st.lateralJitter[i]);
            pos.x += cornerVortex * Math.cos(jitterPhase * 4.0);
            pos.y += Math.abs(cornerVortex) * Math.sin(jitterPhase * 4.0);
          }
        }
        
        else if (st.region[i] === StreamRegion.Top) {
          // Roof flow and A-pillar vortices
          pos.x += windSide * crosswindIntensity * 0.5;
          pos.y += crosswindIntensity * 0.25;
          
          // A-pillar vortex
          const pillarVortex = crosswindIntensity * 0.2;
          pos.x += Math.sin(jitterPhase * 4.5) * pillarVortex * windSide;
          pos.y += Math.cos(jitterPhase * 4.5) * pillarVortex;
        }
        
        else {
          // General crosswind deflection
          pos.x += windSide * crosswindIntensity * 0.2;
          pos.y += crosswindIntensity * 0.1 * Math.sin(jitterPhase);
        }
      }

      const hb = i * TRAIL_LEN * 3;
      if (!primedRef.current[i]) {
        primedRef.current[i] = 1;
        for (let k = 0; k < TRAIL_LEN; k++) {
          hist[hb + k * 3] = pos.x;
          hist[hb + k * 3 + 1] = pos.y;
          hist[hb + k * 3 + 2] = pos.z;
        }
      } else if (wrapped) {
        for (let k = 0; k < TRAIL_LEN; k++) {
          hist[hb + k * 3] = pos.x;
          hist[hb + k * 3 + 1] = pos.y;
          hist[hb + k * 3 + 2] = pos.z;
        }
      } else {
        for (let k = TRAIL_LEN - 1; k >= 1; k--) {
          hist[hb + k * 3] = hist[hb + (k - 1) * 3];
          hist[hb + k * 3 + 1] = hist[hb + (k - 1) * 3 + 1];
          hist[hb + k * 3 + 2] = hist[hb + (k - 1) * 3 + 2];
        }
        hist[hb] = pos.x;
        hist[hb + 1] = pos.y;
        hist[hb + 2] = pos.z;
      }
    }

    let vi = 0;
    for (let i = 0; i < STREAMLINE_COUNT; i++) {
      const hb = i * TRAIL_LEN * 3;
      const sh = st.shell[i];
      for (let k = 0; k < TRAIL_LEN - 1; k++) {
        const ax = hist[hb + k * 3], ay = hist[hb + k * 3 + 1], az = hist[hb + k * 3 + 2];
        const bx = hist[hb + (k+1) * 3], by = hist[hb + (k+1) * 3 + 1], bz = hist[hb + (k+1) * 3 + 2];

        _tmpSeg.set(bx - ax, by - ay, bz - az);
        const segLen = Math.max(_tmpSeg.length(), 1e-6);
        _tmpSeg.multiplyScalar(1 / segLen);

        const mag0 = velocityMagnitudeForVertex(_tmpNorm.set(ax, ay, az), carDims, sh, _tmpSeg, k / (TRAIL_LEN - 1) * 0.35, airSpeed);
        const mag1 = velocityMagnitudeForVertex(_tmpNorm.set(bx, by, bz), carDims, sh, _tmpSeg, (k+1) / (TRAIL_LEN - 1) * 0.35, airSpeed);

        cfdVelocityColor(mag0, _col);
        linePos[vi * 3] = ax; linePos[vi * 3 + 1] = ay; linePos[vi * 3 + 2] = az;
        lineCol[vi * 3] = _col.r; lineCol[vi * 3 + 1] = _col.g; lineCol[vi * 3 + 2] = _col.b;
        vi++;

        cfdVelocityColor(mag1, _col);
        linePos[vi * 3] = bx; linePos[vi * 3 + 1] = by; linePos[vi * 3 + 2] = bz;
        lineCol[vi * 3] = _col.r; lineCol[vi * 3 + 1] = _col.g; lineCol[vi * 3 + 2] = _col.b;
        vi++;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    const mat = lines.material as THREE.LineBasicMaterial;
    const baseOpacity = THREE.MathUtils.lerp(0.72, 0.95, THREE.MathUtils.clamp((airSpeed - 50) / 35, 0, 1));
    mat.opacity = layerMode === "yaw" ? baseOpacity * 0.55 : baseOpacity;
  });

  return (
    <lineSegments ref={lineRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        <bufferAttribute attach="attributes-color" args={[lineCol, 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

function CarLoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[2, 0.4, 3.5]} />
      <meshStandardMaterial color="#334155" wireframe />
    </mesh>
  );
}

function CarModel({ color, onFitted }: { color: string; onFitted?: (dims: CarFitDimensions) => void }) {
  // Fallback: Use simple box geometry instead of GLB model
  const meshRef = useRef<THREE.Mesh>(null);
  
  useLayoutEffect(() => {
    if (meshRef.current) {
      // Set up car dimensions for the box
      const fittedSize = new THREE.Vector3(4.2, 0.45, 2.1);
      const hx = fittedSize.x / 2, hy = fittedSize.y / 2, hz = fittedSize.z / 2;
      onFitted?.({
        halfWidth: hx,
        halfHeight: hy,
        halfLength: hz,
        forwardAxis: "z",
      });
    }
  }, [onFitted]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[4.2, 0.45, 2.1]} />
      <meshStandardMaterial color={color} metalness={0.4} roughness={0.35} />
    </mesh>
  );
}

function VehicleGroup({ 
  color, 
  airSpeed, 
  windVelocity,
  windEffectMultiplier,
  windAngle = 0,
  windDirection = 0,
  turnDirection = "straight",
  drsActive = false
}: { 
  color: string; 
  airSpeed: number;
  windVelocity: number;
  windEffectMultiplier: number;
  windAngle?: number;
  windDirection?: number;
  turnDirection?: "left" | "right" | "straight";
  drsActive?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [carDims, setCarDims] = useState<CarFitDimensions>(DEFAULT_CAR_DIMS);

  return (
    <group ref={groupRef}>
      <Suspense fallback={<CarLoadingFallback />}>
        <CarModel color={color} onFitted={setCarDims} />
      </Suspense>
      <StreamlineField 
        airSpeed={airSpeed} 
        windVelocity={windVelocity}
        windEffectMultiplier={windEffectMultiplier}
        windAngle={windAngle}
        layerMode="base"
        carDims={carDims} 
        windDirection={windDirection}
        turnDirection={turnDirection}
        drsActive={drsActive}
      />
      {Math.abs(windAngle) > 0.01 && (
        <StreamlineField 
          airSpeed={airSpeed}
          windVelocity={windVelocity}
          windEffectMultiplier={windEffectMultiplier}
          windAngle={windAngle}
          layerMode="yaw"
        carDims={carDims} 
        windDirection={windDirection}
        turnDirection={turnDirection}
        drsActive={drsActive}
        />
      )}
    </group>
  );
}

function SceneContent({ 
  color, 
  airSpeed, 
  windVelocity,
  windEffectMultiplier,
  windAngle = 0,
  windDirection = 0,
  turnDirection = "straight",
  drsActive = false
}: { 
  color: string; 
  airSpeed: number;
  windVelocity: number;
  windEffectMultiplier: number;
  windAngle?: number;
  windDirection?: number;
  turnDirection?: "left" | "right" | "straight";
  drsActive?: boolean;
}) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <VehicleGroup 
        color={color} 
        airSpeed={airSpeed} 
        windVelocity={windVelocity}
        windEffectMultiplier={windEffectMultiplier}
        windAngle={windAngle}
        windDirection={windDirection}
        turnDirection={turnDirection}
        drsActive={drsActive}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#1a1d24" />
      </mesh>
      <gridHelper args={[40, 40, "#334155", "#1e293b"]} position={[0, -0.34, 0]} />
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={4} maxDistance={18} />
      <Environment preset="city" />
    </>
  );
}

export type CarViewerProps = { 
  color: string; 
  airSpeed: number; 
  windAngle?: number;
  carSpeed?: number;
  windEffect?: WindEffectLevel;
  drsActive?: boolean;
  windDirection?: number;
  turnDirection?: "left" | "right" | "straight";
  selectedCorner?: string;
  currentTrack?: string;
  currentTeam?: string;
};

export default function CarViewer({ 
  color, 
  airSpeed, 
  windAngle = 0,
  carSpeed = 280,
  windEffect = "high",
  drsActive = false,
  windDirection = 0,
  turnDirection = "straight",
  selectedCorner = "",
  currentTrack = "",
  currentTeam = ""
}: CarViewerProps) {
  // Dynamic aerodynamic calculations based on real F1 physics
  const calculateDynamicAero = (drsState: boolean) => {
    // Base values for straight-line aerodynamics
    let dragCoeff = 0.30;
    let ldRatio = 3.8;
    let downforce = 3200;
    let groundEffect = 60;
    let wingBalanceFront = 35;
    let wingBalanceRear = 65;
    let drsReduction = 15;
    let vortexStrength = "Medium";
    
    // TEAM-SPECIFIC AERODYNAMIC PACKAGES
    switch (currentTeam.toLowerCase()) {
      case "red bull":
        dragCoeff = 0.28; // Best efficiency
        ldRatio = 4.1; // Highest L/D ratio
        downforce = 3400; // High downforce
        groundEffect = 62; // Advanced ground effect
        wingBalanceFront = 36;
        wingBalanceRear = 64;
        break;
      case "ferrari":
        dragCoeff = 0.31; // Moderate efficiency
        ldRatio = 3.9;
        downforce = 3300;
        groundEffect = 61;
        wingBalanceFront = 35;
        wingBalanceRear = 65;
        break;
      case "mclaren":
        dragCoeff = 0.29; // Good efficiency
        ldRatio = 4.0;
        downforce = 3350;
        groundEffect = 61;
        wingBalanceFront = 37; // More front-biased
        wingBalanceRear = 63;
        break;
      case "mercedes":
        dragCoeff = 0.30;
        ldRatio = 3.8;
        downforce = 3250; // Lower downforce, less drag
        groundEffect = 59;
        wingBalanceFront = 34;
        wingBalanceRear = 66;
        break;
      case "aston martin":
        dragCoeff = 0.32;
        ldRatio = 3.6;
        downforce = 3150;
        groundEffect = 58;
        wingBalanceFront = 33;
        wingBalanceRear = 67;
        break;
      case "alpine":
        dragCoeff = 0.33;
        ldRatio = 3.5;
        downforce = 3100;
        groundEffect = 57;
        wingBalanceFront = 32;
        wingBalanceRear = 68;
        break;
    }
    
    // TRACK-SPECIFIC AERODYNAMIC SETUPS
    switch (currentTrack.toLowerCase()) {
      case "monaco":
        // Maximum downforce setup for tight corners
        dragCoeff *= 1.15; // +15% drag for max downforce
        ldRatio *= 0.88; // -12% efficiency
        downforce *= 1.22; // +22% maximum downforce
        groundEffect = Math.min(70, groundEffect + 8);
        wingBalanceFront += 3; // More front downforce
        wingBalanceRear -= 3;
        drsReduction = 10; // Less effective at low speeds
        break;
      case "monza":
        // Minimum drag setup for high speeds
        dragCoeff *= 0.85; // -15% drag
        ldRatio *= 1.12; // +12% efficiency
        downforce *= 0.78; // -22% less downforce
        groundEffect = Math.max(50, groundEffect - 8);
        wingBalanceFront -= 2; // Less front downforce
        wingBalanceRear += 2;
        drsReduction = 20; // Very effective at high speeds
        break;
      case "silverstone":
        // Balanced setup for mixed corners
        dragCoeff *= 0.95; // -5% drag
        ldRatio *= 1.05; // +5% efficiency
        downforce *= 1.08; // +8% moderate downforce
        groundEffect += 2;
        drsReduction = 16;
        break;
      case "suzuka":
        // High-speed balanced setup
        dragCoeff *= 0.92; // -8% drag
        ldRatio *= 1.08; // +8% efficiency
        downforce *= 1.05; // +5% downforce
        groundEffect += 3;
        wingBalanceFront += 1;
        wingBalanceRear -= 1;
        drsReduction = 17;
        break;
      case "spa":
        // Medium-low drag for long straights
        dragCoeff *= 0.88; // -12% drag
        ldRatio *= 1.10; // +10% efficiency
        downforce *= 0.95; // -5% downforce
        groundEffect += 1;
        drsReduction = 18;
        break;
    }
    
    // Speed-based adjustments (downforce increases with speed squared)
    const speedFactor = Math.pow(airSpeed / 65, 2);
    downforce = Math.round(downforce * speedFactor);
    
    // Vortex strength based on speed and track
    const baseVortex = currentTrack.toLowerCase() === "monaco" ? 0.7 : 
                      currentTrack.toLowerCase() === "monza" ? 1.3 : 1.0;
    const vortexLevel = (airSpeed / 65) * baseVortex;
    
    if (vortexLevel > 1.2) vortexStrength = "Very High";
    else if (vortexLevel > 0.9) vortexStrength = "High";
    else if (vortexLevel > 0.6) vortexStrength = "Medium";
    else vortexStrength = "Low";
    
    // Turn direction effects
    if (turnDirection === "left") {
      downforce = Math.round(downforce * 1.18); // +18% more downforce in left turns
      dragCoeff = dragCoeff * 1.12; // +12% more drag
      ldRatio = ldRatio * 0.95; // Less efficient
      groundEffect = Math.min(75, groundEffect + 5); // More ground effect in turns
      wingBalanceFront = Math.min(42, wingBalanceFront + 2); // More front downforce for stability
      wingBalanceRear = Math.max(58, wingBalanceRear - 2);
    } else if (turnDirection === "right") {
      downforce = Math.round(downforce * 1.15); // +15% more downforce
      dragCoeff = dragCoeff * 1.08; // +8% more drag
      ldRatio = ldRatio * 0.97; // Slightly less efficient
      groundEffect = Math.min(75, groundEffect + 5);
      wingBalanceFront = Math.min(40, wingBalanceFront + 1);
      wingBalanceRear = Math.max(60, wingBalanceRear - 1);
    }
    
    // Corner-specific aerodynamic adjustments
    if (selectedCorner) {
      if (selectedCorner.includes("130R") || selectedCorner.includes("Copse") || selectedCorner.includes("Raidillon")) {
        // High-speed corners - low drag, high efficiency setup
        downforce = Math.round(downforce * 0.85); // -15% downforce for less drag
        dragCoeff = dragCoeff * 0.92; // -8% drag coefficient
        ldRatio = ldRatio * 1.08; // +8% more efficient
        drsReduction = Math.min(22, drsReduction + 3); // More effective DRS
        groundEffect = Math.max(45, groundEffect - 5); // Less ground effect reliance
      } 
      else if (selectedCorner.includes("Loews") || selectedCorner.includes("Spoon") || selectedCorner.includes("Casino")) {
        // Slow, tight corners - maximum downforce setup
        downforce = Math.round(downforce * 1.25); // +25% maximum downforce
        dragCoeff = dragCoeff * 1.18; // +18% more drag (price of downforce)
        ldRatio = ldRatio * 0.88; // -12% less efficient
        drsReduction = Math.max(8, drsReduction - 4); // Less effective at low speeds
        groundEffect = Math.min(75, groundEffect + 8); // More ground effect
        wingBalanceFront = Math.min(42, wingBalanceFront + 3); // More front downforce
        wingBalanceRear = Math.max(58, wingBalanceRear - 3);
      }
      else if (selectedCorner.includes("Maggots") || selectedCorner.includes("S-curves") || selectedCorner.includes("Eau Rouge")) {
        // Complex/medium speed corners - balanced setup
        downforce = Math.round(downforce * 1.05); // +5% moderate increase
        dragCoeff = dragCoeff * 1.02; // +2% slight drag increase
        ldRatio = ldRatio * 1.01; // +1% slightly more efficient
        drsReduction = drsReduction; // Standard DRS effectiveness
      }
      else if (selectedCorner.includes("Parabolica") || selectedCorner.includes("Pouhon") || selectedCorner.includes("Lesmo")) {
        // Long sweeping corners - sustained downforce
        downforce = Math.round(downforce * 1.12); // +12% sustained downforce
        dragCoeff = dragCoeff * 1.06; // +6% drag
        ldRatio = ldRatio * 0.94; // -6% efficiency
        groundEffect = Math.min(72, groundEffect + 4);
      }
    }
    
    // Wind angle effects on aerodynamics (from slider - lateral crosswind only)
    const windAngleEffect = Math.abs(windAngle) / 30; // 0 to 1 based on wind angle (max 30°)
    if (windAngleEffect > 0.3) { // Significant crosswind
      dragCoeff = dragCoeff * (1 + windAngleEffect * 0.15); // Crosswind increases drag
      ldRatio = ldRatio * (1 - windAngleEffect * 0.1); // Reduces efficiency
      downforce = Math.round(downforce * (1 - windAngleEffect * 0.08)); // Slightly less effective
    }
    
    // Wind direction effects (from corner selection - track orientation)
    const windDirectionEffect = Math.abs(windDirection) / 180; // 0 to 1 based on wind direction
    if (windDirectionEffect > 0.2) { // Significant wind direction change
      // This represents different track orientations and corner approaches
      dragCoeff = dragCoeff * (1 + windDirectionEffect * 0.08); // Different approach angles
      ldRatio = ldRatio * (1 - windDirectionEffect * 0.05); // Slight efficiency change
    }
    
    // DRS effects on aerodynamics
    if (drsState) {
      // DRS CLOSED - High downforce, high drag
      dragCoeff = dragCoeff * 1.25; // +25% more drag with closed DRS
      downforce = Math.round(downforce * 1.35); // +35% more downforce
      ldRatio = ldRatio * 0.85; // -15% efficiency (more drag per downforce)
      groundEffect = Math.min(75, groundEffect + 5); // Better ground effect
      drsReduction = 0; // No DRS reduction when closed
    } else {
      // DRS OPEN - Low drag, low downforce  
      dragCoeff = dragCoeff * 0.75; // -25% drag reduction with open DRS
      downforce = Math.round(downforce * 0.65); // -35% less downforce
      ldRatio = ldRatio * 1.15; // +15% better efficiency
      groundEffect = Math.max(45, groundEffect - 3); // Slightly less ground effect
      drsReduction = 25; // 25% drag reduction when open
    }
    
    // Ensure realistic F1 ranges
    wingBalanceFront = Math.max(30, Math.min(45, wingBalanceFront));
    wingBalanceRear = 100 - wingBalanceFront;
    groundEffect = Math.max(45, Math.min(75, groundEffect));
    drsReduction = Math.max(8, Math.min(25, drsReduction));
    
    return {
      dragCoeff: dragCoeff.toFixed(2),
      ldRatio: ldRatio.toFixed(1),
      downforce: Math.max(1500, Math.min(5000, downforce)), // Realistic F1 range
      groundEffect: `${Math.round(groundEffect)}%`,
      wingBalance: `${Math.round(wingBalanceFront)}F/${Math.round(wingBalanceRear)}R`,
      drsReduction: `-${Math.round(drsReduction)}%`,
      vortexStrength: vortexStrength
    };
  };
  
  const aeroData = calculateDynamicAero(drsActive);
  
  // DRS affects simulation air speed
  let drsAirSpeedMultiplier = 1.0;
  if (drsActive) {
    // DRS CLOSED - More complex airflow, higher effective air speed
    drsAirSpeedMultiplier = 1.15; // +15% more complex airflow
  } else {
    // DRS OPEN - Cleaner airflow, lower effective air speed
    drsAirSpeedMultiplier = 0.85; // -15% cleaner airflow
  }
  
  const simulationAirSpeed = ((carSpeed / 3.6) * 0.65 + airSpeed * 0.35) * drsAirSpeedMultiplier;
  const windEffectMultiplier =
    windEffect === "low" ? 0.85 : windEffect === "medium" ? 1.2 : 1.7;
  
  // DRS affects wind effect intensity
  let drsWindEffectMultiplier = windEffectMultiplier;
  if (drsActive) {
    // DRS CLOSED - More intense wind effects due to turbulence
    drsWindEffectMultiplier = windEffectMultiplier * 1.25; // +25% more intense
  } else {
    // DRS OPEN - Less intense wind effects due to smoother flow
    drsWindEffectMultiplier = windEffectMultiplier * 0.8; // -20% less intense
  }
  
  // DRS affects wind velocity and airflow patterns
  let drsWindMultiplier = 1.0;
  if (drsActive) {
    // DRS CLOSED - More turbulent, higher velocity airflow
    drsWindMultiplier = 1.3; // +30% more turbulent airflow
  } else {
    // DRS OPEN - Smoother, lower velocity airflow
    drsWindMultiplier = 0.7; // -30% smoother airflow
  }
  
  const windVelocity = THREE.MathUtils.clamp(
    (6 + simulationAirSpeed * 0.22) * drsWindEffectMultiplier * drsWindMultiplier,
    2,
    55,
  );

  return (
    <div className="relative h-full w-full min-h-[280px] sm:min-h-[320px] lg:min-h-[400px] rounded-xl bg-[#0f1117] ring-1 ring-white/10 overflow-hidden">
      <Canvas 
        shadows 
        camera={{ position: [0, 2, 10], fov: 45 }} 
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: false }} 
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%' }}
      >
        <SceneContent 
          key={`wind-simulation-${Math.floor(windAngle / 5) * 5}-${windDirection}-${turnDirection}-${drsActive ? 'closed' : 'open'}`} 
          color={color} 
          airSpeed={simulationAirSpeed}
          windVelocity={windVelocity}
          windEffectMultiplier={drsWindEffectMultiplier}
          windAngle={windAngle}
          windDirection={windDirection}
          turnDirection={turnDirection}
          drsActive={drsActive}
        />
      </Canvas>
      
      {/* Wind Direction Indicator */}
      {Math.abs(windAngle) > 2 && (
        <div className="absolute top-1/2 left-2 transform -translate-y-1/2 pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm rounded-full p-2 ring-1 ring-cyan-500/30">
            <div className="relative w-8 h-8">
              <div 
                className="absolute inset-0 flex items-center justify-center text-cyan-400 text-xs font-bold"
                style={{
                  transform: `rotate(${windAngle}deg)`
                }}
              >
                ↑
              </div>
              <div className="absolute inset-0 border border-cyan-500/30 rounded-full"></div>
              <div className="absolute top-0 left-1/2 w-0.5 h-1 bg-cyan-500/50 transform -translate-x-1/2"></div>
            </div>
            <div className="text-[8px] text-cyan-400 text-center mt-1">
              {Math.abs(windAngle)}°{windAngle > 0 ? 'R' : 'L'}
            </div>
          </div>
        </div>
      )}

      {/* F1 Aerodynamic Knowledge Overlay - Compact for mobile */}
      <div className="absolute top-2 left-2 pointer-events-none">
        <div className="bg-black/70 backdrop-blur-sm rounded-md p-1.5 lg:p-2 ring-1 ring-white/10 max-w-[140px] lg:max-w-none">
          <h3 className="text-[9px] lg:text-xs font-semibold text-white mb-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse"></span>
            F1 Aero Live
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 text-[8px] lg:text-[10px]">
            <div className="text-slate-300">
              <span className="text-slate-400">Drag:</span> {aeroData.dragCoeff}
            </div>
            <div className="text-slate-300">
              <span className="text-slate-400">L/D:</span> {aeroData.ldRatio}
            </div>
            <div className="text-slate-300">
              <span className="text-slate-400">GE:</span> {aeroData.groundEffect}
            </div>
            <div className="text-slate-300">
              <span className="text-slate-400">Balance:</span> {aeroData.wingBalance}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time CFD Data Overlay - Compact bottom */}
      <div className="absolute bottom-2 left-2 right-2 pointer-events-none">
        <div className="bg-black/70 backdrop-blur-sm rounded-md p-1.5 lg:p-2 ring-1 ring-white/10">
          <div className="grid grid-cols-4 gap-1 lg:gap-2 text-[8px] lg:text-[10px]">
            <div className="text-center">
              <div className="text-slate-400">Speed</div>
              <div className="text-white font-semibold text-[9px] lg:text-xs">{airSpeed.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-slate-400">Wind A</div>
              <div className="text-white font-semibold text-[9px] lg:text-xs">{windAngle.toFixed(0)}°</div>
            </div>
            <div className="text-center">
              <div className="text-slate-400">Wind V</div>
              <div className="text-white font-semibold text-[9px] lg:text-xs">{windVelocity.toFixed(1)}</div>
            </div>
            <div className="text-center">
              <div className="text-slate-400">DF</div>
              <div className="text-white font-semibold text-[9px] lg:text-xs">{Math.round(aeroData.downforce/100)/10}k</div>
            </div>
          </div>
          {selectedCorner && (
            <div className="mt-1 pt-1 border-t border-white/20 text-center">
              <div className="text-cyan-400 font-semibold text-[9px] lg:text-[10px]">{selectedCorner}</div>
            </div>
          )}
        </div>
      </div>

      {/* Flow Legend - Minimal top right */}
      <div className="absolute top-2 right-2 pointer-events-none">
        <div className="bg-black/70 backdrop-blur-sm rounded-md p-1 lg:p-1.5 ring-1 ring-white/10">
          <div className="text-[7px] lg:text-[9px] text-slate-300 space-y-0.5">
            <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-400 rounded"></div>
              <span>Slow</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-gradient-to-r from-green-400 to-yellow-400 rounded"></div>
              <span>Med</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-0.5 bg-gradient-to-r from-orange-400 to-red-500 rounded"></div>
              <span>Fast</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}