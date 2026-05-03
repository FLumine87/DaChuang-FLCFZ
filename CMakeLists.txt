cmake_minimum_required(VERSION 3.10)
project(hikrobot_c_api)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCV REQUIRED)

include_directories(${OpenCV_INCLUDE_DIRS})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/hikrobot/include)

set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})

add_library(hikrobot SHARED
    hikrobot_c_api.cpp
)

target_link_libraries(hikrobot
    ${OpenCV_LIBS}
    ${CMAKE_CURRENT_SOURCE_DIR}/hikrobot/lib/amd64/libMvCameraControl.so
    usb-1.0
)

set_target_properties(hikrobot PROPERTIES
    VERSION 1.0.0
    SOVERSION 1
    PUBLIC_HEADER hikrobot_c_api.h
)

install(TARGETS hikrobot
    LIBRARY DESTINATION ${CMAKE_CURRENT_SOURCE_DIR}
    PUBLIC_HEADER DESTINATION ${CMAKE_CURRENT_SOURCE_DIR}
)