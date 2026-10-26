import { EFFECT, FINISH, SdkError, STATUS } from './constants.js';
import { create } from './makeup-sdk.js';
import { UPSTREAM_CATEGORIES, resolveUpstreamCategory, resolveUpstreamPattern } from './upstream-catalog.js';

const EFFECT_TO_UPSTREAM = { eyeliner: 'eyeline' };

function colorToArgb(value) {
  const text = String(value ?? '').trim().replace(/^#/, '');
  const expanded = text.length === 3 ? text.split('').map((char) => char + char).join('') : text;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new SdkError(STATUS.INVALID_ARGUMENT, `Invalid color: ${value}`);
  return (0xff000000 | Number.parseInt(expanded, 16)) >>> 0;
}

function argbToColor(value) {
  return `#${(value >>> 0).toString(16).slice(-6).padStart(6, '0')}`;
}

export class OpenMakeupCompat {
  static async create(options = {}) {
    const session = await create(options);
    return new OpenMakeupCompat(session);
  }

  constructor(session) {
    this.session = session;
  }

  get ready() { return this.session.initialized; }
  get categories() { return Object.keys(UPSTREAM_CATEGORIES); }
  get morphControls() { return this.session.getMorphTargets(); }

  async init(onReady) {
    await this.session.initialize();
    await this.session.start();
    if (onReady) await onReady(this);
    return this;
  }

  getPatterns(category) { return this.session.getPatterns(category); }

  async apply(category, options = {}) {
    const name = resolveUpstreamCategory(category);
    if (!name) throw new SdkError(STATUS.INVALID_ARGUMENT, `Unknown category: ${category}`);
    const sdkCategory = EFFECT_TO_UPSTREAM[name] === 'eyeline' ? EFFECT.EYELINER : name;
    const config = UPSTREAM_CATEGORIES[name];
    const pattern = resolveUpstreamPattern(name, options.patternId ?? options.pattern);
    const finish = config.supportsFinish ? (options.finish ?? config.defaults.finish) : null;
    const result = await this.session.apply({
      category: sdkCategory,
      patternId: pattern?.id ?? null,
      argb: colorToArgb(options.color ?? config.defaults.color),
      intensity: options.intensity ?? 1,
      finish: finish === 'dewy' ? FINISH.GLOSSY : finish
    });
    return {
      category: name,
      color: argbToColor(result.params.argb),
      finish: config.supportsFinish ? result.params.finish : null,
      pattern: pattern?.id ?? null
    };
  }

  async clear(category) { return this.session.clear(category); }
  async clearAll() { return this.session.clearAll(); }
  morph(map = {}) { return this.session.morph(map); }
  setMorph(name, value) { return this.session.setMorph(name, value); }
  resetMorph() { return this.session.resetMorph(); }
  getMorphTargets() { return this.session.getMorphTargets(); }
  setWireframe(on) { return this.session.setWireframe(on); }
  setBlur(on) { return this.session.setBlur(on); }
  start() { return this.session.start(); }
  stop() { return this.session.stop(); }
  dispose() { return this.session.dispose(); }
}

export { colorToArgb };
