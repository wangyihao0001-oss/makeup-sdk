#ifndef MAKEUP_SDK_V2_PORTS_H_
#define MAKEUP_SDK_V2_PORTS_H_

#include "makeup_sdk/makeup_sdk_v2.h"

#include <functional>
#include <memory>
#include <string>

namespace mk2 {

using FrameCallback = std::function<void(const mk2_frame&)>;

class CameraPort {
 public:
  virtual ~CameraPort() = default;
  virtual mk2_status start(FrameCallback callback) = 0;
  virtual mk2_status stop() = 0;
  virtual bool running() const = 0;
};

class TrackerPort {
 public:
  virtual ~TrackerPort() = default;
  virtual mk2_status initialize(uint32_t model_version) = 0;
  virtual mk2_status estimate(const mk2_frame& frame,
                              mk2_tracking_result* out_tracking) = 0;
  virtual mk2_status reset() = 0;
  virtual mk2_status dispose() = 0;
};

class RendererPort {
 public:
  virtual ~RendererPort() = default;
  virtual mk2_status initialize(uint32_t renderer_version) = 0;
  virtual mk2_status render(const mk2_frame& frame,
                            const mk2_tracking_result& tracking,
                            const mk2_layer_snapshot* layers,
                            size_t layer_count) = 0;
  virtual mk2_status capture(mk2_capture_metadata* out_metadata) = 0;
  virtual mk2_status dispose() = 0;
};

class ResourcePort {
 public:
  virtual ~ResourcePort() = default;
  virtual mk2_status load_manifest(uint32_t manifest_version) = 0;
  virtual mk2_status load_pattern(uint64_t pattern_id,
                                  uint32_t manifest_version) = 0;
  virtual mk2_status release(uint32_t manifest_version) = 0;
};

}  // namespace mk2

#endif  // MAKEUP_SDK_V2_PORTS_H_
