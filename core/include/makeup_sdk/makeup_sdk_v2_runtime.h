#ifndef MAKEUP_SDK_V2_RUNTIME_H_
#define MAKEUP_SDK_V2_RUNTIME_H_

#include "makeup_sdk/makeup_sdk_v2_ports.h"

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace mk2 {

enum class ProductFinish {
  Matte,
  Dewy,
  Shimmer,
  Glitter,
};

mk2_finish normalize_finish(ProductFinish finish);

struct CatalogPattern {
  uint64_t pattern_id = 0;
  mk2_effect_category category = MK2_EFFECT_LIPSTICK;
  std::string asset_key;
  std::array<bool, 4> supported_finishes{};
};

class PatternCatalog final {
 public:
  explicit PatternCatalog(uint32_t manifest_version = 1);

  uint32_t manifest_version() const { return manifest_version_; }
  mk2_status add(CatalogPattern pattern);
  const CatalogPattern* find(uint64_t pattern_id,
                             mk2_effect_category category) const;
  mk2_status validate(const mk2_effect_params& params) const;

 private:
  uint32_t manifest_version_;
  std::vector<CatalogPattern> patterns_;
};

struct PortSet {
  CameraPort* camera = nullptr;
  TrackerPort* tracker = nullptr;
  RendererPort* renderer = nullptr;
  ResourcePort* resources = nullptr;
};

struct RuntimeConfig {
  mk2_config core{2, 1};
  uint32_t tracker_version = 1;
  uint32_t renderer_version = 1;
  uint32_t max_frame_width = 4096;
  uint32_t max_frame_height = 4096;
  uint8_t camera_available = 1;
  uint8_t tracker_available = 1;
  uint8_t renderer_available = 1;
};

struct RuntimeCapture {
  mk2_capture_metadata metadata{};
  std::array<mk2_layer_snapshot, MK2_EFFECT_COUNT> layers{};
};

/*
 * Host-driven orchestration for C++ bindings. Port objects remain owned by the
 * caller; SessionRuntime only coordinates their lifetime and never stores
 * platform handles in the C ABI session.
 */
class SessionRuntime final {
 public:
  SessionRuntime(const RuntimeConfig& config, const PortSet& ports,
                 PatternCatalog catalog);
  ~SessionRuntime();

  SessionRuntime(const SessionRuntime&) = delete;
  SessionRuntime& operator=(const SessionRuntime&) = delete;

  mk2_status initialize();
  mk2_status start();
  mk2_status stop();
  mk2_status apply(mk2_effect_params params, ProductFinish product_finish);
  mk2_status clear(mk2_effect_category category);
  mk2_status clear_all();
  mk2_status capture(RuntimeCapture* out_capture);
  mk2_status pump(uint32_t max_operations);
  mk2_status poll_event(mk2_event* out_event);
  mk2_status dispose();

  mk2_state state() const;
  mk2_capabilities capabilities() const;
  mk2_session* raw_session() const { return session_; }

 private:
  void on_frame(const mk2_frame& frame);
  mk2_status refresh_layers();

  RuntimeConfig config_;
  PortSet ports_;
  PatternCatalog catalog_;
  mk2_session* session_ = nullptr;
  std::array<mk2_layer_snapshot, MK2_EFFECT_COUNT> layers_{};
  bool initialized_ = false;
  bool started_ = false;
  bool disposed_ = false;
};

}  // namespace mk2

/* Kept out of the public C header; only the C++ runtime uses this hook. */
extern "C" mk2_status mk2_session_bind_capabilities(
    mk2_session* session, const mk2_capabilities* capabilities);

#endif  // MAKEUP_SDK_V2_RUNTIME_H_
