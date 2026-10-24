cmake_minimum_required(VERSION 3.20)
project(makeup_sdk VERSION 0.1.0 LANGUAGES C CXX)

option(MAKEUP_BUILD_WASM "Build the standalone WebAssembly core artifact" OFF)

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
if(NOT EMSCRIPTEN)
  add_test(NAME makeup_sdk_smoke COMMAND makeup_sdk_smoke)
  add_test(NAME makeup_sdk_core_v2_test COMMAND makeup_sdk_core_v2_test)
  add_test(NAME makeup_sdk_core_v2_c_header_test
           COMMAND makeup_sdk_core_v2_c_header_test)
  add_test(NAME makeup_sdk_v2_fake_ports_test
           COMMAND makeup_sdk_v2_fake_ports_test)
  add_test(NAME makeup_sdk_v2_runtime_test COMMAND makeup_sdk_v2_runtime_test)
endif()

find_program(NODE_EXECUTABLE node)
if(NODE_EXECUTABLE)
  add_test(
    NAME makeup_sdk_miniprogram_test
    COMMAND ${NODE_EXECUTABLE} --test
            ${CMAKE_CURRENT_SOURCE_DIR}/bindings/miniprogram/test/binding.test.mjs
  )
endif()

if(MAKEUP_BUILD_WASM)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "MAKEUP_BUILD_WASM requires configuring through emcmake")
  endif()
  if(NOT NODE_EXECUTABLE)
    message(FATAL_ERROR "MAKEUP_BUILD_WASM requires Node.js to generate the artifact manifest")
  endif()

  set(MAKEUP_WASM_DIST_DIR
      "${CMAKE_CURRENT_SOURCE_DIR}/bindings/miniprogram/dist")
  file(MAKE_DIRECTORY "${MAKEUP_WASM_DIST_DIR}")

  add_executable(makeup_sdk_core_wasm
    bindings/miniprogram/wasm/bridge.cpp
  )
  target_link_libraries(makeup_sdk_core_wasm PRIVATE makeup_sdk_core)
  set_target_properties(makeup_sdk_core_wasm PROPERTIES
    OUTPUT_NAME "makeup_sdk_core"
    SUFFIX ".wasm"
    RUNTIME_OUTPUT_DIRECTORY "${MAKEUP_WASM_DIST_DIR}"
  )
  target_link_options(makeup_sdk_core_wasm PRIVATE
    "-sSTANDALONE_WASM=1"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sERROR_ON_UNDEFINED_SYMBOLS=1"
    "--no-entry"
    "-sEXPORTED_FUNCTIONS=['_mk2_wasm_api_version','_mk2_wasm_create','_mk2_wasm_destroy','_mk2_wasm_bind_capabilities','_mk2_wasm_initialize','_mk2_wasm_start','_mk2_wasm_stop','_mk2_wasm_dispose','_mk2_wasm_apply','_mk2_wasm_clear','_mk2_wasm_clear_all','_mk2_wasm_submit_frame','_mk2_wasm_capture','_mk2_wasm_pump','_mk2_wasm_poll_event','_mk2_wasm_get_state','_mk2_wasm_get_capabilities','_mk2_wasm_get_layer','_mk2_wasm_alloc','_mk2_wasm_free']"
  )

  add_custom_command(TARGET makeup_sdk_core_wasm POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E env
      MAKEUP_SDK_VERSION=${PROJECT_VERSION}
      MAKEUP_MANIFEST_VERSION=1
      MAKEUP_WASM_VERSION=${PROJECT_VERSION}-wasm1
      ${NODE_EXECUTABLE}
      "${CMAKE_CURRENT_SOURCE_DIR}/bindings/miniprogram/scripts/build-manifest.mjs"
      "${MAKEUP_WASM_DIST_DIR}/makeup_sdk_core.wasm"
      "${MAKEUP_WASM_DIST_DIR}/manifest.json"
    BYPRODUCTS "${MAKEUP_WASM_DIST_DIR}/manifest.json"
    VERBATIM
  )

  add_test(
    NAME makeup_sdk_miniprogram_wasm_test
    COMMAND ${NODE_EXECUTABLE} --test
            ${CMAKE_CURRENT_SOURCE_DIR}/bindings/miniprogram/test/wasm.test.mjs
  )
endif()

