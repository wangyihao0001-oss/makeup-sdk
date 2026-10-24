#include "makeup_sdk/makeup_sdk_v2.h"

#include <cassert>
#include <cstdint>

namespace {

void expect_event(mk2_session* session, mk2_event_type type, mk2_status status,
                  uint64_t operation_id) {
  mk2_event event{};
  assert(mk2_session_poll_event(session, &event) == MK2_STATUS_OK);
  assert(event.type == type);
  assert(event.status == status);
  assert(event.operation_id == operation_id);
}

void expect_event(mk2_session* session, mk2_event_type type, mk2_status status,
                  uint64_t operation_id, mk2_effect_category category) {
  mk2_event event{};
  assert(mk2_session_poll_event(session, &event) == MK2_STATUS_OK);
  assert(event.type == type);
  assert(event.status == status);
  assert(event.operation_id == operation_id);
  assert(event.category == category);
}

void expect_frame_event(mk2_session* session, mk2_status status) {
  mk2_event event{};
  assert(mk2_session_poll_event(session, &event) == MK2_STATUS_OK);
  assert(event.type == MK2_EVENT_FRAME_REJECTED);
  assert(event.status == status);
  assert(event.operation_id == 0);
}

void initialize(mk2_session* session) {
  uint64_t operation_id = 0;
  assert(mk2_session_initialize(session, &operation_id) == MK2_STATUS_OK);
  assert(operation_id == 1);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, operation_id);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, operation_id);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               operation_id);
}

void start_tracking(mk2_session* session) {
  uint64_t operation_id = 0;
  assert(mk2_session_start(session, &operation_id) == MK2_STATUS_OK);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, operation_id);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               operation_id);
}

void expect_layer_inactive(mk2_session* session, mk2_effect_category category) {
  mk2_layer_snapshot layer{};
  assert(mk2_session_get_layer(session, category, &layer) == MK2_STATUS_OK);
  assert(layer.active == 0);
}

}  // namespace

int main() {
  mk2_session* session = nullptr;
  const mk2_config config{2, 7};
  assert(mk2_session_create(&config, &session) == MK2_STATUS_OK);

  mk2_capabilities capabilities{};
  assert(mk2_session_get_capabilities(session, &capabilities) ==
         MK2_STATUS_OK);
  assert(capabilities.api_version == 2);
  assert(capabilities.manifest_version == 7);
  assert(capabilities.renderer_version == 0);
  for (uint8_t supported : capabilities.supports_effects) {
    assert(supported == 0);
  }

  initialize(session);
  start_tracking(session);

  const mk2_effect_params lipstick{MK2_EFFECT_LIPSTICK,
                                   MK2_FINISH_GLOSSY,
                                   1001,
                                   0xffc2185b,
                                   0.85f};
  uint64_t operation_id = 777;
  assert(mk2_session_apply(session, &lipstick, &operation_id) ==
         MK2_STATUS_UNSUPPORTED_EFFECT);
  assert(operation_id == 777);
  assert(mk2_session_apply(session, &lipstick, nullptr) ==
         MK2_STATUS_INVALID_ARGUMENT);
  expect_layer_inactive(session, MK2_EFFECT_LIPSTICK);

  uint64_t stale_clear = 0;
  uint64_t latest_clear = 0;
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &stale_clear) ==
         MK2_STATUS_OK);
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &latest_clear) ==
         MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED,
               MK2_STATUS_OPERATION_CANCELLED, stale_clear,
               MK2_EFFECT_LIPSTICK);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               latest_clear, MK2_EFFECT_LIPSTICK);

  uint64_t blush_clear = 0;
  uint64_t lip_clear = 0;
  assert(mk2_session_clear(session, MK2_EFFECT_BLUSH, &blush_clear) ==
         MK2_STATUS_OK);
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &lip_clear) ==
         MK2_STATUS_OK);
  assert(mk2_session_pump(session, 2) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               blush_clear, MK2_EFFECT_BLUSH);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               lip_clear, MK2_EFFECT_LIPSTICK);

  uint64_t pending_lip = 0;
  uint64_t pending_blush = 0;
  uint64_t clear_all = 0;
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &pending_lip) ==
         MK2_STATUS_OK);
  assert(mk2_session_clear(session, MK2_EFFECT_BLUSH, &pending_blush) ==
         MK2_STATUS_OK);
  assert(mk2_session_clear_all(session, &clear_all) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED,
               MK2_STATUS_OPERATION_CANCELLED, pending_lip,
               MK2_EFFECT_LIPSTICK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED,
               MK2_STATUS_OPERATION_CANCELLED, pending_blush,
               MK2_EFFECT_BLUSH);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               clear_all);

  uint64_t after_clear_all = 0;
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &after_clear_all) ==
         MK2_STATUS_OK);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               after_clear_all, MK2_EFFECT_LIPSTICK);
  expect_layer_inactive(session, MK2_EFFECT_LIPSTICK);
  expect_layer_inactive(session, MK2_EFFECT_BLUSH);

  uint8_t pixels[4] = {0, 0, 0, 255};
  const mk2_tracking_result valid_tracking{42, 1, 0.99f};
  mk2_frame frame{42, 1, 1, MK2_PIXEL_FORMAT_RGBA8, 0, 1, pixels,
                  sizeof(pixels)};

  frame.width = 4097;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.width = 1;

  frame.pixel_format = MK2_PIXEL_FORMAT_UNKNOWN;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.pixel_format = MK2_PIXEL_FORMAT_YUV420;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.pixel_format = MK2_PIXEL_FORMAT_RGBA8;

  frame.data_size = 3;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.data_size = sizeof(pixels);

  frame.orientation_degrees = 45;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.orientation_degrees = 0;

  frame.mirrored = 2;
  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);
  frame.mirrored = 1;

  const mk2_tracking_result invalid_confidence{42, 1, -1.0f};
  assert(mk2_session_submit_frame(session, &frame, &invalid_confidence) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);

  mk2_state state = MK2_STATE_IDLE;
  assert(mk2_session_get_state(session, &state) == MK2_STATUS_OK);
  assert(state == MK2_STATE_TRACKING);
  assert(mk2_session_capture(session, &operation_id) == MK2_STATUS_NO_FRAME);

  const mk2_tracking_result no_face{42, 0, 0.0f};
  assert(mk2_session_submit_frame(session, &frame, &no_face) ==
         MK2_STATUS_NO_FACE);
  expect_frame_event(session, MK2_STATUS_NO_FACE);
  const mk2_tracking_result multiple_faces{42, 2, 0.9f};
  assert(mk2_session_submit_frame(session, &frame, &multiple_faces) ==
         MK2_STATUS_MULTIPLE_FACES);
  expect_frame_event(session, MK2_STATUS_MULTIPLE_FACES);
  const mk2_tracking_result wrong_timestamp{43, 1, 0.9f};
  assert(mk2_session_submit_frame(session, &frame, &wrong_timestamp) ==
         MK2_STATUS_FRAME_INVALID);
  expect_frame_event(session, MK2_STATUS_FRAME_INVALID);

  assert(mk2_session_submit_frame(session, &frame, &valid_tracking) ==
         MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, 0);
  assert(mk2_session_get_state(session, &state) == MK2_STATUS_OK);
  assert(state == MK2_STATE_RENDERING);
  assert(mk2_session_capture(session, &operation_id) == MK2_STATUS_OK);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED,
               MK2_STATUS_RENDERER_UNAVAILABLE, operation_id);
  assert(mk2_session_get_state(session, &state) == MK2_STATUS_OK);
  assert(state == MK2_STATE_RENDERING);

  assert(mk2_session_stop(session, &operation_id) == MK2_STATUS_OK);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, operation_id);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED, MK2_STATUS_OK,
               operation_id);

  uint64_t pending_dispose = 0;
  assert(mk2_session_clear(session, MK2_EFFECT_LIPSTICK, &pending_dispose) ==
         MK2_STATUS_OK);
  assert(mk2_session_dispose(session) == MK2_STATUS_OK);
  expect_event(session, MK2_EVENT_OPERATION_COMPLETED,
               MK2_STATUS_OPERATION_CANCELLED, pending_dispose,
               MK2_EFFECT_LIPSTICK);
  expect_event(session, MK2_EVENT_STATE_CHANGED, MK2_STATUS_OK, 0);
  assert(mk2_session_dispose(session) == MK2_STATUS_OK);
  assert(mk2_session_get_state(session, &state) == MK2_STATUS_OK);
  assert(state == MK2_STATE_DISPOSED);
  assert(mk2_session_pump(session, 1) == MK2_STATUS_DISPOSED);
  assert(mk2_session_destroy(session) == MK2_STATUS_OK);
  assert(mk2_session_destroy(nullptr) == MK2_STATUS_INVALID_ARGUMENT);

  mk2_session* implicitly_disposed = nullptr;
  assert(mk2_session_create(nullptr, &implicitly_disposed) == MK2_STATUS_OK);
  assert(mk2_session_destroy(implicitly_disposed) == MK2_STATUS_OK);
  return 0;
}
