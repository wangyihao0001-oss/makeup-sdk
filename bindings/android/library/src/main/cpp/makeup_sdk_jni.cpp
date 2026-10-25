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
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeCreate(
    JNIEnv*, jclass, jint manifest_version) {
  mk2_config config{};
  config.api_version = 2;
  config.manifest_version = static_cast<uint32_t>(manifest_version);
  mk2_session* session = nullptr;
  if (mk2_session_create(&config, &session) != MK2_STATUS_OK) return 0;
  return session_to_handle(session);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeInitialize(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_initialize(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativePump(
    JNIEnv*, jclass, jlong handle, jint max_operations) {
  return static_cast<jint>(mk2_session_pump(
      session_from(handle), static_cast<uint32_t>(max_operations)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeStart(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_start(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeStop(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_stop(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeDispose(
    JNIEnv*, jclass, jlong handle) {
  return static_cast<jint>(mk2_session_dispose(session_from(handle)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeDestroy(
    JNIEnv*, jclass, jlong handle) {
  return static_cast<jint>(mk2_session_destroy(session_from(handle)));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeGetState(
    JNIEnv*, jclass, jlong handle) {
  mk2_state state = MK2_STATE_ERROR;
  const mk2_status status = mk2_session_get_state(session_from(handle), &state);
  return status == MK2_STATUS_OK ? static_cast<jint>(state) : -1;
}

extern "C" JNIEXPORT jintArray JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeGetCapabilities(
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

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeApply(
    JNIEnv*, jclass, jlong handle, jint category, jint finish,
    jlong pattern_id, jint argb, jfloat intensity) {
  mk2_effect_params params{};
  params.category = static_cast<mk2_effect_category>(category);
  params.finish = static_cast<mk2_finish>(finish);
  params.pattern_id = static_cast<uint64_t>(pattern_id);
  params.argb = static_cast<uint32_t>(argb);
  params.intensity = intensity;
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_apply(session_from(handle), &params, &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeClear(
    JNIEnv*, jclass, jlong handle, jint category) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_clear(
      session_from(handle), static_cast<mk2_effect_category>(category), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeClearAll(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_clear_all(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jint JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativeCapture(
    JNIEnv*, jclass, jlong handle) {
  uint64_t operation_id = 0;
  return static_cast<jint>(mk2_session_capture(session_from(handle), &operation_id));
}

extern "C" JNIEXPORT jlongArray JNICALL
Java_com_wangyihao0001_makeupsdk_MakeupSdkJava_nativePollEvent(
    JNIEnv* env, jclass, jlong handle) {
  mk2_event event{};
  if (mk2_session_poll_event(session_from(handle), &event) != MK2_STATUS_OK) return nullptr;
  jlong values[5] = {
      static_cast<jlong>(event.type), static_cast<jlong>(event.state),
      static_cast<jlong>(event.status), static_cast<jlong>(event.operation_id),
      static_cast<jlong>(event.category)};
  jlongArray result = env->NewLongArray(5);
  env->SetLongArrayRegion(result, 0, 5, values);
  return result;
}
