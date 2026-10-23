#include "makeup_sdk/makeup_sdk.h"

#include <cassert>

int main() {
  mk_session* session = nullptr;
  assert(mk_session_create(nullptr, &session) == MK_STATUS_OK);
  assert(mk_session_initialize(session) == MK_STATUS_OK);

  mk_capabilities capabilities{};
  assert(mk_session_get_capabilities(session, &capabilities) == MK_STATUS_OK);
  assert(capabilities.supports_lip == 1);

  const mk_makeup_layer lipstick{
      MK_CATEGORY_LIP, MK_FINISH_MATTE, 0xffc2185b, 0.85f};
  assert(mk_session_apply(session, &lipstick) == MK_STATUS_OK);
  assert(mk_session_clear(session, MK_CATEGORY_LIP) == MK_STATUS_OK);
  assert(mk_session_clear_all(session) == MK_STATUS_OK);
  assert(mk_session_destroy(session) == MK_STATUS_OK);
  return 0;
}

