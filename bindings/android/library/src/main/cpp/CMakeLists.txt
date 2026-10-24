cmake_minimum_required(VERSION 3.22)
project(makeup_sdk_android LANGUAGES C CXX)

get_filename_component(MAKEUP_ROOT
    "${CMAKE_CURRENT_LIST_DIR}/../../../../../.." ABSOLUTE)

add_library(makeup_sdk_core STATIC
    "${MAKEUP_ROOT}/core/src/makeup_sdk.cpp"
    "${MAKEUP_ROOT}/core/src/makeup_sdk_v2.cpp"
    "${MAKEUP_ROOT}/core/src/makeup_sdk_v2_runtime.cpp"
)
target_include_directories(makeup_sdk_core PUBLIC
    "${MAKEUP_ROOT}/core/include"
)
target_compile_features(makeup_sdk_core PUBLIC cxx_std_17)

add_library(makeup_sdk_android SHARED makeup_sdk_jni.cpp)
target_compile_features(makeup_sdk_android PRIVATE cxx_std_17)
target_include_directories(makeup_sdk_android PRIVATE
    "${MAKEUP_ROOT}/core/include"
)
target_link_libraries(makeup_sdk_android PRIVATE makeup_sdk_core log)
