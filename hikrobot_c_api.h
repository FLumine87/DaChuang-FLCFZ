#ifndef HIKROBOT_C_API_H
#define HIKROBOT_C_API_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MAX_DEVICE_NUM 16
#define MAX_IMAGE_SIZE (3840 * 2748 * 4)

typedef enum {
    HIK_OK = 0,
    HIK_ERROR = -1,
    HIK_DEVICE_NOT_FOUND = -2,
    HIK_DEVICE_OPEN_FAILED = -3,
    HIK_GRAB_FAILED = -4,
    HIK_TIMEOUT = -5,
    HIK_INVALID_PARAM = -6
} HikRobotError;

typedef enum {
    PIXEL_FORMAT_BAYER_GR8 = 0x01080005,
    PIXEL_FORMAT_BAYER_RG8 = 0x01080006,
    PIXEL_FORMAT_BAYER_GB8 = 0x01080007,
    PIXEL_FORMAT_BAYER_BG8 = 0x01080008,
    PIXEL_FORMAT_BGR8_PACKED = 0x02100015
} PixelFormat;

typedef struct {
    uint32_t width;
    uint32_t height;
    PixelFormat pixel_format;
    uint64_t frame_len;
    uint64_t timestamp;
} FrameInfo;

typedef struct {
    void* handle;
    FrameInfo frame_info;
    uint8_t* image_buffer;
    uint32_t buffer_size;
    bool is_opened;
    bool is_grabbing;
    float exposure_ms;
    float gain;
    char vid_pid[32];
} HikRobotCamera;

const char* hikrobot_get_version(void);

HikRobotError hikrobot_enum_devices(HikRobotCamera* cameras, int* device_count);

HikRobotError hikrobot_create_camera(HikRobotCamera** camera);

HikRobotError hikrobot_destroy_camera(HikRobotCamera* camera);

HikRobotError hikrobot_open_device(HikRobotCamera* camera, int device_index, float exposure_ms, float gain);

HikRobotError hikrobot_close_device(HikRobotCamera* camera);

HikRobotError hikrobot_start_grabbing(HikRobotCamera* camera);

HikRobotError hikrobot_stop_grabbing(HikRobotCamera* camera);

HikRobotError hikrobot_get_image(HikRobotCamera* camera, int timeout_ms);

uint8_t* hikrobot_get_image_buffer(HikRobotCamera* camera);

FrameInfo* hikrobot_get_frame_info(HikRobotCamera* camera);

const char* hikrobot_error_string(HikRobotError error);

#ifdef __cplusplus
}
#endif

#endif