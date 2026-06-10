import math
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.config import get_db
from app.schemas import FactoryCreate, UserCreate, TopologyCreate
from passlib.context import CryptContext

router = APIRouter(prefix="/api/onboard", tags=["Onboarding"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@router.post("/factory", status_code=status.HTTP_201_CREATED)
async def onboard_factory(payload: FactoryCreate, db: AsyncSession = Depends(get_db)):
    try:
        query = text("INSERT INTO factories (name, location) VALUES (:name, :location) RETURNING *;")
        result = await db.execute(query, {"name": payload.name, "location": payload.location})
        await db.commit()
        return {"success": True, "data": result.mappings().first()}
    except Exception as e:
        await db.rollback()
        if "unique constraint" in str(e).lower():
            raise HTTPException(status_code=409, detail="Factory already exists.")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/user", status_code=status.HTTP_201_CREATED)
async def provision_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    if payload.role not in ['SUPER_ADMIN', 'LCB_TEAM', 'PLANT_POC', 'SYSTEM_GATEWAY']:
        raise HTTPException(status_code=400, detail="Invalid role context designation.")
    
    try:
        # 🎲 Absolute Alphanumeric String Isolation Pass
        # We completely ignore any password variables inside payload to stop the 72-byte passlib bug
        chars = string.ascii_letters + string.digits
        generated_password = "".join(secrets.choice(chars) for _ in range(12))
        
        # Enforce strict raw primitive string conversion before hashing pass
        clean_raw_str = str(generated_password)
        hashed_password = pwd_context.hash(clean_raw_str)
        
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
                "role": user_record["role"],
                "generated_password": generated_password
            }
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Account Provisioning Error: {str(e)}")


@router.post("/topology", status_code=status.HTTP_201_CREATED)
async def onboard_topology(payload: TopologyCreate, db: AsyncSession = Depends(get_db)):
    try:
        f_id = int(payload.factory_id)
        await db.execute(
            text("INSERT INTO central_nodes (hub_id, factory_id) VALUES (:hub_id, :factory_id) ON CONFLICT (hub_id) DO NOTHING;"), 
            {"hub_id": payload.hub_id, "factory_id": f_id}
        )
        
        await db.execute(
            text("INSERT INTO relay_boards (relay_mac, hub_id, factory_id) VALUES (:relay_mac, :hub_id, :factory_id) ON CONFLICT (relay_mac) DO NOTHING;"), 
            {"relay_mac": payload.relay_mac, "hub_id": payload.hub_id, "factory_id": f_id}
        )
        
        mini_node_query = text("""
            INSERT INTO mini_nodes (mininode_id, hub_id, relay_mac, fan_channel, bulb_channel) 
            VALUES (:mininode_id, :hub_id, :relay_mac, :fan_channel, :bulb_channel) 
            ON CONFLICT (mininode_id) DO UPDATE 
            SET hub_id = EXCLUDED.hub_id,
                relay_mac = EXCLUDED.relay_mac,
                fan_channel = EXCLUDED.fan_channel, 
                bulb_channel = EXCLUDED.bulb_channel 
            RETURNING *;
        """)
        result = await db.execute(mini_node_query, {
            "mininode_id": payload.mininode_id, "hub_id": payload.hub_id, "relay_mac": payload.relay_mac,
            "fan_channel": payload.fan_channel, "bulb_channel": payload.bulb_channel
        })
        await db.commit()
        return {"success": True, "topology": result.mappings().first()}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-provision-hardware", status_code=status.HTTP_201_CREATED)
async def batch_provision_hardware(payload: dict, db: AsyncSession = Depends(get_db)):
    factory_id = payload.get("factory_id")
    tank_count = payload.get("tank_count")
    
    hub_id = payload.get("hub_id", "").strip()
    relay_macs = payload.get("relay_macs", [])
    mininode_ids = payload.get("mininode_ids", [])

    if not factory_id or not tank_count:
        raise HTTPException(status_code=400, detail="Missing core parameters.")

    try:
        factory_id = int(factory_id)
        tank_count = int(tank_count)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Boundary indicators must be valid integers.")

    if tank_count <= 0:
        raise HTTPException(status_code=400, detail="Tanks count allocation parameter must be positive.")

    expected_relays = math.ceil(tank_count / 3)
    
    if not hub_id or len(relay_macs) != expected_relays or len(mininode_ids) != tank_count:
        raise HTTPException(status_code=400, detail="Topology dimensions mismatch constraint rules.")

    try:
        await db.execute(
            text("INSERT INTO central_nodes (hub_id, factory_id) VALUES (:hub_id, :factory_id) ON CONFLICT (hub_id) DO NOTHING;"), 
            {"hub_id": hub_id, "factory_id": factory_id}
        )

        for r_mac in relay_macs:
            await db.execute(
                text("INSERT INTO relay_boards (relay_mac, hub_id, factory_id) VALUES (:relay_mac, :hub_id, :factory_id) ON CONFLICT (relay_mac) DO NOTHING;"), 
                {"relay_mac": r_mac.strip(), "hub_id": hub_id, "factory_id": factory_id}
            )

        for idx, m_id in enumerate(mininode_ids):
            assigned_relay = relay_macs[idx // 3].strip()
            position_on_relay = idx % 3
            
            dynamic_fan_ch = (position_on_relay * 2) + 1
            dynamic_bulb_ch = (position_on_relay * 2) + 2
            
            await db.execute(
                text("""
                    INSERT INTO mini_nodes (mininode_id, hub_id, relay_mac, fan_channel, bulb_channel) 
                    VALUES (:mininode_id, :hub_id, :relay_mac, :fan_ch, :bulb_ch)
                    ON CONFLICT (mininode_id) DO UPDATE 
                    SET fan_channel = EXCLUDED.fan_channel, 
                        bulb_channel = EXCLUDED.bulb_channel;
                """), 
                {
                    "mininode_id": m_id.strip(), "hub_id": hub_id, "relay_mac": assigned_relay,
                    "fan_ch": dynamic_fan_ch, "bulb_ch": dynamic_bulb_ch
                }
            )

        await db.commit()
        return {"success": True, "manifest": {"central_node": hub_id, "relay_boards": relay_macs, "mini_nodes": mininode_ids}}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database execution error: {str(e)}")


@router.get("/directory-with-plants", tags=["Superadmin Dashboard"])
async def get_directory_with_plants(db: AsyncSession = Depends(get_db)):
    try:
        query = text("""
            SELECT 
                u.id AS user_id, u.username, u.email, u.role, u.is_active, u.factory_id,
                f.name AS assigned_factory_name
            FROM users u
            LEFT JOIN factories f ON u.factory_id = f.id
            ORDER BY u.id ASC;
        """)
        result = await db.execute(query)
        directory_list = []
        for row in result.mappings().all():
            directory_list.append({
                "id": row["user_id"],
                "username": row["username"],
                "email": row["email"],
                "role": row["role"],
                "is_active": row["is_active"],
                "scoped_plant": row["assigned_factory_name"] if row["factory_id"] else "Global Infrastructure Scope"
            })
        return {"success": True, "users": directory_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all-plants", tags=["Superadmin Dashboard"])
async def get_all_plants(db: AsyncSession = Depends(get_db)):
    try:
        query = text("""
            SELECT 
                f.id AS factory_id, f.name AS factory_name, f.location AS factory_location,
                COALESCE(COUNT(DISTINCT c.hub_id), 0) AS total_hubs
            FROM factories f
            LEFT JOIN central_nodes c ON f.id = c.factory_id
            GROUP BY f.id, f.name, f.location
            ORDER BY f.id DESC;
        """)
        result = await db.execute(query)
        plants_data = []
        for row in result.mappings().all():
            plants_data.append({
                "id": int(row["factory_id"]),
                "name": str(row["factory_name"]),
                "location": str(row["factory_location"]) if row["factory_location"] else "Unspecified Zone",
                "total_hubs": int(row["total_hubs"]),
                "status": "Operational" if row["total_hubs"] > 0 else "Provisioned Pending Matrix"
            })
        return {"success": True, "plants": plants_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))