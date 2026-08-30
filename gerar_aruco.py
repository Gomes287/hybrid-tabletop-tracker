import cv2

dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)

marker = cv2.aruco.generateImageMarker(
    dictionary,
    1,
    600
)

cv2.imwrite("aruco_01.png", marker)

print("Criado: aruco_01.png")

