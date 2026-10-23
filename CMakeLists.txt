cmake_minimum_required(VERSION 3.20)
project(makeup_sdk VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(makeup_sdk_core STATIC
  core/src/makeup_sdk.cpp
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

enable_testing()
add_test(NAME makeup_sdk_smoke COMMAND makeup_sdk_smoke)

