import cv2
import numpy as np

# A4 a 300 DPI
DPI = 300
MM_TO_PX = DPI / 25.4

PAGE_W = int(210 * MM_TO_PX)
PAGE_H = int(297 * MM_TO_PX)

# Marcador: 20 x 20 mm
MARKER_MM = 20
MARKER_PX = int(MARKER_MM * MM_TO_PX)

# Margem branca ao redor
MARGIN_MM = 3
MARGIN_PX = int(MARGIN_MM * MM_TO_PX)

CELL = MARKER_PX + 2 * MARGIN_PX

page = np.ones((PAGE_H, PAGE_W), dtype=np.uint8) * 255

dictionary = cv2.aruco.getPredefinedDictionary(
    cv2.aruco.DICT_4X4_50
)

# 5 colunas x 2 linhas
cols = 5
rows = 2

total_w = cols * CELL
total_h = rows * CELL

start_x = (PAGE_W - total_w) // 2
start_y = (PAGE_H - total_h) // 2

for i in range(10):
    marker_id = i + 1

    marker = cv2.aruco.generateImageMarker(
        dictionary,
        marker_id,
        MARKER_PX
    )

    row = i // cols
    col = i % cols

    x = start_x + col * CELL + MARGIN_PX
    y = start_y + row * CELL + MARGIN_PX

    page[
        y:y + MARKER_PX,
        x:x + MARKER_PX
    ] = marker

    cv2.putText(
        page,
        f"ID {marker_id}",
        (x, y + MARKER_PX + int(2.5 * MM_TO_PX)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.35,
        0,
        1,
        cv2.LINE_AA
    )

cv2.imwrite("aruco_ids_01_10.png", page)

print("Folha criada: aruco_ids_01_10.png")
print("Imprimir em A4, 100% / tamanho real.")
