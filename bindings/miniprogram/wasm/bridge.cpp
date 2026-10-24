#include "makeup_sdk/makeup_sdk_v2_runtime.h"

#include <cstddef>
#include <cstdint>
#include <cstdlib>

namespace {

constexpr uint32_t kApiVersion = 2;

uint64_t join_u64(uint32_t low, uint32_t high) {
  return static_cast<uint64_t>(low) |
         (static_cast<uint64_t>(high) << 32U);
}

uint32_t low_u32(uint64_t value) {
  return static_cast<uint32_t>(value & 0xffffffffULL);
}

uint32_t high_u32(uint64_t value) {
  return static_cast<uint32_t>(value >> 32U);
}

template <typename T>
T* from_ptr(uint32_t address) {
  return reinterpret_cast<T*>(static_cast<uintptr_t>(address));
}

}  // namespace

extern "C" {

uint32_t mk2_wasm_api_version() {
  return kApiVersion;
}

mk2_session* mk2_wasm_create(uint32_t manifest_version) {
  mk2_config config{};
  config.api_version = kApiVersion;
  config.manifest_version = manifest_version;
  mk2_session* session = nullptr;
  if (mk2_session_create(&config, &session) != MK2_STATUS_OK) {
    return nullptr;
  }
  return session;
}

uint32_t mk2_wasm_destroy(mk2_session* session) {
  return mk2_session_destroy(session);
}

uint32_t mk2_wasm_bind_capabilities(
    mk2_session* session, uint32_t manifest_version, uint32_t renderer_version,
    uint32_t tracker_version, uint32_t max_frame_width,
    uint32_t max_frame_height, uint32_t camera_available,
    uint32_t tracker_available, uint32_t renderer_available,
    uint32_t lipstick_supported) {
  mk2_capabilities capabilities{};
  capabilities.api_version = kApiVersion;
  capabilities.manifest_version = manifest_version;
  capabilities.renderer_version = renderer_version;
  capabilities.tracker_version = tracker_version;
  capabilities.max_frame_width = max_frame_width;
  capabilities.max_frame_height = max_frame_height;
  capabilities.camera_available = camera_available != 0 ? 1 : 0;
  capabilities.tracker_available = tracker_available != 0 ? 1 : 0;
  capabilities.renderer_available = renderer_available != 0 ? 1 : 0;
  capabilities.supports_effects[MK2_EFFECT_LIPSTICK] =
      lipstick_supported != 0 ? 1 : 0;
  return mk2_session_bind_capabilities(session, &capabilities);
}

uint32_t mk2_wasm_initialize(mk2_session* session) {
  uint64_t operation_id = 0;
  return mk2_session_initialize(session, &operation_id);
}

uint32_t mk2_wasm_start(mk2_session* session) {
  uint64_t operation_id = 0;
  return mk2_session_start(session, &operation_id);
}

uint32_t mk2_wasm_stop(mk2_session* session) {
  uint64_t operation_id = 0;
  return mk2_session_stop(session, &operation_id);
}

uint32_t mk2_wasm_dispose(mk2_session* session) {
  return mk2_session_dispose(session);
}

uint32_t mk2_wasm_apply(mk2_session* session, uint32_t category,
                        uint32_t finish, uint32_t pattern_id_low,
                        uint32_t pattern_id_high, uint32_t argb,
                        float intensity) {
  mk2_effect_params params{};
  params.category = static_cast<mk2_effect_category>(category);
  params.finish = static_cast<mk2_finish>(finish);
  params.pattern_id = join_u64(pattern_id_low, pattern_id_high);
  params.argb = argb;
  params.intensity = intensity;
  uint64_t operation_id = 0;
  return mk2_session_apply(session, &params, &operation_id);
}

uint32_t mk2_wasm_clear(mk2_session* session, uint32_t category) {
  uint64_t operation_id = 0;
  return mk2_session_clear(
      session, static_cast<mk2_effect_category>(category), &operation_id);
}

uint32_t mk2_wasm_clear_all(mk2_session* session) {
  uint64_t operation_id = 0;
  return mk2_session_clear_all(session, &operation_id);
}

uint32_t mk2_wasm_submit_frame(
    mk2_session* session, uint32_t timestamp_low, uint32_t timestamp_high,
    uint32_t width, uint32_t height, uint32_t pixel_format,
    uint32_t orientation_degrees, uint32_t mirrored, uint32_t data_address,
    uint32_t data_size, uint32_t tracking_timestamp_low,
    uint32_t tracking_timestamp_high, uint32_t face_count,
    float confidence) {
  mk2_frame frame{};
  frame.timestamp_ns = join_u64(timestamp_low, timestamp_high);
  frame.width = width;
  frame.height = height;
  frame.pixel_format = static_cast<mk2_pixel_format>(pixel_format);
  frame.orientation_degrees = orientation_degrees;
  frame.mirrored = mirrored != 0 ? 1 : 0;
  frame.data = from_ptr<const void>(data_address);
  frame.data_size = data_size;

  mk2_tracking_result tracking{};
  tracking.timestamp_ns =
      join_u64(tracking_timestamp_low, tracking_timestamp_high);
  tracking.face_count = face_count;
  tracking.confidence = confidence;
  return mk2_session_submit_frame(session, &frame, &tracking);
}

uint32_t mk2_wasm_capture(mk2_session* session) {
  uint64_t operation_id = 0;
  return mk2_session_capture(session, &operation_id);
}

uint32_t mk2_wasm_pump(mk2_session* session, uint32_t max_operations) {
  return mk2_session_pump(session, max_operations);
}

uint32_t mk2_wasm_poll_event(mk2_session* session, uint32_t event_address) {
  return mk2_session_poll_event(session, from_ptr<mk2_event>(event_address));
}

uint32_t mk2_wasm_get_state(const mk2_session* session) {
  mk2_state state = MK2_STATE_ERROR;
  if (mk2_session_get_state(session, &state) != MK2_STATUS_OK) {
    return 0xffffffffU;
  }
  return static_cast<uint32_t>(state);
}

uint32_t mk2_wasm_get_capabilities(const mk2_session* session,
                                   uint32_t output_address) {
  return mk2_session_get_capabilities(
      session, from_ptr<mk2_capabilities>(output_address));
}

uint32_t mk2_wasm_get_layer(const mk2_session* session, uint32_t category,
                            uint32_t output_address) {
  return mk2_session_get_layer(
      session, static_cast<mk2_effect_category>(category),
      from_ptr<mk2_layer_snapshot>(output_address));
}

uint32_t mk2_wasm_alloc(uint32_t size) {
  return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(std::malloc(size)));
}

void mk2_wasm_free(uint32_t address) {
  std::free(reinterpret_cast<void*>(static_cast<uintptr_t>(address)));
}

}  // extern "C"
