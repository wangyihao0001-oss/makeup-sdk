cmake_minimum_required(VERSION 3.20)
project(makeup_sdk VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(makeup_sdk_core STATIC
  core/src/makeup_sdk.cpp
  core/src/makeup_sdk_v2.cpp
  core/src/makeup_sdk_v2_runtime.cpp
)

target_include_directories(makeup_sdk_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/core/include
)

if(MSVC)
  target_compile_options(makeup_sdk_core PRIVATE /W4)
else()
  target_compile_options(makeup_sdk_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(makeup_sdk_smoke examples/cpp/smoke.cpp)
target_link_libraries(makeup_sdk_smoke PRIVATE makeup_sdk_core)

add_executable(makeup_sdk_core_v2_test examples/cpp/core_v2_test.cpp)
target_link_libraries(makeup_sdk_core_v2_test PRIVATE makeup_sdk_core)

add_executable(makeup_sdk_core_v2_c_header_test
  examples/c/core_v2_c_header_test.c
)
target_include_directories(makeup_sdk_core_v2_c_header_test
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/core/include
)

add_executable(makeup_sdk_v2_fake_ports_test
  examples/cpp/v2_fake_ports_test.cpp
)
target_link_libraries(makeup_sdk_v2_fake_ports_test PRIVATE makeup_sdk_core)

add_executable(makeup_sdk_v2_runtime_test
  examples/cpp/v2_runtime_test.cpp
)
target_link_libraries(makeup_sdk_v2_runtime_test PRIVATE makeup_sdk_core)

enable_testing()
add_test(NAME makeup_sdk_smoke COMMAND makeup_sdk_smoke)
add_test(NAME makeup_sdk_core_v2_test COMMAND makeup_sdk_core_v2_test)
add_test(NAME makeup_sdk_core_v2_c_header_test
         COMMAND makeup_sdk_core_v2_c_header_test)
add_test(NAME makeup_sdk_v2_fake_ports_test
         COMMAND makeup_sdk_v2_fake_ports_test)
add_test(NAME makeup_sdk_v2_runtime_test COMMAND makeup_sdk_v2_runtime_test)

find_program(NODE_EXECUTABLE node)
if(NODE_EXECUTABLE)
  add_test(
    NAME makeup_sdk_miniprogram_test
    COMMAND ${NODE_EXECUTABLE} --test
            ${CMAKE_CURRENT_SOURCE_DIR}/bindings/miniprogram/test/binding.test.mjs
  )
endif()

