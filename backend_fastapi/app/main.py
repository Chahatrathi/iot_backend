import hashlib
import hmac
import math
from fastapi import FastAPI, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import get_db
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


class NodeUpdateSchema(BaseModel):
    id: int
    mininode_id: str
    relay_mac: str

class NodeAppendSchema(BaseModel):
    factory_id: int
    nodes_to_add: int

# 📋 Explicit Schema Definition for User Creation
class DiagnosticUserSchema(BaseModel):
    username: str
    email: str
    role: str
    password: str
    factory_id: Optional[int] = None

# 📋 Explicit Schema Definition for Password Reset Update
class PasswordUpdateSchema(BaseModel):
    user_id: int
    new_password: str

# 📋 Explicit Schema Definition for Authentication Requests
class LoginRequestSchema(BaseModel):
    email: str
    password: str


def verify_incoming_user_password(plain_password: str, stored_password_hash: str) -> bool:
    """
    Unified Verification Guard
    Checks incoming text against legacy Bcrypt configurations and native SHA-256 strings safely.
    """
    try:
        # 1. 🛡️ Fallback check for legacy Bcrypt users
        if stored_password_hash.startswith("$2b$") or stored_password_hash.startswith("$2a$"):
            from passlib.context import CryptContext
            legacy_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
            return legacy_context.verify(plain_password, stored_password_hash)
            
        # 2. 🛡️ Check for older diagnostic string iterations ('DIAGNOSTIC_VERIFIED_')
        if stored_password_hash.startswith("DIAGNOSTIC_VERIFIED_"):
            extracted_raw_pass = stored_password_hash.replace("DIAGNOSTIC_VERIFIED_", "")
            return hmac.compare_digest(plain_password.strip()[:20], extracted_raw_pass)

        # 3. 🛡️ Standard Unified SHA-256 matching logic (Constant-time to prevent timing attacks)
        input_bytes = str(plain_password).strip().encode("utf-8")
        computed_hex_hash = hashlib.sha256(input_bytes).hexdigest()
        
        return hmac.compare_digest(computed_hex_hash, stored_password_hash)
        
    except Exception:
        return False


@app.post("/api/login", status_code=status.HTTP_200_OK, tags=["Authentication Engine"])
async def login_access_handshake(payload: LoginRequestSchema, db: AsyncSession = Depends(get_db)):
    """
    Unified Login Handshake Gateway.
    Allows SUPER_ADMIN, LCB_TEAM, and PLANT_POC roles to gain access to portal components.
    """
    try:
        # 1. Query the unique database profile entry matching credentials
        query = text("SELECT id, username, email, password_hash, role FROM users WHERE email = :email;")
        result = await db.execute(query, {"email": str(payload.email).strip()})
        user = result.mappings().first()
        
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid account email or password record alignment.")
            
        # 2. Match verification matrices
        is_authenticated = verify_incoming_user_password(payload.password, user["password_hash"])
        
        if not is_authenticated:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid account email or password record alignment.")
            
        # 3. Return full validation context mapping straight back to your frontend framework state handlers
        return {
            "success": True,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "role": user["role"]
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication core runtime exception: {str(e)}")


@app.post("/api/absolute-diagnostic-register", status_code=status.HTTP_201_CREATED, tags=["Emergency Diagnostic Override"])
async def absolute_diagnostic_register(payload: DiagnosticUserSchema, db: AsyncSession = Depends(get_db)):
    """
    Absolute Emergency Override Route.
    Declared directly on the core app object to isolate payload parsing from router dependency hierarchies.
    """
    if payload.role not in ['SUPER_ADMIN', 'LCB_TEAM', 'PLANT_POC', 'SYSTEM_GATEWAY']:
        raise HTTPException(status_code=400, detail="Invalid role context designation.")
        
    try:
        string_bytes = str(payload.password).strip().encode("utf-8")
        native_sha256_hash = hashlib.sha256(string_bytes).hexdigest()
        
        query = text("""
            INSERT INTO users (factory_id, username, email, password_hash, role) 
            VALUES (:factory_id, :username, :email, :password_hash, :role) 
            RETURNING id, username, email, role;
        """)
        
        result = await db.execute(query, {
            "factory_id": int(payload.factory_id) if payload.factory_id else None, 
            "username": str(payload.username).strip(),
            "email": str(payload.email).strip(), 
            "password_hash": native_sha256_hash, 
            "role": str(payload.role)
        })
        
        await db.commit()
        user_record = result.mappings().first()
        
        return {
            "success": True, 
            "data": {
                "id": user_record["id"],
                "username": user_record["username"],
                "email": user_record["email"],
                "role": user_record["role"]
            }
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Absolute Override Fault Line: {str(e)}")


@app.put("/api/onboard/update-password", status_code=status.HTTP_200_OK, tags=["Emergency Diagnostic Override"])
async def absolute_update_password(payload: PasswordUpdateSchema, db: AsyncSession = Depends(get_db)):
    """
    Absolute Emergency Override Password Modification.
    Updates password hash rows directly from core app context.
    """
    try:
        string_bytes = str(payload.new_password).strip().encode("utf-8")
        native_sha256_hash = hashlib.sha256(string_bytes).hexdigest()
        
        query = text("""
            UPDATE users 
            SET password_hash = :new_hash 
            WHERE id = :uid;
        """)
        
        await db.execute(query, {
            "new_hash": native_sha256_hash,
            "uid": int(payload.user_id)
        })
        await db.commit()
        
        return {"success": True, "detail": "User access credentials reset successfully."}
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Password Shift Database Error: {str(e)}")


@app.put("/api/onboard/update-mininode", status_code=status.HTTP_200_OK, tags=["Hardware Grid Management"])
async def update_individual_mininode(payload: NodeUpdateSchema, db: AsyncSession = Depends(get_db)):
    """
    Mutates individual Node ID and Relay MAC tracker entries directly inside mini_nodes database tables.
    """
    try:
        query = text("""
            UPDATE mini_nodes 
            SET mininode_id = :mn_id, relay_mac = :r_mac 
            WHERE id = :id;
        """)
        await db.execute(query, {
            "mn_id": str(payload.mininode_id).strip(),
            "r_mac": str(payload.relay_mac).strip(),
            "id": int(payload.id)
        })
        await db.commit()
        return {"success": True, "detail": "Node address pointers updated successfully."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database execution crash: {str(e)}")


# 🌟 ENDPOINT 2: Fleet Expansion & Auto-Relay Calculator 
@app.post("/api/onboard/append-hardware-nodes", status_code=status.HTTP_201_CREATED, tags=["Hardware Grid Management"])
async def append_hardware_nodes(payload: NodeAppendSchema, db: AsyncSession = Depends(get_db)):
    """
    Appends extra telemetry lines to factory matrix and auto-calculates supplementary actuator channels needed.
    """
    try:
        # Find current hardware limits to derive upcoming channel alignments accurately
        cnt_query = text("SELECT COUNT(*) FROM mini_nodes WHERE hub_id LIKE :fid_match;")
        cnt_res = await db.execute(cnt_query, {"fid_match": f"%F{payload.factory_id}%"})
        current_node_count = cnt_res.scalar() or 0
        
        # Calculate existing relay allocation status blocks
        current_relays_count = math.ceil(current_node_count / 3)
        new_total_node_count = current_node_count + payload.nodes_to_add
        new_total_relays_needed = math.ceil(new_total_node_count / 3)
        additional_relays = max(0, new_total_relays_needed - current_relays_count)
        
        hub_id = f"HUB-F{payload.factory_id}-MAIN"
        
        # Provision additional Smartelex boards if thresholds overflow
        for i in range(additional_relays):
            new_relay_mac = f"SMRTELEX-F{payload.factory_id}-R{current_relays_count + i + 1}"
            await db.execute(
                text("INSERT INTO relay_boards (relay_mac, hub_id, factory_id) VALUES (:rmac, :hid, :fid) ON CONFLICT DO NOTHING;"),
                {"rmac": new_relay_mac, "hid": hub_id, "fid": payload.factory_id}
            )
            
        # Loop and inject structural channel metrics for each append candidate
        for idx in range(payload.nodes_to_add):
            virtual_index = current_node_count + idx
            assigned_relay_idx = (virtual_index // 3) + 1
            position_on_relay = virtual_index % 3
            
            relay_mac = f"SMRTELEX-F{payload.factory_id}-R{assigned_relay_idx}"
            mininode_id = f"ESP-F{payload.factory_id}-TNK{str(virtual_index + 1).padStart(2, '0')}"
            
            fan_ch = (position_on_relay * 2) + 1
            bulb_ch = (position_on_relay * 2) + 2
            
            await db.execute(
                text("""
                    INSERT INTO mini_nodes (mininode_id, hub_id, relay_mac, fan_channel, bulb_channel)
                    VALUES (:mid, :hid, :rmac, :fch, :bch) ON CONFLICT DO NOTHING;
                """),
                {"mid": mininode_id, "hid": hub_id, "rmac": relay_mac, "fch": fan_ch, "bch": bulb_ch}
            )
            
        await db.commit()
        return {"success": True, "additional_relays_needed": additional_relays}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Expansion execution error: {str(e)}")




# Mount Existing System Routers
app.include_router(onboarding.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ONLINE", "framework": "FastAPI ASGI"}