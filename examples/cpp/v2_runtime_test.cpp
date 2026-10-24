#include "makeup_sdk/makeup_sdk_v2_runtime.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <utility>

namespace {

class Camera final : public mk2::CameraPort {
 public:
  mk2_status start(mk2::FrameCallback callback) override {
    if (running_ || !callback) {
      return MK2_STATUS_INVALID_STATE;
    }
    callback_ = std::move(callback);
    running_ = true;
    return MK2_STATUS_OK;
  }

  mk2_status stop() override {
    callback_ = {};
    running_ = false;
    return MK2_STATUS_OK;
  }

  bool running() const override { return running_; }

  mk2_status emit(const mk2_frame& frame) {
    if (!running_ || !callback_) {
      return MK2_STATUS_INVALID_STATE;
    }
    callback_(frame);
    return MK2_STATUS_OK;
  }

 private:
  mk2::FrameCallback callback_;
  bool running_ = false;
};

class Tracker final : public mk2::TrackerPort {
 public:
  mk2_status initialize(uint32_t model_version) override {
    model_version_ = model_version;
    initialized_ = true;
    return MK2_STATUS_OK;
  }

  mk2_status estimate(const mk2_frame& frame,
                      mk2_tracking_result* out_tracking) override {
    if (!initialized_ || out_tracking == nullptr) {
      return MK2_STATUS_INVALID_STATE;
    }
    *out_tracking = {frame.timestamp_ns, face_count_, confidence_};
    return MK2_STATUS_OK;
  }

  mk2_status reset() override {
    face_count_ = 1;
    confidence_ = 1.0f;
    return MK2_STATUS_OK;
  }

  mk2_status dispose() override {
    initialized_ = false;
    return MK2_STATUS_OK;
  }

 private:
  uint32_t model_version_ = 0;
  uint32_t face_count_ = 1;
  float confidence_ = 1.0f;
  bool initialized_ = false;
};

class Renderer final : public mk2::RendererPort {
 public:
  mk2_status initialize(uint32_t renderer_version) override {
    renderer_version_ = renderer_version;
    initialized_ = true;
    rendered_ = false;
    return MK2_STATUS_OK;
  }

  mk2_status render(const mk2_frame& frame,
                    const mk2_tracking_result& tracking,
                    const mk2_layer_snapshot* layers,
                    size_t layer_count) override {
    if (!initialized_ || layers == nullptr || layer_count != MK2_EFFECT_COUNT ||
        tracking.face_count != 1) {
      return MK2_STATUS_INVALID_STATE;
    }
    last_frame_ = frame;
    rendered_ = true;
    return MK2_STATUS_OK;
  }

  mk2_status capture(mk2_capture_metadata* out_metadata) override {
    if (!rendered_ || out_metadata == nullptr) {
      return MK2_STATUS_NO_FRAME;
    }
    *out_metadata = {last_frame_.timestamp_ns,
                     last_frame_.width,
                     last_frame_.height,
                     last_frame_.orientation_degrees,
                     last_frame_.mirrored,
                     {0, 0, 0},
                     2,
                     7,
                     renderer_version_};
    return MK2_STATUS_OK;
  }

  mk2_status dispose() override {
    initialized_ = false;
    rendered_ = false;
    return MK2_STATUS_OK;
  }

 private:
  uint32_t renderer_version_ = 0;
  mk2_frame last_frame_{};
  bool initialized_ = false;
  bool rendered_ = false;
};

class Resources final : public mk2::ResourcePort {
 public:
  mk2_status load_manifest(uint32_t manifest_version) override {
    manifest_version_ = manifest_version;
    loaded_ = true;
    return MK2_STATUS_OK;
  }

  mk2_status load_pattern(uint64_t pattern_id,
                          uint32_t manifest_version) override {
    if (!loaded_ || manifest_version != manifest_version_) {
      return MK2_STATUS_ASSET_LOAD_FAILED;
    }
    last_pattern_ = pattern_id;
    return MK2_STATUS_OK;
  }

  mk2_status release(uint32_t manifest_version) override {
    if (manifest_version != manifest_version_) {
      return MK2_STATUS_INVALID_ARGUMENT;
    }
    loaded_ = false;
    return MK2_STATUS_OK;
  }

 private:
  uint64_t last_pattern_ = 0;
  uint32_t manifest_version_ = 0;
  bool loaded_ = false;
};

}  // namespace

int main() {
  mk2::PatternCatalog catalog(7);
  mk2::CatalogPattern pattern;
  pattern.pattern_id = 1001;
  pattern.category = MK2_EFFECT_LIPSTICK;
  pattern.asset_key = "lipstick/1001";
  pattern.supported_finishes = {true, true, true, true};
  assert(catalog.add(pattern) == MK2_STATUS_OK);

  Camera camera;
  Tracker tracker;
  Renderer renderer;
  Resources resources;
  mk2::RuntimeConfig config;
  config.core = {2, 7};
  config.tracker_version = 3;
  config.renderer_version = 4;
  mk2::SessionRuntime runtime(config, {&camera, &tracker, &renderer, &resources},
                              std::move(catalog));

  assert(runtime.initialize() == MK2_STATUS_OK);
  const mk2_capabilities capabilities = runtime.capabilities();
  assert(capabilities.supports_effects[MK2_EFFECT_LIPSTICK] == 1);
  assert(runtime.start() == MK2_STATUS_OK);

  uint8_t pixels[4] = {0, 0, 0, 255};
  const mk2_frame frame{42, 1, 1, MK2_PIXEL_FORMAT_RGBA8, 90, 1, pixels,
                        sizeof(pixels)};
  assert(camera.emit(frame) == MK2_STATUS_OK);

  mk2_effect_params params{MK2_EFFECT_LIPSTICK, MK2_FINISH_MATTE, 1001,
                           0xffc2185b, 0.85f};
  assert(runtime.apply(params, mk2::ProductFinish::Dewy) == MK2_STATUS_OK);
  mk2_layer_snapshot layer{};
  assert(mk2_session_get_layer(runtime.raw_session(), MK2_EFFECT_LIPSTICK,
                               &layer) == MK2_STATUS_OK);
  assert(layer.active == 1);
  assert(layer.params.finish == MK2_FINISH_GLOSSY);

  mk2::RuntimeCapture capture;
  assert(runtime.capture(&capture) == MK2_STATUS_OK);
  assert(capture.metadata.timestamp_ns == 42);
  assert(capture.metadata.orientation_degrees == 90);
  assert(capture.metadata.renderer_version == 4);
  assert(capture.layers[MK2_EFFECT_LIPSTICK].active == 1);

  assert(runtime.stop() == MK2_STATUS_OK);
  assert(runtime.dispose() == MK2_STATUS_OK);
  assert(runtime.state() == MK2_STATE_DISPOSED);
  return 0;
}
