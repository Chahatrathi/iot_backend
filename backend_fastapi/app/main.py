from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import onboarding

app = FastAPI(title="Industrial IoT Core Mesh Infrastructure", version="1.0.0")

# 🔒 SECURITY BLOCK: Configure Cross-Origin Permissions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows your Vercel frontend domain to cross-communicate safely
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, GET, OPTIONS, etc.
    allow_headers=["*"],
)

# Mount Routers
app.include_router(onboarding.router)

@app.get("/api/health")
async def health_check():
    return {"status": "ONLINE", "framework": "FastAPI ASGI"}