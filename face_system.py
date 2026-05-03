#!/usr/bin/env python3

import pickle
import os
import cv2
import numpy as np

from hikrobot_wrapper import HikRobot, HikRobotError
import face_recognition
from deepface import DeepFace

ENCODINGS_FILE = "encodings.pickle"
KNOWN_FACES_DIR = "known_faces"

def load_encodings():
    if not os.path.exists(ENCODINGS_FILE):
        return [], []
    with open(ENCODINGS_FILE, "rb") as f:
        data = pickle.load(f)
    print(f"[系统] 已加载 {len(data['names'])} 个已注册的人")
    return data["encodings"], data["names"]

def save_encodings(known_encodings, known_names):
    data = {"encodings": known_encodings, "names": known_names}
    with open(ENCODINGS_FILE, "wb") as f:
        pickle.dump(data, f)
    print(f"[系统] 已保存 {len(known_names)} 个人的数据到 {ENCODINGS_FILE}")

def register_face(frame, face_location, name, known_encodings, known_names):
    top, right, bottom, left = face_location
    face_image = frame[top:bottom, left:right]

    rgb_face = cv2.cvtColor(face_image, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb_face)

    if len(encodings) > 0:
        known_encodings.append(encodings[0])
        known_names.append(name)
        save_encodings(known_encodings, known_names)

        os.makedirs(KNOWN_FACES_DIR, exist_ok=True)
        img_path = os.path.join(KNOWN_FACES_DIR, f"{name}.jpg")
        cv2.imwrite(img_path, face_image)
        print(f"[成功] 已注册用户: {name}")
        return True, known_encodings, known_names
    else:
        print("[错误] 无法从该区域检测到人脸")
        return False, known_encodings, known_names

def analyze_emotion(face_roi):
    try:
        analysis = DeepFace.analyze(
            img_path=face_roi,
            actions=['emotion'],
            enforce_detection=False,
            silent=True
        )
        emotion = analysis[0]['dominant_emotion']
        return emotion
    except Exception:
        return "neutral"

def main():
    print("初始化人脸识别系统...")
    known_encodings, known_names = load_encodings()

    camera = HikRobot()

    try:
        print(f"[OK] Library loaded, version: {camera.get_version()}")

        device_count = camera.enum_devices()
        print(f"[OK] Found {device_count} device(s)")

        if device_count == 0:
            print("[错误] 未找到相机设备!")
            return 1

        camera.open_device(device_index=0, exposure_ms=10.0, gain=16.8)
        print("[OK] 相机已打开")

        camera.start_grabbing()
        print("[OK] 相机已开始采集")
        print("\n系统就绪。")
        print("操作说明：")
        print("  - 按 'r' 键：注册画面中框选的人脸（窗口会暂停，请在终端输入姓名）")
        print("  - 按 'q' 键：退出程序\n")

        face_locations = []
        current_face_location = None
        current_frame = None
        frame_counter = 0
        emotion_cache = {}

        while True:
            try:
                image_data, frame_info = camera.get_image(timeout_ms=1000)
                if image_data is None:
                    continue

                img_array = np.frombuffer(image_data, dtype=np.uint8)
                frame = img_array.reshape((frame_info.height, frame_info.width, 3)).copy()

            except HikRobotError as e:
                print(f"[错误] {e}")
                continue

            small_frame = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
            rgb_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

            face_locations = face_recognition.face_locations(rgb_small)
            face_encodings = face_recognition.face_encodings(rgb_small, face_locations)

            for i, ((top, right, bottom, left), face_encoding) in enumerate(zip(face_locations, face_encodings)):
                top *= 2
                right *= 2
                bottom *= 2
                left *= 2

                name = "Unknown"
                if len(known_encodings) > 0:
                    distances = face_recognition.face_distance(known_encodings, face_encoding)
                    best_match_idx = np.argmin(distances)
                    if distances[best_match_idx] < 0.6:
                        name = known_names[best_match_idx]

                face_id = f"{top}_{left}"
                if frame_counter % 5 == 0 or face_id not in emotion_cache:
                    face_roi = frame[top:bottom, left:right]
                    if face_roi.size > 0:
                        emotion = analyze_emotion(face_roi)
                        emotion_cache[face_id] = emotion
                else:
                    emotion = emotion_cache.get(face_id, "neutral")

                color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
                cv2.rectangle(frame, (left, top), (right, bottom), color, 2)

                label = f"{name} [{emotion}]"
                label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                cv2.rectangle(frame, (left, top-25), (left+label_size[0], top), color, -1)
                cv2.putText(frame, label, (left, top-5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                current_face_location = (top, right, bottom, left)
                current_frame = frame

            if len(face_locations) == 0:
                current_face_location = None

            info = f"Faces: {len(face_locations)} | Frame: {frame_counter}"
            cv2.putText(frame, info, (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            cv2.imshow('Face Recognition System', frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('r'):
                if face_locations and current_face_location is not None:
                    print("\n" + "=" * 40)
                    person_name = input("请输入要注册的姓名: ").strip()
                    print("=" * 40 + "\n")
                    if person_name:
                        success, known_encodings, known_names = register_face(
                            current_frame, current_face_location, person_name,
                            known_encodings, known_names)
                    else:
                        print("注册取消：姓名不能为空。")
                else:
                    print("注册失败：画面中没有检测到人脸")

            frame_counter += 1

        camera.stop_grabbing()
        camera.close_device()
        camera.destroy_camera()
        cv2.destroyAllWindows()

        print("[系统] 已退出")
        return 0

    except HikRobotError as e:
        print(f"[错误] {e}")
        return 1
    except FileNotFoundError as e:
        print(f"[错误] {e}")
        print("请确保已编译C库并安装依赖")
        return 1
    except Exception as e:
        print(f"[错误] {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    import sys
    sys.exit(main())