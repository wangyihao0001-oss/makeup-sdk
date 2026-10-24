#include <jni.h>

#include <cstdint>

#include "makeup_sdk/makeup_sdk_v2.h"

namespace {

mk2_session* session_from(jlong handle) {
  return reinterpret_cast<mk2_session*>(static_cast<uintptr_t>(handle));
}

jlong session_to_handle(mk2_session* session) {
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(session));
}

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeCreate(
    JNIEnv*, jclass, jint manifest_version) {
  mk2_config config{};
  config.api_version = 2;
  config.manifest_version = static_cast<uint32_t>(manifest_version);
  mk2_session* session = nullptr;
  if (mk2_session_create(&config, &session) != MK2_STATUS_OK) return 0;
  return session_to_handle(session);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeInitialize(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_initialize(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativePump(
    JNIEnv*, jclass, jlong handle, jint max_operations) {
  return static_cast<jint>(mk2_session_pump(
      session_from(handle), static_cast<uint32_t>(max_operations)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeStart(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_start(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeStop(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_stop(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeDispose(
    JNIEnv*, jclass, jlong handle) {
  return static_cast<jint>(mk2_session_dispose(session_from(handle)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeDestroy(
    JNIEnv*, jclass, jlong handle) {
  return static_cast<jint>(mk2_session_destroy(session_from(handle)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeGetState(
    JNIEnv*, jclass, jlong handle) {
  mk2_state state = MK2_STATE_ERROR;
  const mk2_status status = mk2_session_get_state(session_from(handle), &state);
  return status == MK2_STATUS_OK ? static_cast<jint>(state) : -1;
}

extern "C" JNIEXPORT jintArray JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdk_nativeGetCapabilities(
    JNIEnv* env, jclass, jlong handle) {
  mk2_capabilities capabilities{};
  if (mk2_session_get_capabilities(session_from(handle), &capabilities) != MK2_STATUS_OK) {
    return nullptr;
  }
  jint values[6] = {
      static_cast<jint>(capabilities.api_version),
      static_cast<jint>(capabilities.manifest_version),
      static_cast<jint>(capabilities.max_frame_width),
      static_cast<jint>(capabilities.max_frame_height),
      static_cast<jint>(capabilities.renderer_available),
      static_cast<jint>(capabilities.supports_effects[MK2_EFFECT_LIPSTICK])};
  jintArray result = env->NewIntArray(6);
  env->SetIntArrayRegion(result, 0, 6, values);
  return result;
}
