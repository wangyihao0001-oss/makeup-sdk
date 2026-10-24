#include "makeup_sdk/makeup_sdk_v2_runtime.h"

#include <chrono>
#include <cstdint>
#include <cstdio>

int main() {
  mk2_config config{2, 1};
  mk2_session* session = nullptr;
  if (mk2_session_create(&config, &session) != MK2_STATUS_OK) return 1;

  mk2_capabilities capabilities{};
  capabilities.api_version = 2;
  capabilities.manifest_version = 1;
  capabilities.renderer_version = 1;
  capabilities.tracker_version = 1;
  capabilities.max_frame_width = 4096;
  capabilities.max_frame_height = 4096;
  capabilities.camera_available = 1;
  capabilities.tracker_available = 1;
  capabilities.renderer_available = 1;
  capabilities.supports_effects[MK2_EFFECT_LIPSTICK] = 1;
  if (mk2_session_bind_capabilities(session, &capabilities) != MK2_STATUS_OK) return 1;

  uint64_t operation = 0;
  if (mk2_session_initialize(session, &operation) != MK2_STATUS_OK ||
      mk2_session_pump(session, 1) != MK2_STATUS_OK ||
      mk2_session_start(session, &operation) != MK2_STATUS_OK ||
      mk2_session_pump(session, 1) != MK2_STATUS_OK) {
    mk2_session_destroy(session);
    return 1;
  }

  const auto start = std::chrono::steady_clock::now();
  constexpr uint32_t kIterations = 1000;
  uint8_t pixels[4] = {0, 0, 0, 255};
  mk2_frame frame{42, 1, 1, MK2_PIXEL_FORMAT_RGBA8, 0, 0, pixels, sizeof(pixels)};
  mk2_tracking_result tracking{42, 1, 0.99f};
  for (uint32_t i = 0; i < kIterations; ++i) {
    frame.timestamp_ns = 42 + i;
    tracking.timestamp_ns = frame.timestamp_ns;
    if (mk2_session_submit_frame(session, &frame, &tracking) != MK2_STATUS_OK) {
      mk2_session_destroy(session);
      return 1;
    }
  }
  const auto elapsed = std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - start).count();
  const double per_iteration = elapsed / kIterations;
  if (mk2_session_capture(session, &operation) != MK2_STATUS_OK ||
      mk2_session_pump(session, 1) != MK2_STATUS_OK) {
    mk2_session_destroy(session);
    return 1;
  }
  std::printf("{\"iterations\":%u,\"total_ms\":%.6f,\"per_iteration_ms\":%.6f}\n",
              kIterations, elapsed, per_iteration);
  mk2_session_destroy(session);
  return 0;
}
