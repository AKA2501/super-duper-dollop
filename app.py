import streamlit as st
import numpy as np
import cv2
from PIL import Image
import face_recognition
from sklearn.cluster import KMeans

def local_css(file_name):
    with open(file_name) as f:
        st.markdown(f'<style>{f.read()}</style>', unsafe_allow_html=True)

local_css("style.css")

def get_dominant_color(image, mask, k=5):
    masked_image = cv2.bitwise_and(image, image, mask=mask)
    reshaped_img = masked_image.reshape((-1, 3))
    reshaped_img = reshaped_img[np.any(reshaped_img > 0, axis=1)]
    kmeans = KMeans(n_clusters=min(k, len(reshaped_img)))
    kmeans.fit(reshaped_img)
    dominant_colors = kmeans.cluster_centers_.astype(int)
    return ['#%02x%02x%02x' % tuple(color) for color in dominant_colors]

def process_image(uploaded_file):
    image = np.array(Image.open(uploaded_file))
    face_locations = face_recognition.face_locations(image)
    palette = []
    if face_locations:
        face_landmarks_list = face_recognition.face_landmarks(image)
        for face_landmarks in face_landmarks_list:
            all_face_landmarks = np.array([
                point for landmark_type in face_landmarks.values() for point in landmark_type
            ])
            mask = np.zeros(image.shape[:2], dtype=np.uint8)
            cv2.fillConvexPoly(mask, cv2.convexHull(all_face_landmarks), 255)
            dominant_colors = get_dominant_color(image, mask, k=5)
            palette.extend(dominant_colors)
    return palette

st.markdown("<h1>Discover</h1>", unsafe_allow_html=True)
st.markdown("""
<p class='header'>Unlock the Power of Colors with Us</p>

### Color Analysis
<p class='info'>Color Analyst is your go-to destination for professional color analysis consultations. Our team of experienced color experts will guide you in discovering the perfect color palette that complements your unique features and personal style. We specialize in color analysis for makeup, clothing, and overall personal image enhancement, helping you look and feel your best in every aspect of your life.</p>

### Discover Your Palette
<p class='info'>Our color analysis service helps you identify the most flattering colors for your skin tone, hair color, and eye color. By understanding your unique color palette, you can make informed choices when it comes to makeup, clothing, and accessories, ensuring that every choice enhances your natural beauty.</p>

### Wardrobe Color Matching
<p class='info'>Coordinate with Confidence. Wardrobe color matching is essential for creating cohesive and stylish outfits that reflect your personal style. Our experts will help you build a versatile wardrobe filled with colors that suit you best, making it easier to mix and match pieces and create effortlessly stylish looks every day.</p>
""", unsafe_allow_html=True)

uploaded_file = st.file_uploader("Upload an image...", type=['jpg', 'jpeg', 'png'])
if uploaded_file is not None:
    color_palette = process_image(uploaded_file)
    st.image(uploaded_file, caption='Uploaded Image', use_container_width=True)
    st.write("Color Palette:")
    st.markdown(
        f"<div style='display: flex; flex-direction: row; align-items: center;'>"
        + "".join(
            f"<div style='background-color: {color}; height: 50px; width: 100px; margin: 10px;'></div><span style='margin-top: 10px; margin-right: 20px;'>{color}</span>"
            for color in color_palette
        )
        + "</div>",
        unsafe_allow_html=True,
    )
