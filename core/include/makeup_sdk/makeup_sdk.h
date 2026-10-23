#ifndef MAKEUP_SDK_H_
#define MAKEUP_SDK_H_

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mk_session mk_session;

typedef enum mk_status {
  MK_STATUS_OK = 0,
  MK_STATUS_INVALID_ARGUMENT = 1,
  MK_STATUS_NOT_INITIALIZED = 2,
  MK_STATUS_UNSUPPORTED = 3,
  MK_STATUS_INTERNAL_ERROR = 4
} mk_status;

typedef enum mk_category {
  MK_CATEGORY_LIP = 0,
  MK_CATEGORY_BLUSH = 1,
  MK_CATEGORY_EYE = 2,
  MK_CATEGORY_BASE = 3
} mk_category;

typedef enum mk_finish {
  MK_FINISH_MATTE = 0,
  MK_FINISH_GLOSSY = 1,
  MK_FINISH_SHIMMER = 2,
  MK_FINISH_NATURAL = 3
} mk_finish;

typedef struct mk_config {
  uint32_t api_version;
} mk_config;

typedef struct mk_makeup_layer {
  mk_category category;
  mk_finish finish;
  uint32_t argb;
  float intensity;
} mk_makeup_layer;

typedef struct mk_capabilities {
  uint32_t api_version;
  uint8_t supports_lip;
  uint8_t supports_blush;
  uint8_t supports_eye;
  uint8_t supports_base;
} mk_capabilities;

mk_status mk_session_create(const mk_config* config, mk_session** out_session);
mk_status mk_session_initialize(mk_session* session);
mk_status mk_session_get_capabilities(const mk_session* session,
                                      mk_capabilities* out_capabilities);
mk_status mk_session_apply(mk_session* session,
                           const mk_makeup_layer* layer);
mk_status mk_session_clear(mk_session* session, mk_category category);
mk_status mk_session_clear_all(mk_session* session);
mk_status mk_session_destroy(mk_session* session);

#ifdef __cplusplus
}
#endif

#endif  // MAKEUP_SDK_H_

