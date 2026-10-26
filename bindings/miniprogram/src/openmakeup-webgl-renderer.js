import { EFFECT, FINISH, STATUS, SdkError } from './makeup-sdk.js';
import { UPSTREAM_MORPH_CONTROLS, UPSTREAM_MORPH_TARGETS_EXTRA } from './upstream-catalog.js';

// The upstream model is a 468 vertex glTF mesh. This parser keeps the
// renderer independent from Three.js and works with ArrayBuffers supplied by
// wx.getFileSystemManager(), downloadFile(), or a package loader.
const COMPONENTS = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 });
const COMPONENT_BYTES = Object.freeze({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 });

function asBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input?.data) return asBytes(input.data);
  throw new TypeError('GLB data must be an ArrayBuffer or typed array');
}

function parseGlb(input) {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'face.glb must be a glTF 2.0 binary');
  }
  let offset = 12;
  let json;
  let bin = new Uint8Array(0);
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !json.meshes?.[0]?.primitives?.[0]) {
    throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'face.glb has no mesh primitive');
  }
  return { json, bin };
}

function accessor(gltf, bin, index) {
  const spec = gltf.accessors[index];
  const count = spec.count;
  const components = COMPONENTS[spec.type];
  const size = COMPONENT_BYTES[spec.componentType];
  if (!components || !size) throw new SdkError(STATUS.ASSET_LOAD_FAILED, `Unsupported glTF accessor ${index}`);
  const output = new Float32Array(count * components);
  const viewSpec = spec.bufferView == null ? null : gltf.bufferViews[spec.bufferView];
  const stride = viewSpec?.byteStride ?? components * size;
  const start = (viewSpec?.byteOffset ?? 0) + (spec.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (at) => {
    if (spec.componentType === 5126) return view.getFloat32(at, true);
    if (spec.componentType === 5125) return view.getUint32(at, true);
    if (spec.componentType === 5123) return view.getUint16(at, true);
    return view.getUint8(at);
  };
  if (viewSpec) {
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < components; c++) output[i * components + c] = read(start + i * stride + c * size);
    }
  }
  if (spec.sparse) {
    const sparse = spec.sparse;
    const indexView = gltf.bufferViews[sparse.indices.bufferView];
    const valueView = gltf.bufferViews[sparse.values.bufferView];
    const indexStart = (indexView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
    const valueStart = (valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
    const indexSize = COMPONENT_BYTES[sparse.indices.componentType];
    const readIndex = (at) => sparse.indices.componentType === 5123 ? view.getUint16(at, true) : view.getUint8(at);
    for (let i = 0; i < sparse.count; i++) {
      const dst = readIndex(indexStart + i * indexSize);
      for (let c = 0; c < components; c++) output[dst * components + c] = read(valueStart + i * components * size + c * size);
    }
  }
  return output;
}

export function parseOpenMakeupFaceGlb(input) {
  const { json, bin } = parseGlb(input);
  const primitive = json.meshes[0].primitives[0];
  const attributes = primitive.attributes;
  const result = {
    positions: accessor(json, bin, attributes.POSITION),
    normals: accessor(json, bin, attributes.NORMAL),
    uv: accessor(json, bin, attributes.TEXCOORD_0),
    uv2: accessor(json, bin, attributes.TEXCOORD_1),
    uv3: accessor(json, bin, attributes.TEXCOORD_3),
    uvEyeShadow: accessor(json, bin, attributes.TEXCOORD_3),
    uvLip: accessor(json, bin, attributes.TEXCOORD_4),
    indices: Uint16Array.from(accessor(json, bin, primitive.indices)),
    morphs: [],
    morphNames: json.meshes[0].extras?.targetNames ?? []
  };
  for (const target of primitive.targets ?? []) result.morphs.push(accessor(json, bin, target.POSITION));
  return result;
}

function shaderSource(source, stage, modern) {
  let text = typeof source === 'string' ? source : new TextDecoder().decode(asBytes(source));
  if (!modern || text.includes('#version')) return text;
  text = text.replace(/texture2D\s*\(/g, 'texture(').replace(/textureCube\s*\(/g, 'texture(');
  return `#version 300 es\n${text}`;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Shader compilation failed';
    gl.deleteShader?.(shader);
    throw new SdkError(STATUS.GPU_CONTEXT_LOST, log);
  }
  return shader;
}

function program(gl, vertex, fragment) {
  const p = gl.createProgram();
  gl.attachShader(p, vertex);
  gl.attachShader(p, fragment);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new SdkError(STATUS.GPU_CONTEXT_LOST, gl.getProgramInfoLog(p) || 'Shader link failed');
  return p;
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function color(argb, intensity) {
  const v = argb >>> 0;
  return new Float32Array([
    ((v >>> 16) & 255) / 255,
    ((v >>> 8) & 255) / 255,
    (v & 255) / 255,
    Math.max(0, Math.min(1, Number(intensity ?? 1)))
  ]);
}

const SHADER_PATHS = Object.freeze({
  lipstick: 'lip', eyeshadow: 'eyeshadow', blush: 'blush', foundation: 'foundation', eyeliner: 'eyeline', mascara: 'mascara'
});

function resolveMorphTarget(name) {
  return UPSTREAM_MORPH_CONTROLS[name]?.target ?? String(name);
}

const BASE_TEXTURES = Object.freeze({
  lipstick: [['_TextureSample1', 'shaders/lip/lip-gloss.PNG'], ['_brightTexture', 'shaders/lip/noize.PNG'], ['_lipReflection', 'shaders/lip/Lips-open.PNG'], ['_lipReflectionClose', 'shaders/lip/Lips-close.PNG']],
  eyeshadow: [['_EyeShadowTexture', 'shaders/eyeshadow/i6333.png'], ['_FaceMaskE', 'shaders/foundation_mask2.PNG']],
  blush: [['_EyeShadowTexture', 'shaders/blush/i6417.png'], ['_FaceMaskE', 'shaders/foundation_mask.PNG']],
  foundation: [['_Mask', 'shaders/foundation_mask3.PNG']],
  eyeliner: [['map', 'shaders/eyeline/i10246.png']],
  mascara: [['map', 'shaders/mascara/i9144.png']]
});

/**
 * WebGL port of the upstream Three.js MakeupEngine. It uses the upstream
 * face.glb vertex/index/UV channels and the upstream shader sources. The host
 * only supplies WebGL plus asset callbacks; no DOM, window or Three.js is
 * required.
 */
export function createOpenMakeupWebGlRenderer({
  gl, canvas, canvasToTempFilePath, loadAsset, loadModel, loadShader, loadTexture,
  loadPatternTexture, clear = true, supportedEffects = Object.values(EFFECT), webgl2 = undefined
} = {}) {
  let model;
  let initialized = false;
  let cameraProgram;
  let cameraTexture;
  let cameraBuffer;
  let modelBuffers;
  let programs = new Map();
  let textures = new Map();
  let lastCapture;
  const morphWeights = new Map();
  let wireframe = false;
  let blur = false;
  const modern = webgl2 ?? Boolean(gl?.texStorage2D && gl?.drawBuffers);

  const asset = async (path) => {
    if (typeof loadAsset !== 'function') return null;
    return loadAsset(path);
  };
  const shader = async (category, stage) => {
    if (typeof loadShader === 'function') return loadShader(category, stage);
    return asset(`shaders/${SHADER_PATHS[category]}/${stage}.glsl`);
  };
  const imageTexture = async (path) => {
    if (textures.has(path)) return textures.get(path);
    const image = typeof loadTexture === 'function' ? await loadTexture(path) : await asset(path);
    if (!image) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (image.data && image.width && image.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, asBytes(image.data));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
    textures.set(path, texture);
    return texture;
  };
  const set = (p, name, value) => {
    const loc = gl.getUniformLocation(p, name);
    if (loc == null) return;
    if (typeof value === 'number') gl.uniform1f(loc, value);
    else if (value.length === 4) gl.uniform4fv(loc, value);
    else if (value.length === 3) gl.uniform3fv(loc, value);
    else if (value.length === 16) gl.uniformMatrix4fv(loc, false, value);
  };
  const bindTexture = (p, name, texture, unit) => {
    if (!texture) return;
    const loc = gl.getUniformLocation(p, name);
    if (loc == null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(loc, unit);
  };
  const setupAttributes = (p) => {
    const stride = 3 * 4;
    const position = gl.getAttribLocation(p, 'position');
    if (position >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers.position); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0); }
    const normal = gl.getAttribLocation(p, 'normal');
    if (normal >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers.normal); gl.enableVertexAttribArray(normal); gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 0); }
    for (const [name, key] of [['uv', 'uv'], ['uv2', 'uv2'], ['uv3', 'uv3'], ['uvEyeShadow', 'uvEyeShadow'], ['uvLip', 'uvLip']]) {
      const loc = gl.getAttribLocation(p, name);
      if (loc >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers[key]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    }
  };
  const updatePositions = (tracking) => {
    const points = tracking?.landmarks?.points;
    if (!Array.isArray(points) || points.length < 468) return false;
    const out = new Float32Array(468 * 3);
    for (let i = 0; i < 468; i++) {
      const point = points[i] || { x: 0.5, y: 0.5, z: 0 };
      out[i * 3] = point.x * 2 - 1;
      out[i * 3 + 1] = 1 - point.y * 2;
      out[i * 3 + 2] = Number(point.z || 0) * -0.2;
    }
    for (let i = 0; i < model.morphs.length; i++) {
      const name = model.morphNames[i];
      const weight = morphWeights.get(name) ?? 0;
      if (!weight) continue;
      const delta = model.morphs[i];
      for (let v = 0; v < 468; v++) {
        out[v * 3] += delta[v * 3] * weight * 0.03;
        out[v * 3 + 1] += delta[v * 3 + 1] * weight * 0.03;
        out[v * 3 + 2] += delta[v * 3 + 2] * weight * 0.03;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
    return true;
  };
  const uploadFrame = (frame) => {
    const bytes = asBytes(frame.data);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  };
  const drawCamera = () => {
    gl.useProgram(cameraProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, cameraBuffer);
    const p = gl.getAttribLocation(cameraProgram, 'a_position');
    const uv = gl.getAttribLocation(cameraProgram, 'a_uv');
    gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    bindTexture(cameraProgram, 'u_texture', cameraTexture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const drawLayer = async (category, params, tracking) => {
    const p = programs.get(category);
    if (!p || !updatePositions(tracking)) return false;
    gl.useProgram(p);
    setupAttributes(p);
    for (const name of ['modelMatrix', 'viewMatrix', 'projectionMatrix']) set(p, name, identity());
    set(p, 'modelViewMatrix', identity());
    set(p, 'normalMatrix', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    set(p, 'cameraPosition', new Float32Array([0, 0, 1]));
    set(p, 'uCameraPosition', new Float32Array([0, 0, 1]));
    set(p, '_MainColor', color(params.argb, params.intensity));
    set(p, '_ShadowColor', color(params.argb, params.intensity));
    set(p, 'color', color(params.argb, params.intensity));
    set(p, '_transparency', Number(params.intensity ?? 1));
    set(p, '_shine', params.finish === FINISH.GLOSSY ? 1 : 0.2);
    set(p, '_bright', params.finish === FINISH.SHIMMER || params.finish === FINISH.GLITTER ? 1 : 0);
    set(p, '_lipOpen', 0.5);
    const base = BASE_TEXTURES[category] ?? [];
    let unit = 2;
    for (const [uniform, path] of base) bindTexture(p, uniform, await imageTexture(path), unit++);
    if (params.patternId != null && typeof loadPatternTexture === 'function') {
      const image = await loadPatternTexture({ category, patternId: params.patternId });
      if (image) {
        const texture = await imageTexture(`pattern:${category}:${params.patternId}`) ?? (() => {
          const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, asBytes(image.data)); textures.set(`pattern:${category}:${params.patternId}`, t); return t;
        })();
        bindTexture(p, category === 'lipstick' ? '_TextureSample1' : '_EyeShadowTexture', texture, 1);
      }
    }
    if (wireframe && gl.polygonMode) gl.polygonMode(gl.FRONT_AND_BACK, gl.LINE);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, modelBuffers.indices);
    gl.drawElements(gl.TRIANGLES, model.indices.length, gl.UNSIGNED_SHORT, 0);
    if (wireframe && gl.polygonMode) gl.polygonMode(gl.FRONT_AND_BACK, gl.FILL);
    return true;
  };

  return {
    supportedEffects: [...supportedEffects],
    probe() { return Boolean(gl?.createShader && gl?.createBuffer && gl?.texImage2D); },
    async initialize() {
      if (!gl) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'WebGL context is required');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      const modelBytes = loadModel ? await loadModel() : await asset('models/face.glb');
      if (!modelBytes) throw new SdkError(STATUS.ASSET_LOAD_FAILED, 'OpenMakeup face.glb is required');
      model = parseOpenMakeupFaceGlb(modelBytes);
      const cameraVertex = modern
        ? '#version 300 es\nin vec2 a_position; in vec2 a_uv; out vec2 v_uv; void main(){gl_Position=vec4(a_position,0.,1.);v_uv=a_uv;}'
        : 'attribute vec2 a_position; attribute vec2 a_uv; varying vec2 v_uv; void main(){gl_Position=vec4(a_position,0.,1.);v_uv=a_uv;}';
      const cameraFragment = modern
        ? '#version 300 es\nprecision mediump float; uniform sampler2D u_texture; in vec2 v_uv; out vec4 fragColor; void main(){fragColor=texture(u_texture,v_uv);}'
        : 'precision mediump float; uniform sampler2D u_texture; varying vec2 v_uv; void main(){gl_FragColor=texture2D(u_texture,v_uv);}';
      cameraProgram = program(gl, compile(gl, gl.VERTEX_SHADER, cameraVertex), compile(gl, gl.FRAGMENT_SHADER, cameraFragment));
      cameraTexture = gl.createTexture(); cameraBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cameraBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, 1,1,1,0]), gl.STATIC_DRAW);
      modelBuffers = { indices: gl.createBuffer() };
      for (const key of ['position','normal','uv','uv2','uv3','uvEyeShadow','uvLip']) modelBuffers[key] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers.normal); gl.bufferData(gl.ARRAY_BUFFER, model.normals, gl.STATIC_DRAW);
      for (const key of ['uv','uv2','uv3','uvEyeShadow','uvLip']) { gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffers[key]); gl.bufferData(gl.ARRAY_BUFFER, model[key], gl.STATIC_DRAW); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, modelBuffers.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);
      for (const category of supportedEffects) {
        const [vertex, fragment] = await Promise.all([shader(category, 'vertex'), shader(category, 'fragment')]);
        if (!vertex || !fragment) continue;
        const vertexText = typeof vertex === 'string' ? vertex : new TextDecoder().decode(asBytes(vertex));
        const fragmentText = typeof fragment === 'string' ? fragment : new TextDecoder().decode(asBytes(fragment));
        const canUseModern = modern && !/\battribute\b|\bvarying\b|\bgl_FragColor\b/.test(`${vertexText}\n${fragmentText}`);
        const p = program(gl, compile(gl, gl.VERTEX_SHADER, shaderSource(vertexText, 'vertex', canUseModern)), compile(gl, gl.FRAGMENT_SHADER, shaderSource(fragmentText, 'fragment', canUseModern)));
        programs.set(category, p);
      }
      initialized = true;
      return STATUS.OK;
    },
    async render(frame, tracking, layers) {
      if (!initialized) throw new SdkError(STATUS.RENDERER_UNAVAILABLE, 'Renderer is not initialized');
      if (gl.isContextLost?.()) throw new SdkError(STATUS.GPU_CONTEXT_LOST, 'WebGL context is lost');
      uploadFrame(frame); if (clear) gl.clear(gl.COLOR_BUFFER_BIT); drawCamera();
      let rendered = false;
      for (const [category, params] of Object.entries(layers ?? {})) rendered = (await drawLayer(category, params, tracking)) || rendered;
      if (!rendered && Object.keys(layers ?? {}).length) throw new SdkError(STATUS.FRAME_INVALID, 'Face mesh or upstream shader is unavailable');
      lastCapture = { width: frame.width, height: frame.height, orientation: frame.orientation, mirrored: frame.mirrored };
      return STATUS.OK;
    },
    async capture() {
      if (!lastCapture) throw new SdkError(STATUS.NO_FRAME, 'No rendered frame');
      const path = canvasToTempFilePath ? await canvasToTempFilePath(canvas) : await canvas?.toTempFilePath?.();
      if (!path) throw new SdkError(STATUS.CAPTURE_FAILED, 'Canvas export is unavailable');
      return { path, ...lastCapture };
    },
    setMorph(name, value) { morphWeights.set(resolveMorphTarget(name), Number(value)); },
    resetMorph() { morphWeights.clear(); },
    setWireframe(value) { wireframe = Boolean(value); },
    setBlur(value) { blur = Boolean(value); },
    get debugState() { return { morph: Object.fromEntries(morphWeights), wireframe, blur, modelVertices: model?.positions.length / 3 ?? 0, upstreamShaders: [...programs.keys()] }; },
    async dispose() { for (const p of programs.values()) gl.deleteProgram?.(p); for (const t of textures.values()) gl.deleteTexture?.(t); programs.clear(); textures.clear(); initialized = false; lastCapture = undefined; return STATUS.OK; },
    captureProbe() { return Boolean(canvasToTempFilePath || canvas?.toTempFilePath); }
  };
}

export const OPENMAKEUP_MORPH_TARGETS = Object.freeze([...Object.values(UPSTREAM_MORPH_CONTROLS).map((entry) => entry.target), ...UPSTREAM_MORPH_TARGETS_EXTRA]);
