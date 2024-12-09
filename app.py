import streamlit as st
import numpy as np
import cv2
from PIL import Image
from sklearn.cluster import KMeans

def local_css(file_name):
    with open(file_name) as f:
        st.markdown(f'<style>{f.read()}</style>', unsafe_allow_html=True)

# Helper function to extract dominant color
def get_dominant_color(image, mask, k=2):
    masked_image = cv2.bitwise_and(image, image, mask=mask)
    reshaped_img = masked_image.reshape((-1, 3))
    reshaped_img = reshaped_img[np.any(reshaped_img > 0, axis=1)]

    if len(reshaped_img) == 0:
        # If no pixels are found under the mask, return a neutral color
        return (128, 128, 128)

    k = min(k, len(reshaped_img))
    if k < 1:
        return (128, 128, 128)

    kmeans = KMeans(n_clusters=k)
    kmeans.fit(reshaped_img)
    dominant_color = kmeans.cluster_centers_[0].astype(int)
    return tuple(dominant_color)

def process_image(uploaded_file):
    image = np.array(Image.open(uploaded_file))
    if len(image.shape) == 3 and image.shape[2] == 3:
        image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    else:
        image_bgr = image.copy()

    # Use OpenCV's Haar cascade for face detection
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))

    palette = []
    for (x, y, w, h) in faces:
        # Approximate face mask: an ellipse inside the bounding box
        face_mask = np.zeros(image_bgr.shape[:2], dtype=np.uint8)
        center = (x + w//2, y + h//2)
        axes = (w//2, h//2)
        cv2.ellipse(face_mask, center, axes, 0, 0, 360, 1, -1)

        # Approximate hair region: a rectangle above the face
        hair_mask = np.zeros(image_bgr.shape[:2], dtype=np.uint8)
        hair_top = max(0, y - h//2)  # extend half the face height above
        cv2.rectangle(hair_mask, (x, hair_top), (x + w, y), 1, -1)

        # Extract skin and hair color using the approximated masks
        skin_color = get_dominant_color(image_bgr, face_mask)
        hair_color = get_dominant_color(image_bgr, hair_mask)

        # Use average RGB value to classify skin tone
        avg_skin_brightness = (skin_color[0] + skin_color[1] + skin_color[2]) / 3
        avg_hair_brightness = (hair_color[0] + hair_color[1] + hair_color[2]) / 3

        # Refined palette selection based on skin and hair color
        if avg_skin_brightness > 170:  # Lighter skin
            if avg_hair_brightness > 150:  # Light or warm hair (blonde/red)
                palette = ["#FFD700", "#FF7F50", "#FF69B4", "#CD5C5C", "#F08080"]  # Vibrant tones
            else:  # Darker hair
                palette = ["#87CEEB", "#3CB371", "#4169E1", "#6A5ACD", "#00BFFF"]  # Cool tones
        elif avg_skin_brightness < 110:  # Darker skin
            if avg_hair_brightness < 100:  # Dark hair (black/brown)
                palette = ["#4682B4", "#6495ED", "#5F9EA0", "#2E8B57", "#66CDAA"]  # Muted cool tones
            else:  # Light or warm hair
                palette = ["#F5DEB3", "#F4A460", "#D2691E", "#A0522D", "#8B4513"]  # Earthy tones
        else:  # Medium skin tones
            if avg_hair_brightness < 120:  # Darker hair
                palette = ["#FF4500", "#DAA520", "#FF6347", "#DC143C", "#B22222"]  # Warm tones
            else:
                palette = ["#FFE4B5", "#E6E6FA", "#F08080", "#F0E68C", "#FFD700"]  # Soft pastels

        break  # Process only the first detected face

    return palette

# --- STREAMLIT APP ---
local_css("style.css")

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
