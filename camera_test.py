import cv2

URL = "rtsp://192.168.10.107:8554/live"

cap = cv2.VideoCapture(URL, cv2.CAP_FFMPEG)

if not cap.isOpened():
    raise RuntimeError("Não foi possível abrir o stream RTSP.")

print("Stream conectado.")

while True:
    ok, frame = cap.read()

    if not ok:
        print("Frame perdido.")
        break

    cv2.imshow("Mini Tracker - Camera", frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
