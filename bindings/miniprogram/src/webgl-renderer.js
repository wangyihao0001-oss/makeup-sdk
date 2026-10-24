import { STATUS, SdkError } from './makeup-sdk.js';

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
