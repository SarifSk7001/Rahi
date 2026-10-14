import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import car, navigation, sos

# Load backend/.env early so all services see TOMTOM_API_KEY, WATSONX_APIKEY, etc.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="NAGAR AI - CoolWalk Engine",
    description="Heat-aware and safety-aware walking route recommendations",
    version="2.0.0",
)


# --------------------------------------------------
# CORS
# --------------------------------------------------
# Vite's dev server runs on port 5173 by default. For a deployed frontend,
# set CORS_ORIGINS to a comma-separated list, for example:
#   CORS_ORIGINS=https://coolwalk.example.com,http://localhost:5173
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,  # no cookies or auth headers are used
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# ROUTES
# --------------------------------------------------

app.include_router(
    navigation.router,
    prefix="/api/v1",
)

# Car routing with live traffic (TomTom)
app.include_router(
    car.router,
    prefix="/api/v1",
    tags=["Car"],
)

# SOS alert management
app.include_router(
    sos.router,
    prefix="/api/v1",
)


# --------------------------------------------------
# ROOT / HEALTH
# --------------------------------------------------

@app.get("/")
def root():
    return {
        "status": "online",
        "engine": "NAGAR AI - CoolWalk Live Map Navigation",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "ok"}