from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_db
from app.routers import onboarding, telemetry, firmware, invoices
from app.security import create_access_token, get_optional_user, hash_password, verify_password

app = FastAPI(
    title="Process Intelligence API",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://iot-control-dashboard.vercel.app",  # Production frontend
        "http://localhost:5173",                     # Local Vite dev server
        "http://localhost:3000",                     # Local React/Next dev server
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding.router)
app.include_router(telemetry.router)
app.include_router(firmware.router)
app.include_router(invoices.router)

class DiagnosticUserSchema(BaseModel):
    username: str
    email: str
    role: str
    password: str
    factory_id: Optional[int] = None


class LoginRequestSchema(BaseModel):
    email: str
    password: str


@app.post("/api/login", status_code=status.HTTP_200_OK, tags=["Authentication Engine"])
async def login_access_handshake(payload: LoginRequestSchema, db: AsyncSession = Depends(get_db)):
    """Unified Login Handshake Gateway."""
    try:
        query = text("SELECT id, username, email, password_hash, role, factory_id FROM users WHERE email = :email;")
        result = await db.execute(query, {"email": str(payload.email).strip()})
        user = result.mappings().first()

        if not user or not verify_password(str(payload.password).strip(), user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid account email or password.")

        token = create_access_token(
            user_id=user["id"], email=user["email"], role=user["role"], factory_id=user["factory_id"]
        )

        return {
            "success": True,
            "access_token": token,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "role": user["role"],
                "factory_id": user["factory_id"],
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication core runtime exception: {str(e)}")


@app.post("/api/absolute-diagnostic-register", status_code=status.HTTP_201_CREATED, tags=["Emergency Diagnostic Override"])
async def absolute_diagnostic_register(
    payload: DiagnosticUserSchema,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """Bootstraps the very first account when the users table is empty. Once at least one
    account exists, this route requires a valid SUPER_ADMIN session — it is no longer reachable
    by an anonymous caller in a live deployment."""
    if payload.role not in ["SUPER_ADMIN", "LCB_TEAM", "PLANT_POC", "SYSTEM_GATEWAY"]:
        raise HTTPException(status_code=400, detail="Invalid role context designation.")

    try:
        existing_count = (await db.execute(text("SELECT COUNT(*) FROM users;"))).scalar() or 0
        if existing_count > 0:
            if not current_user or current_user["role"] != "SUPER_ADMIN":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account provisioning requires a SUPER_ADMIN session once the system is initialized.",
                )

        hashed_password = hash_password(str(payload.password).strip()[:50])

        query = text("""
            INSERT INTO users (factory_id, username, email, password_hash, role)
            VALUES (:factory_id, :username, :email, :password_hash, :role)
            RETURNING id, username, email, role;
        """)

        result = await db.execute(query, {
            "factory_id": int(payload.factory_id) if payload.factory_id else None,
            "username": str(payload.username).strip(),
            "email": str(payload.email).strip(),
            "password_hash": hashed_password,
            "role": str(payload.role),
        })

        await db.commit()
        user_record = result.mappings().first()

        return {"success": True, "data": dict(user_record)}

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Absolute Override Fault Line: {str(e)}")


@app.get("/api/health")
async def health_check():
    return {"status": "ONLINE", "framework": "FastAPI ASGI"}
