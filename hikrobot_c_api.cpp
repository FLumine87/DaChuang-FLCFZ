#include "hikrobot_c_api.h"

#include <cstring>
#include <opencv2/opencv.hpp>

extern "C" {
#include "MvCameraControl.h"
#include "PixelType.h"
}

namespace {

constexpr unsigned int kUsbDeviceType = MV_USB_DEVICE;

struct CameraContext {
    void* handle;
    bool is_opened;
    bool is_grabbing;
    MV_CC_DEVICE_INFO_LIST device_list;
    cv::Mat latest_image;
    FrameInfo latest_frame_info;
};

PixelFormat mv_pixel_type_to_enum(unsigned int mv_type) {
    switch (mv_type) {
        case PixelType_Gvsp_BayerGR8: return PIXEL_FORMAT_BAYER_GR8;
        case PixelType_Gvsp_BayerRG8: return PIXEL_FORMAT_BAYER_RG8;
        case PixelType_Gvsp_BayerGB8: return PIXEL_FORMAT_BAYER_GB8;
        case PixelType_Gvsp_BayerBG8: return PIXEL_FORMAT_BAYER_BG8;
        case PixelType_Gvsp_BGR8_Packed: return PIXEL_FORMAT_BGR8_PACKED;
        default: return PIXEL_FORMAT_BAYER_GR8;
    }
}

void bayer_to_bgr(const cv::Mat& bayer, cv::Mat& bgr, unsigned int pixel_type) {
    switch (pixel_type) {
        case PixelType_Gvsp_BayerGR8:
            cv::cvtColor(bayer, bgr, cv::COLOR_BayerGR2RGB);
            break;
        case PixelType_Gvsp_BayerRG8:
            cv::cvtColor(bayer, bgr, cv::COLOR_BayerRG2RGB);
            break;
        case PixelType_Gvsp_BayerGB8:
            cv::cvtColor(bayer, bgr, cv::COLOR_BayerGB2RGB);
            break;
        case PixelType_Gvsp_BayerBG8:
            cv::cvtColor(bayer, bgr, cv::COLOR_BayerBG2RGB);
            break;
        default:
            bgr = bayer.clone();
            break;
    }
}

}

const char* hikrobot_get_version(void) {
    return "1.0.0";
}

HikRobotError hikrobot_enum_devices(HikRobotCamera* cameras, int* device_count) {
    if (!cameras || !device_count) {
        return HIK_INVALID_PARAM;
    }

    MV_CC_DEVICE_INFO_LIST device_list = {};
    int ret = MV_CC_EnumDevices(kUsbDeviceType, &device_list);
    if (ret != MV_OK) {
        return HIK_ERROR;
    }

    *device_count = static_cast<int>(device_list.nDeviceNum);
    for (unsigned int i = 0; i < device_list.nDeviceNum && i < MAX_DEVICE_NUM; ++i) {
        cameras[i].handle = nullptr;
        cameras[i].is_opened = false;
        cameras[i].is_grabbing = false;
        cameras[i].image_buffer = nullptr;
        cameras[i].buffer_size = 0;
    }

    return HIK_OK;
}

HikRobotError hikrobot_create_camera(HikRobotCamera** camera) {
    if (!camera) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = new CameraContext();
    ctx->handle = nullptr;
    ctx->is_opened = false;
    ctx->is_grabbing = false;

    *camera = new HikRobotCamera();
    (*camera)->handle = ctx;
    (*camera)->is_opened = false;
    (*camera)->is_grabbing = false;
    (*camera)->image_buffer = nullptr;
    (*camera)->buffer_size = 0;
    (*camera)->exposure_ms = 3.0f;
    (*camera)->gain = 16.8f;
    memset((*camera)->vid_pid, 0, sizeof((*camera)->vid_pid));

    return HIK_OK;
}

HikRobotError hikrobot_destroy_camera(HikRobotCamera* camera) {
    if (!camera) {
        return HIK_INVALID_PARAM;
    }

    if (camera->is_grabbing) {
        hikrobot_stop_grabbing(camera);
    }
    if (camera->is_opened) {
        hikrobot_close_device(camera);
    }

    if (camera->handle) {
        delete static_cast<CameraContext*>(camera->handle);
    }
    delete camera;

    return HIK_OK;
}

HikRobotError hikrobot_open_device(HikRobotCamera* camera, int device_index, float exposure_ms, float gain) {
    if (!camera || !camera->handle) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = static_cast<CameraContext*>(camera->handle);

    MV_CC_DEVICE_INFO_LIST device_list = {};
    int ret = MV_CC_EnumDevices(kUsbDeviceType, &device_list);
    if (ret != MV_OK || device_list.nDeviceNum == 0) {
        return HIK_DEVICE_NOT_FOUND;
    }

    if (device_index < 0 || static_cast<unsigned int>(device_index) >= device_list.nDeviceNum) {
        return HIK_DEVICE_NOT_FOUND;
    }

    ret = MV_CC_CreateHandle(&ctx->handle, device_list.pDeviceInfo[device_index]);
    if (ret != MV_OK) {
        return HIK_DEVICE_OPEN_FAILED;
    }

    ret = MV_CC_OpenDevice(ctx->handle, MV_ACCESS_Exclusive, 0);
    if (ret != MV_OK) {
        MV_CC_DestroyHandle(ctx->handle);
        ctx->handle = nullptr;
        return HIK_DEVICE_OPEN_FAILED;
    }

    MV_CC_SetEnumValue(ctx->handle, "BalanceWhiteAuto", MV_BALANCEWHITE_AUTO_OFF);
    MV_CC_SetEnumValue(ctx->handle, "ExposureAuto", MV_EXPOSURE_AUTO_MODE_OFF);
    MV_CC_SetEnumValue(ctx->handle, "GainAuto", MV_GAIN_MODE_OFF);
    MV_CC_SetFloatValue(ctx->handle, "ExposureTime", exposure_ms * 1000.0f);
    MV_CC_SetFloatValue(ctx->handle, "Gain", gain);
    MV_CC_SetFrameRate(ctx->handle, 150);
    MV_CC_SetFloatValue(ctx->handle, "Gamma", 1.0f);
    MV_CC_SetEnumValue(ctx->handle, "BalanceRatioSelector", 0);
    MV_CC_SetFloatValue(ctx->handle, "BalanceRatio", 1.6f);
    MV_CC_SetEnumValue(ctx->handle, "BalanceRatioSelector", 1);
    MV_CC_SetFloatValue(ctx->handle, "BalanceRatio", 1.8f);
    MV_CC_SetEnumValue(ctx->handle, "BalanceRatioSelector", 2);
    MV_CC_SetFloatValue(ctx->handle, "BalanceRatio", 1.4f);

    camera->is_opened = true;
    camera->exposure_ms = exposure_ms;
    camera->gain = gain;

    return HIK_OK;
}

HikRobotError hikrobot_close_device(HikRobotCamera* camera) {
    if (!camera || !camera->handle) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = static_cast<CameraContext*>(camera->handle);

    if (ctx->is_grabbing) {
        hikrobot_stop_grabbing(camera);
    }

    if (ctx->handle) {
        MV_CC_CloseDevice(ctx->handle);
        MV_CC_DestroyHandle(ctx->handle);
        ctx->handle = nullptr;
    }

    camera->is_opened = false;
    return HIK_OK;
}

HikRobotError hikrobot_start_grabbing(HikRobotCamera* camera) {
    if (!camera || !camera->handle || !camera->is_opened) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = static_cast<CameraContext*>(camera->handle);

    int ret = MV_CC_StartGrabbing(ctx->handle);
    if (ret != MV_OK) {
        return HIK_GRAB_FAILED;
    }

    ctx->is_grabbing = true;
    camera->is_grabbing = true;

    return HIK_OK;
}

HikRobotError hikrobot_stop_grabbing(HikRobotCamera* camera) {
    if (!camera || !camera->handle) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = static_cast<CameraContext*>(camera->handle);

    if (ctx->handle && ctx->is_grabbing) {
        MV_CC_StopGrabbing(ctx->handle);
    }

    ctx->is_grabbing = false;
    camera->is_grabbing = false;

    return HIK_OK;
}

HikRobotError hikrobot_get_image(HikRobotCamera* camera, int timeout_ms) {
    if (!camera || !camera->handle || !camera->is_opened) {
        return HIK_INVALID_PARAM;
    }

    auto* ctx = static_cast<CameraContext*>(camera->handle);

    MV_FRAME_OUT raw = {};
    int ret = MV_CC_GetImageBuffer(ctx->handle, &raw, timeout_ms);
    if (ret != MV_OK) {
        if (ret == 0x40001013) {
            return HIK_TIMEOUT;
        }
        return HIK_GRAB_FAILED;
    }

    cv::Mat img(cv::Size(raw.stFrameInfo.nWidth, raw.stFrameInfo.nHeight), CV_8UC1, raw.pBufAddr);

    unsigned int pixel_type = raw.stFrameInfo.enPixelType;

    if (pixel_type != PixelType_Gvsp_BGR8_Packed) {
        cv::Mat bgr_img;
        bayer_to_bgr(img, bgr_img, pixel_type);
        ctx->latest_image = bgr_img;
    } else {
        ctx->latest_image = img.clone();
    }

    ctx->latest_frame_info.width = raw.stFrameInfo.nWidth;
    ctx->latest_frame_info.height = raw.stFrameInfo.nHeight;
    ctx->latest_frame_info.pixel_format = mv_pixel_type_to_enum(pixel_type);
    ctx->latest_frame_info.frame_len = raw.stFrameInfo.nFrameLen;
    ctx->latest_frame_info.timestamp = 0;

    MV_CC_FreeImageBuffer(ctx->handle, &raw);

    if (camera->image_buffer) {
        delete[] camera->image_buffer;
    }

    camera->buffer_size = static_cast<unsigned int>(ctx->latest_image.total() * ctx->latest_image.elemSize());
    camera->image_buffer = new uint8_t[camera->buffer_size];
    memcpy(camera->image_buffer, ctx->latest_image.data, camera->buffer_size);

    camera->frame_info = ctx->latest_frame_info;

    return HIK_OK;
}

uint8_t* hikrobot_get_image_buffer(HikRobotCamera* camera) {
    if (!camera) {
        return nullptr;
    }
    return camera->image_buffer;
}

FrameInfo* hikrobot_get_frame_info(HikRobotCamera* camera) {
    if (!camera) {
        return nullptr;
    }
    return &camera->frame_info;
}

const char* hikrobot_error_string(HikRobotError error) {
    switch (error) {
        case HIK_OK: return "Success";
        case HIK_ERROR: return "General error";
        case HIK_DEVICE_NOT_FOUND: return "Device not found";
        case HIK_DEVICE_OPEN_FAILED: return "Device open failed";
        case HIK_GRAB_FAILED: return "Grab failed";
        case HIK_TIMEOUT: return "Timeout";
        case HIK_INVALID_PARAM: return "Invalid parameter";
        default: return "Unknown error";
    }
}