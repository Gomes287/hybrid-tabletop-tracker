import cv2
import numpy as np

URL = "rtsp://192.168.10.107:8554/live"

cap = cv2.VideoCapture(URL, cv2.CAP_FFMPEG)

if not cap.isOpened():
    raise RuntimeError("Não foi possível abrir o stream RTSP.")

dictionary = cv2.aruco.getPredefinedDictionary(
    cv2.aruco.DICT_4X4_50
)

detector = cv2.aruco.ArucoDetector(dictionary)

print("Tracker iniciado. Pressione Q para sair.")

while True:
    ok, frame = cap.read()

    if not ok:
        print("Frame perdido.")
        break

    corners, ids, rejected = detector.detectMarkers(frame)

    if ids is not None:

        cv2.aruco.drawDetectedMarkers(frame, corners, ids)

        for marker_corners, marker_id in zip(corners, ids.flatten()):

            points = marker_corners[0]

            center_x = int(np.mean(points[:, 0]))
            center_y = int(np.mean(points[:, 1]))

            cv2.circle(
                frame,
                (center_x, center_y),
                6,
                (0, 255, 0),
                -1
            )

            text = f"ID {marker_id} | X={center_x} Y={center_y}"

            cv2.putText(
                frame,
                text,
                (center_x + 10, center_y - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2
            )

            print(
                f"ID {marker_id}: X={center_x}, Y={center_y}",
                end="\r"
            )

    cv2.imshow("Mini Tracker", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
