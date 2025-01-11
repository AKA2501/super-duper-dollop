import streamlit as st
import numpy as np
import cv2
from PIL import Image
from sklearn.cluster import KMeans

# Set page config for wide layout and a custom title
st.set_page_config(page_title="Colour Aura", layout="wide")


def local_css(file_name):
    """Utility function to load local CSS."""
    with open(file_name) as f:
        st.markdown(f"<style>{f.read()}</style>", unsafe_allow_html=True)

local_css("style.css")

# ------------------------------ HELPER FUNCTIONS ------------------------------#

def get_dominant_color(image, mask, k=2):
    """Extract a dominant color from masked region (BGR image)."""
    masked_image = cv2.bitwise_and(image, image, mask=mask)
    reshaped = masked_image.reshape((-1, 3))
    reshaped = reshaped[np.any(reshaped > 0, axis=1)]

    if len(reshaped) == 0:
        return (128,128,128)

    k = min(k, len(reshaped))
    if k < 1:
        return (128,128,128)

    kmeans = KMeans(n_clusters=k)
    kmeans.fit(reshaped)
    dom_color = kmeans.cluster_centers_[0].astype(int)
    return tuple(dom_color)

def process_image(uploaded_file):
    """Detect face, approximate hair region, then generate a color palette based on brightness."""
    image = np.array(Image.open(uploaded_file))
    if len(image.shape) == 3 and image.shape[2] == 3:
        image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    else:
        image_bgr = image.copy()

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))

    palette = []
    for (x, y, w, h) in faces:
        # Approximate face region with ellipse
        face_mask = np.zeros(image_bgr.shape[:2], dtype=np.uint8)
        center = (x + w//2, y + h//2)
        axes = (w//2, h//2)
        cv2.ellipse(face_mask, center, axes, 0, 0, 360, 1, -1)

        # Approximate hair region: rectangle above the face
        hair_mask = np.zeros(image_bgr.shape[:2], dtype=np.uint8)
        hair_top = max(0, y - h//2)
        cv2.rectangle(hair_mask, (x, hair_top), (x + w, y), 1, -1)

        skin_color = get_dominant_color(image_bgr, face_mask)
        hair_color = get_dominant_color(image_bgr, hair_mask)

        avg_skin_brightness = sum(skin_color)/3.0
        avg_hair_brightness = sum(hair_color)/3.0

        # Very simplified palette logic based on brightness
        if avg_skin_brightness > 170:  # Light skin
            if avg_hair_brightness > 150:  # Light hair
                palette = ["#FFD700", "#FF7F50", "#FF69B4", "#CD5C5C", "#F08080"]
            else:  # Dark hair
                palette = ["#87CEEB", "#3CB371", "#4169E1", "#6A5ACD", "#00BFFF"]
        elif avg_skin_brightness < 110:  # Darker skin
            if avg_hair_brightness < 100:  # Dark hair
                palette = ["#4682B4", "#6495ED", "#5F9EA0", "#2E8B57", "#66CDAA"]
            else:  # Light/warm hair
                palette = ["#F5DEB3", "#F4A460", "#D2691E", "#A0522D", "#8B4513"]
        else:  # Medium skin
            if avg_hair_brightness < 120:
                palette = ["#FF4500", "#DAA520", "#FF6347", "#DC143C", "#B22222"]
            else:
                palette = ["#FFE4B5", "#E6E6FA", "#F08080", "#F0E68C", "#FFD700"]

        break  # Only the first detected face

    return palette


# ------------------------------ APP LAYOUT ------------------------------#

# 1) Large Title & short description
st.markdown("<h1 class='main-header'>COLOR AURA</h1>", unsafe_allow_html=True)

st.markdown("""
<div class='company-description' style="font-size: 18px; font-weight: bold; line-height: 1.6;">
Tone Hue is your go-to destination for professional color analysis consultations.
Our team of experienced color experts will guide you in discovering the perfect color palette
that complements your unique features and personal style.
We specialize in color analysis for makeup, clothing, and overall personal image enhancement,
helping you look and feel your best in every aspect of your life.
</div>
""", unsafe_allow_html=True)

# 2) Big, centered file uploader
st.markdown("<h2 class='upload-heading'>Upload an Image</h2>", unsafe_allow_html=True)
uploaded_file = st.file_uploader("", type=["png","jpg","jpeg"])

# 3) If user uploads a file, show side-by-side: image vs. color wheel
# 3) If user uploads a file, adjust the layout
if uploaded_file is not None:
    # Create two columns with the image and the circle
    col1, col2 = st.columns([1, 1.5], gap="medium")  # Adjusted ratios for alignment

    # Left column: Uploaded image
    with col1:
         st.image(uploaded_file, caption="Uploaded Image", width=350)
         st.markdown("</div>", unsafe_allow_html=True)

    # Right column: Circle and Title
    with col2:
        palette = process_image(uploaded_file)
        if palette:
            # Title above the circle
            st.markdown(
                """
                <div style="text-align: center; font-weight: bold; font-size: 20px; margin-bottom: 10px;">
                    Color Palette
                </div>
                """,
                unsafe_allow_html=True,
            )

            # Convert the palette into a conic gradient
            gradient_stops = ""
            slice_angle = 360 / len(palette)

            for i, color in enumerate(palette):
                start_angle = i * slice_angle
                end_angle = (i + 1) * slice_angle
                gradient_stops += f"{color} {start_angle}deg {end_angle}deg,"

            gradient_stops = gradient_stops.rstrip(',')

            # Circle below the title
            circle_html = f"""
            <div style="
                width: 350px;
                height: 350px;
                border-radius: 50%;
                background: conic-gradient({gradient_stops});
                margin: 0 auto;
            "></div>
            """
            st.markdown(circle_html, unsafe_allow_html=True)
        else:
            st.markdown(
                """
                <div style="text-align: center; font-size: 18px; margin-top: 20px;">
                    No face detected or no palette generated.
                </div>
                """,
                unsafe_allow_html=True,
            )


# 4) More content at the bottom: sub-headers and points
st.markdown("""
<div class='extra-content'>

<h2>Why Choose Tone Hue?</h2>
<ul>
  <li><strong>Expert Consultants:</strong> Our team members are trained in advanced color theory and image consulting, ensuring you receive accurate, in-depth advice.</li>
  <li><strong>Customized Approach:</strong> We tailor every consultation to your individual features and goals, offering results that reflect your personal style.</li>
  <li><strong>Holistic Services:</strong> From makeup and hair color advice to wardrobe coordination, we cover every aspect of your look.</li>
</ul>

<h2>Elevate Your Confidence</h2>
<ul>
  <li>Save time and money by choosing clothes and makeup shades that truly complement you.</li>
  <li>Never second-guess your outfit choices; mix and match colors with complete assurance.</li>
  <li>Stand out for all the right reasons—experience the transformative power of the perfect palette.</li>
</ul>

</div>
""", unsafe_allow_html=True)
