cmake_minimum_required(VERSION 3.20)
project(MakeupSDK LANGUAGES C CXX OBJCXX)

get_filename_component(MAKEUP_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
file(STRINGS "${MAKEUP_ROOT}/VERSION" MAKEUP_IOS_VERSION LIMIT_COUNT 1)

add_library(MakeupSDK STATIC
  src/MakeupSDK.mm
  "${MAKEUP_ROOT}/core/src/makeup_sdk.cpp"
  "${MAKEUP_ROOT}/core/src/makeup_sdk_v2.cpp"
  "${MAKEUP_ROOT}/core/src/makeup_sdk_v2_runtime.cpp"
)

target_include_directories(MakeupSDK PUBLIC
  "${CMAKE_CURRENT_LIST_DIR}/include"
  "${MAKEUP_ROOT}/core/include"
)
target_compile_features(MakeupSDK PUBLIC cxx_std_17)
target_compile_options(MakeupSDK PRIVATE -fobjc-arc)
target_compile_definitions(MakeupSDK PRIVATE
  MAKEUP_SDK_VERSION_STRING=\"${MAKEUP_IOS_VERSION}\"
)
set_target_properties(MakeupSDK PROPERTIES
  OUTPUT_NAME "MakeupSDK"
  PUBLIC_HEADER "${CMAKE_CURRENT_LIST_DIR}/include/MakeupSDK.h"
)
