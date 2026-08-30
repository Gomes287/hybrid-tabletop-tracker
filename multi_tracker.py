import cv2
import numpy as np
import time

URL = "rtsp://192.168.10.107:8554/live"

cap = cv2.VideoCapture(URL, cv2.CAP_FFMPEG)

if not cap.isOpened():
    raise RuntimeError("Não foi possível abrir o stream RTSP.")

dictionary = cv2.aruco.getPredefinedDictionary(
    cv2.aruco.DICT_4X4_50
)

detector = cv2.aruco.ArucoDetector(dictionary)

print("Multi Tracker iniciado. Pressione Q para sair.")

while True:
    ok, frame = cap.read()

    if not ok:
        print("Frame perdido.")
        break

    corners, ids, rejected = detector.detectMarkers(frame)

    detected = []

    if ids is not None:

        cv2.aruco.drawDetectedMarkers(frame, corners, ids)

        for marker_corners, marker_id in zip(
            corners,
            ids.flatten()
        ):
            points = marker_corners[0]

            center_x = int(np.mean(points[:, 0]))
            center_y = int(np.mean(points[:, 1]))

            detected.append(
                (int(marker_id), center_x, center_y)
            )

            cv2.circle(
                frame,
                (center_x, center_y),
                5,
                (0, 255, 0),
                -1
            )

            cv2.putText(
                frame,
                f"ID {marker_id}",
                (center_x + 8, center_y - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2
            )

    detected.sort()

    # Painel lateral/superior
    cv2.rectangle(
        frame,
        (10, 10),
        (280, 45 + 25 * max(len(detected), 1)),
        (0, 0, 0),
        -1
    )

    cv2.putText(
        frame,
        f"MINIS DETECTADAS: {len(detected)}",
        (20, 35),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 255, 255),
        2
    )

    for i, (marker_id, x, y) in enumerate(detected):
        cv2.putText(
            frame,
            f"ID {marker_id:02d}   X={x:4d}   Y={y:4d}",
            (20, 65 + i * 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1
        )

    cv2.imshow("Multi Mini Tracker", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
