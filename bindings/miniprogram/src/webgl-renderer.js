import { EFFECT, FINISH, STATUS, SdkError } from './makeup-sdk.js';

const VERTEX_SHADER = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
const FRAGMENT_SHADER = `precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new SdkError(STATUS.GPU_CONTEXT_LOST, log || 'Shader compilation failed');
  }
  return shader;
}

function toClip(point) {
  return [point.x * 2 - 1, 1 - point.y * 2];
}

export function createWebGlLipstickRenderer({ gl, canvas, canvasToTempFilePath,
  clear = true } = {}) {
  let program;
  let buffer;
  let initialized = false;
  let lastCapture = null;
  return {
    probe() {
      return Boolean(gl && typeof gl.createShader === 'function');
    },
    async initialize() {
      if (!gl) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'WebGL context is required');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new SdkError(STATUS.GPU_CONTEXT_LOST, gl.getProgramInfoLog(program) || 'Program link failed');
      }
      buffer = gl.createBuffer();
      initialized = true;
      return STATUS.OK;
    },
    async render(frame, tracking, layers) {
      if (!initialized) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'Renderer is not initialized');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      const params = layers.lipstick;
      const points = tracking.landmarks?.lips;
      if (!params) {
        return STATUS.OK;
      }
      if (!Array.isArray(points) || points.length < 3) {
        throw new SdkError(STATUS.FRAME_INVALID, 'Lip landmarks are required for lipstick rendering');
      }
      const vertices = points.flatMap(toClip);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'a_position');
      const color = gl.getUniformLocation(program, 'u_color');
      const argb = params.argb >>> 0;
      const alpha = Math.max(0, Math.min(1, params.intensity ?? 1));
      gl.uniform4f(color, ((argb >> 16) & 255) / 255, ((argb >> 8) & 255) / 255,
                   (argb & 255) / 255, alpha);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      if (clear && typeof gl.clear === 'function') gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, points.length);
      lastCapture = { width: frame.width, height: frame.height,
        orientation: frame.orientation, mirrored: frame.mirrored };
      return STATUS.OK;
    },
    async capture() {
      if (!lastCapture) throw new SdkError(STATUS.NO_FRAME, 'No rendered frame');
      let path;
      if (canvasToTempFilePath) path = await canvasToTempFilePath(canvas);
      else if (canvas?.toTempFilePath) path = await canvas.toTempFilePath();
      return { path, ...lastCapture };
    },
    async dispose() {
      if (buffer && gl.deleteBuffer) gl.deleteBuffer(buffer);
      if (program && gl.deleteProgram) gl.deleteProgram(program);
      initialized = false;
      lastCapture = null;
      return STATUS.OK;
    },
    captureProbe() {
      return Boolean(canvasToTempFilePath || canvas?.toTempFilePath);
    }
  };
}

const CAMERA_VERTEX_SHADER = `attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_uv; }`;
const CAMERA_FRAGMENT_SHADER = `precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_texture, v_uv); }`;
const LAYER_VERTEX_SHADER = `attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_uv; }`;
const LAYER_FRAGMENT_SHADER = `precision mediump float;
uniform vec4 u_color;
uniform sampler2D u_pattern;
uniform float u_usePattern;
varying vec2 v_uv;
void main() { vec4 pattern = texture2D(u_pattern, v_uv); gl_FragColor = mix(u_color, vec4(u_color.rgb, u_color.a * pattern.a), u_usePattern); }`;

const LANDMARK_POLYGONS = Object.freeze({
  lipstick: { points: 'lips' },
  foundation: { indices: [10, 338, 297, 332, 284, 251, 389, 454, 323, 361, 288, 397, 365, 379, 400, 152, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109] },
  blush: { indices: [50, 101, 118, 117, 111, 187, 205, 36, 206, 216, 212, 147, 123, 116, 111] },
  eyeshadow: { indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246] },
  eyeliner: { indices: [33, 133, 173, 157, 158, 159, 160, 161, 246] },
  mascara: { indices: [33, 133, 173, 157, 158, 159, 160, 161, 246] }
});

function getPointsForLayer(category, tracking) {
  const shape = LANDMARK_POLYGONS[category];
  const landmarks = tracking?.landmarks ?? {};
  if (shape?.points && Array.isArray(landmarks[shape.points])) return landmarks[shape.points];
  const points = Array.isArray(landmarks) ? landmarks : landmarks.points;
  if (!Array.isArray(points)) return null;
  if (shape?.indices) return shape.indices.map((index) => points[index]).filter(Boolean);
  return points;
}

function hexColor(argb, intensity, finish) {
  const value = argb >>> 0;
  const shine = finish === FINISH.GLOSSY ? 1.08 : finish === FINISH.SHIMMER ? 1.02 : 1;
  return [Math.min(1, (((value >> 16) & 255) / 255) * shine),
    Math.min(1, (((value >> 8) & 255) / 255) * shine),
    Math.min(1, ((value & 255) / 255) * shine),
    Math.max(0, Math.min(1, Number(intensity ?? 1)))];
}

/**
 * Minimal raw-WebGL renderer for the upstream category contract. It keeps the
 * camera frame as a texture and renders one normalized landmark polygon per
 * active layer. A host can replace the shader programs later without changing
 * the binding or port contract.
 */
export function createWebGlMakeupRenderer({ gl, canvas, canvasToTempFilePath,
  clear = true, supportedEffects = Object.values(EFFECT), loadPatternTexture } = {}) {
  let cameraProgram;
  let layerProgram;
  let cameraTexture;
  let cameraBuffer;
  let layerBuffer;
  let initialized = false;
  let lastCapture;
  const morph = new Map();
  let wireframe = false;
  let blur = false;
  const patternTextures = new Map();

  const compileProgram = (vertexSource, fragmentSource) => {
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new SdkError(STATUS.GPU_CONTEXT_LOST, gl.getProgramInfoLog(program) || 'Program link failed');
    }
    return program;
  };

  const uploadFrame = (frame) => {
    const data = frame.data instanceof ArrayBuffer ? new Uint8Array(frame.data) : new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const drawBackground = (frame) => {
    gl.useProgram(cameraProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, cameraBuffer);
    const pos = gl.getAttribLocation(cameraProgram, 'a_position');
    const uv = gl.getAttribLocation(cameraProgram, 'a_uv');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.uniform1i(gl.getUniformLocation(cameraProgram, 'u_texture'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const drawLayer = async (category, params, tracking) => {
    const points = getPointsForLayer(category, tracking);
    if (!Array.isArray(points) || points.length < 3) return false;
    const vertices = points.flatMap((point) => [point.x * 2 - 1, 1 - point.y * 2, point.x, point.y]);
    let patternTexture = null;
    if (params.patternId != null && typeof loadPatternTexture === 'function') {
      const key = `${category}:${params.patternId}`;
      if (!patternTextures.has(key)) {
        const image = await loadPatternTexture({ category, patternId: params.patternId });
        if (image) {
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          if (image.data && image.width && image.height) {
            const bytes = image.data instanceof ArrayBuffer ? new Uint8Array(image.data) : image.data;
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          }
          patternTextures.set(key, texture);
        }
      }
      patternTexture = patternTextures.get(key) ?? null;
    }
    gl.useProgram(layerProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, layerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    const position = gl.getAttribLocation(layerProgram, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    const uv = gl.getAttribLocation(layerProgram, 'a_uv');
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform4fv(gl.getUniformLocation(layerProgram, 'u_color'), hexColor(params.argb, params.intensity, params.finish));
    gl.uniform1f(gl.getUniformLocation(layerProgram, 'u_usePattern'), patternTexture ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, patternTexture);
    gl.uniform1i(gl.getUniformLocation(layerProgram, 'u_pattern'), 1);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, points.length);
    return true;
  };

  return {
    supportedEffects: [...supportedEffects],
    probe() { return Boolean(gl && typeof gl.createShader === 'function' && typeof gl.texImage2D === 'function'); },
    async initialize() {
      if (!gl) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'WebGL context is required');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      cameraProgram = compileProgram(CAMERA_VERTEX_SHADER, CAMERA_FRAGMENT_SHADER);
      layerProgram = compileProgram(LAYER_VERTEX_SHADER, LAYER_FRAGMENT_SHADER);
      cameraTexture = gl.createTexture();
      cameraBuffer = gl.createBuffer();
      layerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cameraBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
      initialized = true;
      return STATUS.OK;
    },
    async render(frame, tracking, layers) {
      if (!initialized) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'Renderer is not initialized');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      uploadFrame(frame);
      if (clear) gl.clear(gl.COLOR_BUFFER_BIT);
      drawBackground(frame);
      let rendered = false;
      for (const [category, params] of Object.entries(layers ?? {})) {
        rendered = (await drawLayer(category, params, tracking)) || rendered;
      }
      if (!rendered && Object.keys(layers ?? {}).length) {
        throw new SdkError(STATUS.FRAME_INVALID, 'Face landmarks are required for active makeup layers');
      }
      lastCapture = { width: frame.width, height: frame.height, orientation: frame.orientation, mirrored: frame.mirrored };
      return STATUS.OK;
    },
    async capture() {
      if (!lastCapture) throw new SdkError(STATUS.NO_FRAME, 'No rendered frame');
      const path = canvasToTempFilePath ? await canvasToTempFilePath(canvas) : await canvas?.toTempFilePath?.();
      if (!path) throw new SdkError(STATUS.CAPTURE_FAILED, 'Canvas export is unavailable');
      return { path, ...lastCapture };
    },
    setMorph(name, value) { morph.set(name, value); },
    resetMorph() { morph.clear(); },
    setWireframe(value) { wireframe = Boolean(value); },
    setBlur(value) { blur = Boolean(value); },
    get debugState() { return { morph: Object.fromEntries(morph), wireframe, blur }; },
    async dispose() {
      if (cameraTexture && gl.deleteTexture) gl.deleteTexture(cameraTexture);
      if (cameraBuffer && gl.deleteBuffer) gl.deleteBuffer(cameraBuffer);
      if (layerBuffer && gl.deleteBuffer) gl.deleteBuffer(layerBuffer);
      for (const texture of patternTextures.values()) gl.deleteTexture?.(texture);
      patternTextures.clear();
      if (cameraProgram && gl.deleteProgram) gl.deleteProgram(cameraProgram);
      if (layerProgram && gl.deleteProgram) gl.deleteProgram(layerProgram);
      initialized = false;
      lastCapture = null;
      return STATUS.OK;
    },
    captureProbe() { return Boolean(canvasToTempFilePath || canvas?.toTempFilePath); }
  };
}
