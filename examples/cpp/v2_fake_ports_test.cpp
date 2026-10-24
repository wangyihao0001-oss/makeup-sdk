#include "makeup_sdk/makeup_sdk_v2_ports.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <utility>

namespace {

class FakeCamera final : public mk2::CameraPort {
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

class FakeTracker final : public mk2::TrackerPort {
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

  void set_result(uint32_t face_count, float confidence) {
    face_count_ = face_count;
    confidence_ = confidence;
  }

 private:
  uint32_t model_version_ = 0;
  uint32_t face_count_ = 1;
  float confidence_ = 1.0f;
  bool initialized_ = false;
};

class FakeRenderer final : public mk2::RendererPort {
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
                     1,
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

class FakeResources final : public mk2::ResourcePort {
 public:
  mk2_status load_manifest(uint32_t manifest_version) override {
    manifest_version_ = manifest_version;
    manifest_loaded_ = true;
    return MK2_STATUS_OK;
  }

  mk2_status load_pattern(uint64_t pattern_id,
                          uint32_t manifest_version) override {
    if (!manifest_loaded_ || manifest_version != manifest_version_) {
      return MK2_STATUS_ASSET_LOAD_FAILED;
    }
    pattern_id_ = pattern_id;
    return MK2_STATUS_OK;
  }

  mk2_status release(uint32_t manifest_version) override {
    if (manifest_version != manifest_version_) {
      return MK2_STATUS_INVALID_ARGUMENT;
    }
    manifest_loaded_ = false;
    return MK2_STATUS_OK;
  }

 private:
  uint64_t pattern_id_ = 0;
  uint32_t manifest_version_ = 0;
  bool manifest_loaded_ = false;
};

}  // namespace

int main() {
  uint8_t pixels[4] = {0, 0, 0, 255};
  const mk2_frame frame{42, 1, 1, MK2_PIXEL_FORMAT_RGBA8, 90, 1, pixels,
                        sizeof(pixels)};

  FakeCamera camera;
  uint64_t delivered_timestamp = 0;
  assert(camera.start([&](const mk2_frame& delivered) {
           delivered_timestamp = delivered.timestamp_ns;
         }) == MK2_STATUS_OK);
  assert(camera.emit(frame) == MK2_STATUS_OK);
  assert(delivered_timestamp == 42);
  assert(camera.stop() == MK2_STATUS_OK);
  assert(!camera.running());
  assert(camera.emit(frame) == MK2_STATUS_INVALID_STATE);

  FakeTracker tracker;
  assert(tracker.initialize(3) == MK2_STATUS_OK);
  mk2_tracking_result tracking{};
  assert(tracker.estimate(frame, &tracking) == MK2_STATUS_OK);
  assert(tracking.timestamp_ns == frame.timestamp_ns);
  tracker.set_result(2, 0.8f);
  assert(tracker.estimate(frame, &tracking) == MK2_STATUS_OK);
  assert(tracking.face_count == 2);
  assert(tracker.dispose() == MK2_STATUS_OK);

  FakeRenderer renderer;
  mk2_layer_snapshot layers[MK2_EFFECT_COUNT]{};
  mk2_capture_metadata metadata{};
  assert(renderer.initialize(4) == MK2_STATUS_OK);
  assert(renderer.capture(&metadata) == MK2_STATUS_NO_FRAME);
  assert(renderer.render(frame, {42, 1, 0.9f}, layers, MK2_EFFECT_COUNT) ==
         MK2_STATUS_OK);
  assert(renderer.capture(&metadata) == MK2_STATUS_OK);
  assert(metadata.timestamp_ns == 42);
  assert(metadata.orientation_degrees == 90);
  assert(metadata.renderer_version == 4);
  assert(renderer.dispose() == MK2_STATUS_OK);

  FakeResources resources;
  assert(resources.load_pattern(1001, 7) == MK2_STATUS_ASSET_LOAD_FAILED);
  assert(resources.load_manifest(7) == MK2_STATUS_OK);
  assert(resources.load_pattern(1001, 7) == MK2_STATUS_OK);
  assert(resources.load_pattern(1001, 8) == MK2_STATUS_ASSET_LOAD_FAILED);
  assert(resources.release(7) == MK2_STATUS_OK);
}
