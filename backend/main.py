import io
import os
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

# -----------------------------------------------------------------------------
# 1. TFLite / LiteRT Multi-Runtime Loader
# -----------------------------------------------------------------------------
Interpreter = None
runtime_name = "Unknown"

try:
    from ai_edge_litert.interpreter import Interpreter
    runtime_name = "ai-edge-litert"
except ImportError:
    try:
        from tflite_runtime.interpreter import Interpreter
        runtime_name = "tflite-runtime"
    except ImportError:
        try:
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter
            runtime_name = "tensorflow.lite"
        except ImportError:
            Interpreter = None
            runtime_name = "none"

# -----------------------------------------------------------------------------
# 2. Model Initialization
# -----------------------------------------------------------------------------
MODEL_CANDIDATE_PATHS = [
    os.path.join(os.path.dirname(__file__), "model", "agrapatha_vision_mobilenetv2.tflite"),
    os.path.join(os.path.dirname(__file__), "agrapatha_vision_mobilenetv2.tflite"),
    "model/agrapatha_vision_mobilenetv2.tflite",
    "agrapatha_vision_mobilenetv2.tflite",
]

interpreter = None
input_details = None
output_details = None
active_model_path = None
model_load_error = None

if Interpreter is not None:
    for candidate in MODEL_CANDIDATE_PATHS:
        if os.path.isfile(candidate):
            try:
                interpreter = Interpreter(model_path=candidate)
                interpreter.allocate_tensors()
                input_details = interpreter.get_input_details()
                output_details = interpreter.get_output_details()
                active_model_path = os.path.abspath(candidate)
                break
            except Exception as e:
                model_load_error = str(e)
else:
    model_load_error = "No supported TFLite interpreter runtime found in environment."

# Class mappings based on Keras flow_from_directory alphabetical sort:
# Index 0: Smoke
# Index 1: fire -> Fire / FIRE
# Index 2: non fire -> Non-Fire / SAFE
CLASSES_DISPLAY = ["Smoke", "Fire", "Non-Fire"]
CLASSES_FIRMWARE = ["SMOKE", "FIRE", "SAFE"]

# -----------------------------------------------------------------------------
# 3. FastAPI Application
# -----------------------------------------------------------------------------
app = FastAPI(
    title="AGRAPATHA — Vision AI Inference API",
    description="MobileNetV2 TFLite wildfire and smoke detection service for ESP32-CAM and React Dashboard.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB upload safety limit


@app.get("/")
def read_root():
    return {
        "status": "ok",
        "service": "AGRAPATHA Vision AI Inference Backend",
        "model": "MobileNetV2 (3-Class: Smoke, Fire, Non-Fire)",
        "model_ready": interpreter is not None,
        "runtime": runtime_name,
    }


@app.get("/health")
@app.get("/api/v1/health")
def read_health():
    return {
        "status": "healthy" if interpreter is not None else "degraded",
        "server": "AGRAPATHA AI Inference Service",
        "model_ready": interpreter is not None,
        "model_file_exists": active_model_path is not None,
        "model_path": active_model_path,
        "runtime": runtime_name,
        "python_version": sys.version,
        "error": model_load_error,
    }


def process_inference(image_bytes: bytes) -> dict:
    if interpreter is None or input_details is None or output_details is None:
        raise HTTPException(
            status_code=503,
            detail=f"TFLite model is not ready. Error: {model_load_error}",
        )

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image payload exceeds 10 MB maximum allowed size.",
        )

    start_time = time.perf_counter()

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image = image.resize((224, 224), Image.Resampling.BILINEAR)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    # MobileNetV2 preprocessing: (x / 127.5) - 1.0 -> range [-1.0, 1.0]
    img_array = np.array(image, dtype=np.float32)
    img_array = (img_array / 127.5) - 1.0
    input_tensor = np.expand_dims(img_array, axis=0)

    # Run inference
    interpreter.set_tensor(input_details[0]["index"], input_tensor)
    interpreter.invoke()
    output_tensor = interpreter.get_tensor(output_details[0]["index"])[0]

    inference_ms = (time.perf_counter() - start_time) * 1000.0

    smoke_score = float(output_tensor[0])
    fire_score = float(output_tensor[1])
    non_fire_score = float(output_tensor[2])

    predicted_idx = int(np.argmax(output_tensor))
    predicted_label = CLASSES_DISPLAY[predicted_idx]
    firmware_class = CLASSES_FIRMWARE[predicted_idx]
    confidence = float(output_tensor[predicted_idx])

    dashboard_scores = {
        "Non-Fire": round(non_fire_score, 4),
        "Smoke": round(smoke_score, 4),
        "Fire": round(fire_score, 4),
    }

    combined_scores = {
        **dashboard_scores,
        "SAFE": round(non_fire_score, 4),
        "SMOKE": round(smoke_score, 4),
        "FIRE": round(fire_score, 4),
    }

    sorted_scores = [
        {"class_name": "Fire", "score": round(fire_score, 4), "percentage": round(fire_score * 100.0, 2)},
        {"class_name": "Smoke", "score": round(smoke_score, 4), "percentage": round(smoke_score * 100.0, 2)},
        {"class_name": "Non-Fire", "score": round(non_fire_score, 4), "percentage": round(non_fire_score * 100.0, 2)},
    ]
    sorted_scores.sort(key=lambda x: x["score"], reverse=True)

    data_payload = {
        "predicted_label": predicted_label,
        "confidence": round(confidence, 4),
        "confidence_percentage": round(confidence * 100.0, 2),
        "scores": dashboard_scores,
        "sorted_scores": sorted_scores,
        "output_type": "probability",
        "inference_time_ms": round(inference_ms, 2),
        "input_resolution": [224, 224],
        "model_name": "MobileNetV2 (be-binus Railway)",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "success": True,
        "status": "success",
        "data": data_payload,
        "error": None,
        # Top-level fields for lightweight microcontroller clients (ESP32-CAM)
        "class": firmware_class,
        "predicted_label": predicted_label,
        "confidence": data_payload["confidence"],
        "confidence_percentage": data_payload["confidence_percentage"],
        "scores": combined_scores,
        "inference_time_ms": data_payload["inference_time_ms"],
        "model_name": data_payload["model_name"],
    }


@app.post("/api/v1/predict")
@app.post("/predict/fire")
@app.post("/predict")
async def predict_fire(request: Request, file: Optional[UploadFile] = File(None)):
    # 1. Handle multipart/form-data upload
    if file is not None:
        contents = await file.read()
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file payload received.")
        return process_inference(contents)

    # 2. Fallback to raw binary body (common for lightweight microcontrollers like ESP32-CAM)
    body = await request.body()
    if len(body) > 0:
        return process_inference(body)

    raise HTTPException(
        status_code=400,
        detail="No image uploaded. Provide an image in 'file' form field or as raw binary body.",
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
