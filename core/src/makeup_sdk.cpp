#include "makeup_sdk/makeup_sdk.h"

#include <array>
#include <cstddef>
#include <new>

struct mk_session {
  static constexpr uint32_t kApiVersion = 1;

  bool initialized = false;
  std::array<bool, 4> has_layer{};
  std::array<mk_makeup_layer, 4> layers{};
};

namespace {

bool valid_category(mk_category category) {
  return category >= MK_CATEGORY_LIP && category <= MK_CATEGORY_BASE;
}

bool valid_layer(const mk_makeup_layer& layer) {
  return valid_category(layer.category) &&
         layer.finish >= MK_FINISH_MATTE &&
         layer.finish <= MK_FINISH_NATURAL &&
         layer.intensity >= 0.0f && layer.intensity <= 1.0f;
}

size_t category_index(mk_category category) {
  return static_cast<size_t>(category);
}

}  // namespace

extern "C" mk_status mk_session_create(const mk_config* config,
                                        mk_session** out_session) {
  if (out_session == nullptr) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  if (config != nullptr && config->api_version != 0 &&
      config->api_version != mk_session::kApiVersion) {
    return MK_STATUS_UNSUPPORTED;
  }

  auto* session = new (std::nothrow) mk_session();
  if (session == nullptr) {
    return MK_STATUS_INTERNAL_ERROR;
  }
  *out_session = session;
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_initialize(mk_session* session) {
  if (session == nullptr) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  session->initialized = true;
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_get_capabilities(
    const mk_session* session, mk_capabilities* out_capabilities) {
  if (session == nullptr || out_capabilities == nullptr) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  if (!session->initialized) {
    return MK_STATUS_NOT_INITIALIZED;
  }
  *out_capabilities = {mk_session::kApiVersion, 1, 1, 1, 1};
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_apply(mk_session* session,
                                       const mk_makeup_layer* layer) {
  if (session == nullptr || layer == nullptr) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  if (!session->initialized) {
    return MK_STATUS_NOT_INITIALIZED;
  }
  if (!valid_layer(*layer)) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  const auto index = category_index(layer->category);
  session->layers[index] = *layer;
  session->has_layer[index] = true;
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_clear(mk_session* session,
                                       mk_category category) {
  if (session == nullptr || !valid_category(category)) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  if (!session->initialized) {
    return MK_STATUS_NOT_INITIALIZED;
  }
  session->has_layer[category_index(category)] = false;
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_clear_all(mk_session* session) {
  if (session == nullptr) {
    return MK_STATUS_INVALID_ARGUMENT;
  }
  if (!session->initialized) {
    return MK_STATUS_NOT_INITIALIZED;
  }
  session->has_layer.fill(false);
  return MK_STATUS_OK;
}

extern "C" mk_status mk_session_destroy(mk_session* session) {
  delete session;
  return MK_STATUS_OK;
}

