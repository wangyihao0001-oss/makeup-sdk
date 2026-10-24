#ifndef MAKEUP_SDK_V2_H_
#define MAKEUP_SDK_V2_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mk2_session mk2_session;

typedef enum mk2_status {
  MK2_STATUS_OK = 0,
  MK2_STATUS_INVALID_ARGUMENT = 1,
  MK2_STATUS_INVALID_STATE = 2,
  MK2_STATUS_NOT_INITIALIZED = 3,
  MK2_STATUS_UNSUPPORTED_EFFECT = 4,
  MK2_STATUS_NO_FACE = 5,
  MK2_STATUS_MULTIPLE_FACES = 6,
  MK2_STATUS_NO_FRAME = 7,
  MK2_STATUS_CAPTURE_FAILED = 8,
  MK2_STATUS_OPERATION_CANCELLED = 9,
  MK2_STATUS_DISPOSED = 10,
  MK2_STATUS_INTERNAL_ERROR = 11,
  MK2_STATUS_NO_EVENT = 12,
  /* Appended values preserve the existing v2 status numbering. */
  MK2_STATUS_FRAME_INVALID = 13,
  MK2_STATUS_RENDERER_UNAVAILABLE = 14,
  MK2_STATUS_CAMERA_PERMISSION_DENIED = 15,
  MK2_STATUS_TRACKER_UNAVAILABLE = 16,
  MK2_STATUS_MODEL_LOAD_FAILED = 17,
  MK2_STATUS_ASSET_LOAD_FAILED = 18,
  MK2_STATUS_GPU_CONTEXT_LOST = 19
} mk2_status;

typedef enum mk2_effect_category {
  MK2_EFFECT_LIPSTICK = 0,
  MK2_EFFECT_MASCARA = 1,
  MK2_EFFECT_EYELINER = 2,
  MK2_EFFECT_EYESHADOW = 3,
  MK2_EFFECT_BLUSH = 4,
  MK2_EFFECT_FOUNDATION = 5,
  MK2_EFFECT_COUNT = 6
} mk2_effect_category;

typedef enum mk2_finish {
  MK2_FINISH_MATTE = 0,
  MK2_FINISH_GLOSSY = 1,
  MK2_FINISH_SHIMMER = 2,
  MK2_FINISH_GLITTER = 3
} mk2_finish;

typedef enum mk2_state {
  MK2_STATE_IDLE = 0,
  MK2_STATE_LOADING = 1,
  MK2_STATE_READY = 2,
  MK2_STATE_TRACKING = 3,
  MK2_STATE_RENDERING = 4,
  MK2_STATE_CAPTURED = 5,
  MK2_STATE_UNSUPPORTED = 6,
  MK2_STATE_ERROR = 7,
  MK2_STATE_DISPOSED = 8
} mk2_state;

typedef enum mk2_event_type {
  MK2_EVENT_STATE_CHANGED = 0,
  MK2_EVENT_OPERATION_COMPLETED = 1,
  MK2_EVENT_FRAME_REJECTED = 2,
  MK2_EVENT_RESOURCE_PROGRESS = 3,
  MK2_EVENT_TRACKING_STATUS = 4,
  MK2_EVENT_ERROR = 5
} mk2_event_type;

typedef enum mk2_pixel_format {
  MK2_PIXEL_FORMAT_UNKNOWN = 0,
  MK2_PIXEL_FORMAT_RGBA8 = 1,
  MK2_PIXEL_FORMAT_BGRA8 = 2,
  MK2_PIXEL_FORMAT_YUV420 = 3
} mk2_pixel_format;

typedef struct mk2_config {
  uint32_t api_version;
  uint32_t manifest_version;
} mk2_config;

typedef struct mk2_effect_params {
  mk2_effect_category category;
  mk2_finish finish;
  uint64_t pattern_id;
  uint32_t argb;
  float intensity;
} mk2_effect_params;

typedef struct mk2_capabilities {
  uint32_t api_version;
  uint32_t manifest_version;
  uint32_t renderer_version;
  uint8_t supports_effects[MK2_EFFECT_COUNT];
  uint32_t max_frame_width;
  uint32_t max_frame_height;
  uint32_t tracker_version;
  uint8_t camera_available;
  uint8_t tracker_available;
  uint8_t renderer_available;
  uint8_t reserved;
} mk2_capabilities;

typedef struct mk2_frame {
  uint64_t timestamp_ns;
  uint32_t width;
  uint32_t height;
  mk2_pixel_format pixel_format;
  uint32_t orientation_degrees;
  uint8_t mirrored;
  const void* data;
  size_t data_size;
} mk2_frame;

typedef struct mk2_tracking_result {
  uint64_t timestamp_ns;
  uint32_t face_count;
  float confidence;
} mk2_tracking_result;

typedef struct mk2_event {
  mk2_event_type type;
  mk2_state state;
  mk2_status status;
  uint64_t operation_id;
  mk2_effect_category category;
} mk2_event;

typedef struct mk2_layer_snapshot {
  uint8_t active;
  mk2_effect_params params;
} mk2_layer_snapshot;

/* Capture metadata is stable across bindings; image ownership is port-specific. */
typedef struct mk2_capture_metadata {
  uint64_t timestamp_ns;
  uint32_t width;
  uint32_t height;
  uint32_t orientation_degrees;
  uint8_t mirrored;
  uint8_t reserved[3];
  uint32_t api_version;
  uint32_t manifest_version;
  uint32_t renderer_version;
} mk2_capture_metadata;

/* v2 uses a host-driven queue. No SDK-owned worker threads are created. */
mk2_status mk2_session_create(const mk2_config* config, mk2_session** out_session);
mk2_status mk2_session_initialize(mk2_session* session, uint64_t* out_operation_id);
mk2_status mk2_session_start(mk2_session* session, uint64_t* out_operation_id);
mk2_status mk2_session_stop(mk2_session* session, uint64_t* out_operation_id);
mk2_status mk2_session_dispose(mk2_session* session);
mk2_status mk2_session_destroy(mk2_session* session);

mk2_status mk2_session_get_state(const mk2_session* session,
                                 mk2_state* out_state);
mk2_status mk2_session_get_capabilities(const mk2_session* session,
                                        mk2_capabilities* out_capabilities);

mk2_status mk2_session_apply(mk2_session* session,
                             const mk2_effect_params* params,
                             uint64_t* out_operation_id);
mk2_status mk2_session_clear(mk2_session* session,
                             mk2_effect_category category,
                             uint64_t* out_operation_id);
mk2_status mk2_session_clear_all(mk2_session* session,
                                 uint64_t* out_operation_id);

mk2_status mk2_session_submit_frame(mk2_session* session,
                                    const mk2_frame* frame,
                                    const mk2_tracking_result* tracking);
mk2_status mk2_session_capture(mk2_session* session,
                               uint64_t* out_operation_id);

/* Advances at most max_operations queued operations and emits events. */
mk2_status mk2_session_pump(mk2_session* session, uint32_t max_operations);
mk2_status mk2_session_poll_event(mk2_session* session, mk2_event* out_event);

mk2_status mk2_session_get_layer(const mk2_session* session,
                                 mk2_effect_category category,
                                 mk2_layer_snapshot* out_layer);

#ifdef __cplusplus
}
#endif

#endif  // MAKEUP_SDK_V2_H_
