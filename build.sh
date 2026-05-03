#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    LIB_PATH="hikrobot/lib/amd64/libMvCameraControl.so"
elif [ "$ARCH" = "aarch64" ]; then
    LIB_PATH="hikrobot/lib/arm64/libMvCameraControl.so"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Building for architecture: $ARCH"
echo "Using library: $LIB_PATH"

if [ ! -d "build" ]; then
    mkdir build
fi

cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)

echo ""
echo "Build completed!"
echo "Library: $SCRIPT_DIR/libhikrobot.so"
echo "Public header: $SCRIPT_DIR/hikrobot_c_api.h"
echo ""
echo "To test the camera, run:"
echo "  python3 ../test_camera.py"