#!/usr/bin/env python3

import argparse
import sys
import time

import cv2
import numpy as np

from hikrobot_wrapper import HikRobot, HikRobotError


def parse_args():
    parser = argparse.ArgumentParser(description="HikRobot Camera Test")
    parser.add_argument(
        "--exposure", type=float, default=10.0, help="Exposure time in ms (default: 3.0)"
    )
    parser.add_argument(
        "--gain", type=float, default=16.8, help="Gain value (default: 16.8)"
    )
    parser.add_argument(
        "--timeout", type=int, default=1000, help="Image grab timeout in ms (default: 1000)"
    )
    parser.add_argument(
        "--save", type=str, help="Save captured images to specified directory"
    )
    parser.add_argument(
        "--fps", type=int, default=30, help="Target FPS for display (default: 30)"
    )
    parser.add_argument(
        "--bayer", type=str, default="RG", choices=["RG", "GR", "GB", "BG"],
        help="Bayer pattern (default: RG)"
    )
    return parser.parse_args()


def main():
    args = parse_args()

    print(f"HikRobot Camera Test")
    print(f"Exposure: {args.exposure} ms")
    print(f"Gain: {args.gain}")
    print(f"Timeout: {args.timeout} ms")
    print(f"Target FPS: {args.fps}")
    print("Press 'q' to quit")
    print("-" * 50)

    try:
        camera = HikRobot()
        print(f"[OK] Library loaded, version: {camera.get_version()}")

        device_count = camera.enum_devices()
        print(f"[OK] Found {device_count} device(s)")

        if device_count == 0:
            print("[ERROR] No camera device found!")
            return 1

        print(f"[OK] Opening device index 0...")
        camera.open_device(device_index=0, exposure_ms=args.exposure, gain=args.gain)
        print(f"[OK] Device opened successfully")

        print(f"[OK] Starting grabbing...")
        camera.start_grabbing()
        print(f"[OK] Grabbing started")

        frame_interval = 1.0 / args.fps
        frame_count = 0
        start_time = time.time()
        format_logged = False

        window_name = "HikRobot Camera"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

        while True:
            loop_start = time.time()

            try:
                image_data, frame_info = camera.get_image(timeout_ms=args.timeout)

                if image_data is None:
                    print(f"[WARN] Timeout, no image received")
                    continue

                img_array = np.frombuffer(image_data, dtype=np.uint8)
                img = img_array.reshape((frame_info.height, frame_info.width, 3)).copy()

                if not format_logged:
                    print(f"[INFO] Pixel format: 0x{frame_info.pixel_format:08x}")
                    print(f"[INFO] Image size: {frame_info.width}x{frame_info.height}")
                    format_logged = True

                frame_count += 1
                elapsed = time.time() - start_time
                current_fps = frame_count / elapsed if elapsed > 0 else 0

                cv2.putText(
                    img,
                    f"Frame: {frame_count}  FPS: {current_fps:.1f}",
                    (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1,
                    (0, 255, 0),
                    2,
                )

                cv2.imshow(window_name, img)

                if args.save:
                    import os
                    os.makedirs(args.save, exist_ok=True)
                    filename = os.path.join(args.save, f"frame_{frame_count:06d}.png")
                    cv2.imwrite(filename, img)

            except HikRobotError as e:
                print(f"[ERROR] {e}")
                continue

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                print("User requested quit")
                break

            loop_elapsed = time.time() - loop_start
            if loop_elapsed < frame_interval:
                time.sleep(frame_interval - loop_elapsed)

        camera.stop_grabbing()
        print("[OK] Grabbing stopped")

        camera.close_device()
        print("[OK] Device closed")

        camera.destroy_camera()
        print("[OK] Camera destroyed")

        cv2.destroyAllWindows()

        print("-" * 50)
        print(f"[SUCCESS] Test completed! Total frames: {frame_count}")
        return 0

    except HikRobotError as e:
        print(f"[ERROR] {e}")
        return 1
    except FileNotFoundError as e:
        print(f"[ERROR] {e}")
        print("Make sure the library path is correct or build the C API first")
        return 1
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())