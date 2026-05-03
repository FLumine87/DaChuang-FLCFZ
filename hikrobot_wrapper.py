import ctypes
import os
from ctypes import POINTER, c_bool, c_char_p, c_float, c_int, c_uint, c_void_p, Structure
from typing import Optional, Tuple


class FrameInfo(Structure):
    _fields_ = [
        ("width", c_uint),
        ("height", c_uint),
        ("pixel_format", c_uint),
        ("frame_len", ctypes.c_uint64),
        ("timestamp", ctypes.c_uint64),
    ]


class HikRobotCamera(Structure):
    _fields_ = [
        ("handle", c_void_p),
        ("frame_info", FrameInfo),
        ("image_buffer", POINTER(ctypes.c_uint8)),
        ("buffer_size", c_uint),
        ("is_opened", c_bool),
        ("is_grabbing", c_bool),
        ("exposure_ms", c_float),
        ("gain", c_float),
        ("vid_pid", c_char_p),
    ]


MAX_DEVICE_NUM = 16
MAX_IMAGE_SIZE = 3840 * 2748 * 4


class HikRobotError(Exception):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


class HikRobot:
    PIXEL_FORMAT_BAYER_GR8 = 0x01080005
    PIXEL_FORMAT_BAYER_RG8 = 0x01080006
    PIXEL_FORMAT_BAYER_GB8 = 0x01080007
    PIXEL_FORMAT_BAYER_BG8 = 0x01080008
    PIXEL_FORMAT_BGR8_PACKED = 0x02100015

    HIK_OK = 0
    HIK_ERROR = -1
    HIK_DEVICE_NOT_FOUND = -2
    HIK_DEVICE_OPEN_FAILED = -3
    HIK_GRAB_FAILED = -4
    HIK_TIMEOUT = -5
    HIK_INVALID_PARAM = -6

    _ERROR_STRINGS = {
        HIK_OK: "Success",
        HIK_ERROR: "General error",
        HIK_DEVICE_NOT_FOUND: "Device not found",
        HIK_DEVICE_OPEN_FAILED: "Device open failed",
        HIK_GRAB_FAILED: "Grab failed",
        HIK_TIMEOUT: "Timeout",
        HIK_INVALID_PARAM: "Invalid parameter",
    }

    def __init__(self, lib_path: Optional[str] = None):
        if lib_path is None:
            lib_path = self._find_library()
        self._lib = ctypes.CDLL(lib_path)
        self._camera: Optional[POINTER(HikRobotCamera)] = None
        self._setup_functions()

    def _find_library(self) -> str:
        possible_paths = [
            "./libhikrobot.so",
            "./hikrobot/lib/amd64/libMvCameraControl.so",
            "./hikrobot/lib/arm64/libMvCameraControl.so",
            "/usr/local/lib/libhikrobot.so",
        ]
        for path in possible_paths:
            if os.path.exists(path):
                return path
        raise FileNotFoundError("hikrobot library not found")

    def _setup_functions(self):
        self._lib.hikrobot_get_version.restype = c_char_p

        self._lib.hikrobot_enum_devices.argtypes = [
            POINTER(HikRobotCamera), POINTER(c_int)
        ]
        self._lib.hikrobot_enum_devices.restype = c_int

        self._lib.hikrobot_create_camera.argtypes = [POINTER(POINTER(HikRobotCamera))]
        self._lib.hikrobot_create_camera.restype = c_int

        self._lib.hikrobot_destroy_camera.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_destroy_camera.restype = c_int

        self._lib.hikrobot_open_device.argtypes = [
            POINTER(HikRobotCamera), c_int, c_float, c_float
        ]
        self._lib.hikrobot_open_device.restype = c_int

        self._lib.hikrobot_close_device.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_close_device.restype = c_int

        self._lib.hikrobot_start_grabbing.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_start_grabbing.restype = c_int

        self._lib.hikrobot_stop_grabbing.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_stop_grabbing.restype = c_int

        self._lib.hikrobot_get_image.argtypes = [POINTER(HikRobotCamera), c_int]
        self._lib.hikrobot_get_image.restype = c_int

        self._lib.hikrobot_get_image_buffer.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_get_image_buffer.restype = POINTER(ctypes.c_uint8)

        self._lib.hikrobot_get_frame_info.argtypes = [POINTER(HikRobotCamera)]
        self._lib.hikrobot_get_frame_info.restype = POINTER(FrameInfo)

    def _check_error(self, ret: int):
        if ret != self.HIK_OK:
            msg = self._ERROR_STRINGS.get(ret, "Unknown error")
            raise HikRobotError(ret, msg)

    def get_version(self) -> str:
        result = self._lib.hikrobot_get_version()
        return result.decode('utf-8') if result else ""

    def enum_devices(self) -> int:
        cameras = (HikRobotCamera * MAX_DEVICE_NUM)()
        device_count = c_int(0)
        self._check_error(
            self._lib.hikrobot_enum_devices(cameras, device_count)
        )
        return device_count.value

    def create_camera(self) -> POINTER(HikRobotCamera):
        camera_ptr = POINTER(HikRobotCamera)()
        self._check_error(
            self._lib.hikrobot_create_camera(ctypes.byref(camera_ptr))
        )
        self._camera = camera_ptr
        return camera_ptr

    def open_device(self, device_index: int = 0, exposure_ms: float = 3.0, gain: float = 16.8):
        if self._camera is None:
            self.create_camera()
        self._check_error(
            self._lib.hikrobot_open_device(
                self._camera, device_index, c_float(exposure_ms), c_float(gain)
            )
        )

    def close_device(self):
        if self._camera is not None:
            self._lib.hikrobot_close_device(self._camera)

    def start_grabbing(self):
        if self._camera is None:
            raise HikRobotError(self.HIK_INVALID_PARAM, "Camera not opened")
        self._check_error(self._lib.hikrobot_start_grabbing(self._camera))

    def stop_grabbing(self):
        if self._camera is not None:
            self._lib.hikrobot_stop_grabbing(self._camera)

    def get_image(self, timeout_ms: int = 1000) -> Tuple[Optional[bytes], FrameInfo]:
        if self._camera is None:
            raise HikRobotError(self.HIK_INVALID_PARAM, "Camera not opened")

        ret = self._lib.hikrobot_get_image(self._camera, c_int(timeout_ms))

        if ret == self.HIK_TIMEOUT:
            return None, FrameInfo()

        if ret != self.HIK_OK:
            self._check_error(ret)

        frame_info_ptr = self._lib.hikrobot_get_frame_info(self._camera)
        frame_info = frame_info_ptr.contents

        buffer_ptr = self._lib.hikrobot_get_image_buffer(self._camera)
        if buffer_ptr:
            image_data = ctypes.string_at(
                buffer_ptr, frame_info.width * frame_info.height * 3
            )
            return image_data, frame_info

        return None, frame_info

    def destroy_camera(self):
        if self._camera is not None:
            self._lib.hikrobot_destroy_camera(self._camera)
            self._camera = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close_device()
        self.destroy_camera()
        return False

    def __del__(self):
        try:
            self.close_device()
            self.destroy_camera()
        except Exception:
            pass