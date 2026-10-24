export type RuntimeMode = 'auto' | 'wasm' | 'ts-js';
export type EffectCategory = 'lipstick' | 'mascara' | 'eyeliner' | 'eyeshadow' | 'blush' | 'foundation';
export type Finish = 'matte' | 'glossy' | 'shimmer' | 'glitter' | 'dewy';

export interface MakeupFrame {
  timestampNs: bigint | number;
  width: number;
  height: number;
  pixelFormat?: 'RGBA8' | 'BGRA8';
  orientation?: 0 | 90 | 180 | 270;
  mirrored?: boolean;
  data: ArrayBuffer | ArrayBufferView;
}

export interface TrackingResult {
  timestampNs?: bigint | number;
  faceCount: number;
  confidence?: number;
  landmarks?: { lips?: Array<{ x: number; y: number }> };
}

export interface MakeupSdkOptions {
  runtime?: RuntimeMode;
  wasmFactory?: (options: MakeupSdkOptions) => Promise<unknown>;
  camera: { start(callback: (frame: MakeupFrame) => void): Promise<number>; stop(): Promise<number> };
  tracker: { initialize(version: number): Promise<number>; estimate(frame: MakeupFrame): Promise<TrackingResult>; reset(): Promise<number>; dispose(): Promise<number> };
  renderer: { initialize(version: number): Promise<number>; render(frame: MakeupFrame, tracking: TrackingResult, layers: Record<string, unknown>): Promise<number>; capture(): Promise<unknown>; dispose(): Promise<number> };
  resources: { loadManifest(version: number): Promise<number>; loadPattern(id: number, version: number): Promise<number>; release(version: number): Promise<number> };
}

export function create(options: MakeupSdkOptions): Promise<unknown>;
export function normalizeFinish(finish: Finish): Exclude<Finish, 'dewy'>;
export function runMiniProgramProbe(options: MakeupSdkOptions & { device?: Record<string, string> }): Promise<Record<string, unknown>>;
