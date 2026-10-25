#import "MakeupSDK.h"

#include "makeup_sdk/makeup_sdk_v2.h"

#ifndef MAKEUP_SDK_VERSION_STRING
#define MAKEUP_SDK_VERSION_STRING "0.1.0"
#endif

NSString * const MakeupSDKVersion = @MAKEUP_SDK_VERSION_STRING;

static mk2_session *session_from(void *value) {
  return reinterpret_cast<mk2_session *>(value);
}

@implementation MakeupSDKObjC

- (instancetype)initWithManifestVersion:(uint32_t)manifestVersion {
  self = [super init];
  if (self) {
    mk2_config config = {2, manifestVersion};
    mk2_session *session = nullptr;
    if (mk2_session_create(&config, &session) != MK2_STATUS_OK) {
      return nil;
    }
    _session = session;
  }
  return self;
}

- (int)initialize {
  uint64_t operation = 0;
  return (int)mk2_session_initialize(session_from(_session), &operation);
}

- (int)pump:(uint32_t)maxOperations {
  return (int)mk2_session_pump(session_from(_session), maxOperations);
}

- (int)start {
  uint64_t operation = 0;
  return (int)mk2_session_start(session_from(_session), &operation);
}

- (int)stop {
  uint64_t operation = 0;
  return (int)mk2_session_stop(session_from(_session), &operation);
}

- (int)state {
  mk2_state state = MK2_STATE_ERROR;
  if (mk2_session_get_state(session_from(_session), &state) != MK2_STATUS_OK) return -1;
  return (int)state;
}

- (NSArray<NSNumber *> *)capabilities {
  mk2_capabilities capabilities = {};
  if (mk2_session_get_capabilities(session_from(_session), &capabilities) != MK2_STATUS_OK) return nil;
  return @[
    @(capabilities.api_version),
    @(capabilities.manifest_version),
    @(capabilities.max_frame_width),
    @(capabilities.max_frame_height),
    @(capabilities.renderer_available),
    @(capabilities.supports_effects[MK2_EFFECT_LIPSTICK])
  ];
}

- (int)dispose {
  if (!_session) return MK2_STATUS_OK;
  int status = (int)mk2_session_dispose(session_from(_session));
  mk2_session_destroy(session_from(_session));
  _session = nullptr;
  return status;
}

- (void)dealloc {
  [self dispose];
}

@end
