from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import navigation

app = FastAPI(
    title="NAGAR AI — CoolWalk Engine",
    description="Real-Time OpenStreetMap & Weather Heat-Aware Route Optimizer",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(navigation.router, prefix="/api/v1")

@app.get("/")
def root():
    return {"status": "online", "engine": "NAGAR AI - CoolWalk Live Map Navigation"}