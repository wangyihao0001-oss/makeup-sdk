export type RuntimeMode = 'auto' | 'wasm' | 'ts-js';
export type EffectCategory = 'lipstick' | 'mascara' | 'eyeliner' | 'eyeshadow' | 'blush' | 'foundation';
export type Finish = 'matte' | 'glossy' | 'shimmer' | 'glitter' | 'dewy';
export type SdkState = 'idle' | 'loading' | 'ready' | 'tracking' | 'rendering' | 'captured' | 'unsupported' | 'error' | 'disposed';
export type SdkEventType = 'stateChanged' | 'operationCompleted' | 'frameRejected' | 'resourceProgress' | 'trackingStatus' | 'error' | 'performance';
export const STATUS: Readonly<Record<string, number>>;
export const STATE: Readonly<Record<string, SdkState>>;
export const EFFECT: Readonly<Record<string, EffectCategory>>;
export const FINISH: Readonly<Record<string, Exclude<Finish, 'dewy'>>>;
export const EVENT: Readonly<Record<string, SdkEventType>>;

export interface MakeupFrame { timestampNs: bigint | number; width: number; height: number; pixelFormat?: 'RGBA8' | 'BGRA8'; orientation?: 0 | 90 | 180 | 270; mirrored?: boolean; data: ArrayBuffer | ArrayBufferView; }
export interface TrackingResult { timestampNs?: bigint | number; faceCount: number; confidence?: number; landmarks?: { lips?: Array<{ x: number; y: number }> }; }
export interface EffectParams { category: EffectCategory; patternId?: number | bigint | null; argb: number; intensity: number; finish?: Finish | null; }
export interface UpstreamPattern { number: number; id: number | string; file: string; bundled: boolean; colorable: boolean; }
export interface MorphControl { target: string; about: string; }
export interface ApplyResult { status: number; operationId: number; params: Omit<EffectParams, 'finish'> & { finish: Exclude<Finish, 'dewy'> }; }
export interface ClearResult { status: number; operationId: number; category?: EffectCategory; }
export interface CaptureMetadata { timestampNs: bigint | number; width: number; height: number; orientation: number; mirrored: boolean; sdkVersion: string; manifestVersion: number; rendererVersion: number; }
export interface CaptureResult extends CaptureMetadata { path?: string; metadata: CaptureMetadata; layers: Record<string, EffectParams>; }
export interface CapabilityReport { platform: string; runtime: RuntimeMode; sdkVersion: string; apiVersion: number; manifestVersion: number; modelVersion?: number; rendererVersion?: number; rendererBackend: string; trackerBackend: string; maxFrameWidth: number; maxFrameHeight: number; cameraAvailable: boolean; trackerAvailable: boolean; rendererAvailable: boolean; supportsEffects: Record<EffectCategory, boolean>; knownLimitations: string[]; wasmVersion?: string | null; wasmSha256?: string | null; wasmLoadStatus?: string; }
export interface SdkEvent { type: SdkEventType; sdkVersion: string; manifestVersion: number; operationId: number; category?: EffectCategory; status: number; timestamp: number; state?: SdkState; params?: EffectParams; tracking?: TrackingResult; error?: unknown; }

export interface WasmManifest { sdkVersion: string; apiVersion: number; wasmVersion: string; manifestVersion: number; artifact: string; size: number; sha256: string; exports: string[]; }
export interface WasmLoadRequest { url: string; manifest: WasmManifest; options: MakeupSdkConfig; }
export interface MakeupSdkConfig {
  sdkVersion?: string; manifestVersion?: number; modelVersion?: number; rendererVersion?: number; resourceBaseUrl?: string; runtime?: RuntimeMode;
  maxFrameWidth?: number; maxFrameHeight?: number; wasmFactory?: (options: MakeupSdkConfig) => Promise<unknown>; wasmUrl?: string; wasmManifest?: WasmManifest | string; wasmManifestUrl?: string;
  wasmLoader?: (request: WasmLoadRequest) => Promise<ArrayBuffer | ArrayBufferView>; wasmManifestLoader?: (request: { url: string; options: MakeupSdkConfig }) => Promise<WasmManifest | string>;
  wasmSha256?: string; wasmVersion?: string; sha256?: (bytes: ArrayBuffer) => Promise<string> | string; wasmImports?: WebAssembly.Imports;
  camera: { start(callback: (frame: MakeupFrame) => void): Promise<number>; stop(): Promise<number> };
  tracker: { initialize(version: number): Promise<number>; estimate(frame: MakeupFrame): Promise<TrackingResult>; reset(): Promise<number>; dispose(): Promise<number> };
  renderer: { initialize(version: number): Promise<number>; render(frame: MakeupFrame, tracking: TrackingResult, layers: Record<string, unknown>): Promise<number>; capture(): Promise<unknown>; dispose(): Promise<number> };
  resources: { loadManifest(version: number): Promise<number>; loadPattern(id: number, version: number): Promise<number>; release(version: number): Promise<number> };
  catalog?: Array<{ patternId: number; category: EffectCategory; finishes: string[]; manifestVersion: number; assetKey?: string; bundled?: boolean; colorable?: boolean }>;
}

export class SdkError extends Error { status: number; details?: unknown; }
export class MakeupSdk { getCapabilities(): CapabilityReport; initialize(): Promise<CapabilityReport>; start(): Promise<void>; apply(params: EffectParams): Promise<ApplyResult>; clear(category: EffectCategory): Promise<ClearResult>; clearAll(): Promise<ClearResult>; capture(): Promise<CaptureResult>; stop(): Promise<void>; dispose(): Promise<void>; getPatterns(category: EffectCategory | string): UpstreamPattern[]; morph(map?: Record<string, number>): void; setMorph(name: string, value: number): { name: string; value: number }; resetMorph(): void; getMorphTargets(): string[]; setWireframe(on: boolean): void; setBlur(on: boolean): void; on(event: string, callback: (payload: unknown) => void): () => void; onEvent(callback: (event: SdkEvent) => void): () => void; }
export class OpenMakeupCompat { static create(options?: MakeupSdkConfig): Promise<OpenMakeupCompat>; readonly ready: boolean; readonly categories: string[]; readonly morphControls: string[]; init(onReady?: (sdk: OpenMakeupCompat) => unknown): Promise<OpenMakeupCompat>; getPatterns(category: string): UpstreamPattern[]; apply(category: string, options?: { color?: string; pattern?: number | string | null; patternId?: number | string | null; finish?: Finish; intensity?: number }): Promise<{ category: string; color: string; finish: Finish | null; pattern: number | string | null }>; clear(category: string): Promise<ClearResult>; clearAll(): Promise<ClearResult>; morph(map?: Record<string, number>): void; setMorph(name: string, value: number): { name: string; value: number }; resetMorph(): void; getMorphTargets(): string[]; setWireframe(on: boolean): void; setBlur(on: boolean): void; start(): Promise<void>; stop(): Promise<void>; dispose(): Promise<void>; }
export { MakeupSdk as MakeupSdkSession };
export function create(options: MakeupSdkConfig): Promise<MakeupSdk>;
export function normalizeFinish(finish: Finish): Exclude<Finish, 'dewy'>;
export function runMiniProgramProbe(options: MakeupSdkConfig & { device?: Record<string, string> }): Promise<Record<string, unknown>>;
export function loadWasmCore(options: MakeupSdkConfig): Promise<unknown>;
export function sha256Hex(bytes: ArrayBuffer, digest?: MakeupSdkConfig['sha256']): Promise<string>;
export function normalizeWechatFrame(frame: unknown): MakeupFrame;
export function normalizeFaceMeshResult(results: unknown, frame?: MakeupFrame): TrackingResult;
export function createWechatFaceMeshTracker(options?: { create?: Function; estimate?: Function; reset?: Function; dispose?: Function; options?: Record<string, unknown>; probe?: Function }): MakeupSdkConfig['tracker'];
export function createWechatOpenMakeupResourcePort(options?: { readFile?: Function; downloadFile?: Function; baseUrl?: string }): MakeupSdkConfig['resources'] & { getManifest(): WasmManifest | undefined; resolve(path: string): string };
export function createWebGlMakeupRenderer(options?: { gl?: unknown; canvas?: unknown; canvasToTempFilePath?: Function; clear?: boolean; supportedEffects?: EffectCategory[]; loadPatternTexture?: Function }): MakeupSdkConfig['renderer'] & { supportedEffects: EffectCategory[] };
