import math
import hashlib
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.config import get_db
from app.schemas import FactoryCreate, UserCreate, TopologyCreate
from passlib.context import CryptContext

router = APIRouter(prefix="/api/onboard", tags=["Onboarding"])

# Configures Bcrypt context parameters safely
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__truncate_error=False)


# 📋 Inbound Structural Request Schemas
class NodeUpdateSchema(BaseModel):
    current_mininode_id: str
    new_mininode_id: str
    relay_mac: str

class NodeAppendSchema(BaseModel):
    factory_id: int
    nodes_to_add: int

class PasswordUpdateSchema(BaseModel):
    user_id: int
    new_password: str


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


@router.post("/create-plant-poc", status_code=status.HTTP_201_CREATED)
async def provision_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    if payload.role not in ['SUPER_ADMIN', 'LCB_TEAM', 'PLANT_POC', 'SYSTEM_GATEWAY']:
        raise HTTPException(status_code=400, detail="Invalid role context designation.")
    
    if not payload.username or not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Required credential registration fields cannot be left empty.")
        
    try:
        clean_password = str(payload.password).strip()
        safe_password = clean_password[:50]
        hashed_password = pwd_context.hash(safe_password)
        
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
        return {"success": True, "data": result.mappings().first()}
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
        raise HTTPException(status_code=400, detail="Boundary indicators must be integers.")

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
                    SET fan_channel = EXCLUDED.fan_channel, bulb_channel = EXCLUDED.bulb_channel;
                """), 
                {
                    "mininode_id": str(m_id).strip(), "hub_id": hub_id, "relay_mac": assigned_relay,
                    "fan_ch": dynamic_fan_ch, "bulb_ch": dynamic_bulb_ch
                }
            )

        await db.commit()
        return {"success": True, "manifest": {"central_node": hub_id, "relay_boards": relay_macs, "mini_nodes": mininode_ids}}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database execution error: {str(e)}")


# 🌟 NATIVE LOOKUP MATCHING NATURAL PRIMARY KEY LAYOUTS
@router.get("/fleet-topology")
async def get_fleet_topology(db: AsyncSession = Depends(get_db)):
    """
    Fetches hardware topology mappings cleanly aligned with the natural mininode_id schema.
    """
    try:
        query = text("""
            SELECT 
                m.mininode_id, m.hub_id, m.relay_mac, 
                m.fan_channel, m.bulb_channel, c.factory_id
            FROM mini_nodes m
            LEFT JOIN central_nodes c ON m.hub_id = c.hub_id
            ORDER BY m.mininode_id ASC;
        """)
        result = await db.execute(query)
        nodes_list = []
        for row in result.mappings().all():
            nodes_list.append({
                "id": str(row["mininode_id"]).strip(), # Piped safely for unique grid map trackers
                "mininode_id": str(row["mininode_id"]).strip(),
                "hub_id": row["hub_id"],
                "relay_mac": row["relay_mac"],
                "fan_channel": row["fan_channel"],
                "bulb_channel": row["bulb_channel"],
                "factory_id": row["factory_id"]
            })
        return {"success": True, "fleet": nodes_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Topology compilation fault: {str(e)}")


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


@router.put("/update-password", status_code=status.HTTP_200_OK)
async def update_poc_password(payload: PasswordUpdateSchema, db: AsyncSession = Depends(get_db)):
    try:
        safe_pass_str = str(payload.new_password).strip()[:50]
        new_hashed_val = pwd_context.hash(safe_pass_str)
        query = text("UPDATE users SET password_hash = :new_hash WHERE id = :uid;")
        await db.execute(query, {"new_hash": new_hashed_val, "uid": int(payload.user_id)})
        await db.commit()
        return {"success": True, "detail": "User access credentials updated successfully."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# 🌟 NATIVE LOGIC TARGETING STRING MININODE IDENTIFIERS WITHOUT GHOST 'ID' INTERFERENCES
@router.put("/update-mininode", status_code=status.HTTP_200_OK, tags=["Hardware Grid Management"])
async def update_individual_mininode(payload: NodeUpdateSchema, db: AsyncSession = Depends(get_db)):
    """
    Mutates unique Node fields using natural mininode_id indices to fit strict table setups.
    """
    try:
        query = text("""
            UPDATE mini_nodes 
            SET mininode_id = :new_mn_id, relay_mac = :r_mac 
            WHERE mininode_id = :curr_mn_id;
        """)
        await db.execute(query, {
            "new_mn_id": str(payload.new_mininode_id).strip(),
            "r_mac": str(payload.relay_mac).strip(),
            "curr_mn_id": str(payload.current_mininode_id).strip()
        })
        await db.commit()
        return {"success": True, "detail": "Hardware parameters committed seamlessly."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database execution crash: {str(e)}")


@router.post("/append-hardware-nodes", status_code=status.HTTP_201_CREATED, tags=["Hardware Grid Management"])
async def append_hardware_nodes(payload: NodeAppendSchema, db: AsyncSession = Depends(get_db)):
    """
    Intelligent Asset Expansion:
    Scans existing relay boards for empty channel slots (Fans/Bulbs). 
    Fills existing hardware gaps first before provisioning new Smartelex Actuators.
    """
    try:
        f_id = payload.factory_id
        hub_id = f"HUB-F{f_id}-MAIN"
        
        # 1. Fetch all existing relay boards for this specific factory
        relays_query = text("SELECT relay_mac FROM relay_boards WHERE factory_id = :fid;")
        relays_res = await db.execute(relays_query, {"fid": f_id})
        existing_relays = [row[0] for row in relays_res.fetchall()]
        
        # Determine the highest relay number (e.g., finding '3' from 'SMRTELEX-F1-R3')
        max_r_idx = 0
        for r in existing_relays:
            try:
                r_num = int(r.split("-R")[-1])
                if r_num > max_r_idx: 
                    max_r_idx = r_num
            except (ValueError, IndexError):
                pass
                
        # 2. Fetch all current mini-nodes mapped to this hub to check channel occupancy
        nodes_query = text("SELECT relay_mac, fan_channel FROM mini_nodes WHERE hub_id = :hid;")
        nodes_res = await db.execute(nodes_query, {"hid": hub_id})
        
        # Create an occupancy map: Each relay can hold nodes at position 0, 1, or 2
        occupancy = {rmac: [] for rmac in existing_relays}
        for row in nodes_res.mappings().all():
            rmac = row["relay_mac"]
            f_ch = row["fan_channel"]
            if rmac not in occupancy:
                occupancy[rmac] = []
            
            # Map the fan channel (1, 3, or 5) to a position slot (0, 1, or 2)
            pos = (f_ch - 1) // 2
            occupancy[rmac].append(pos)
            
        # 3. Identify all available empty slots across existing hardware
        available_slots = []
        # Sort relays so we fill R1 before we fill R2
        sorted_relays = sorted(occupancy.keys(), key=lambda x: int(x.split("-R")[-1]) if "-R" in x else 0)
        
        for rmac in sorted_relays:
            used_pos = occupancy[rmac]
            for p in range(3): # Positions 0, 1, and 2
                if p not in used_pos:
                    available_slots.append((rmac, p))
                    
        # 4. Generate unique serial numbers safely based on current node counts
        count_res = await db.execute(text("SELECT COUNT(*) FROM mini_nodes;"))
        global_offset = count_res.scalar() or 0
        
        new_relays_created = 0
        
        # 5. Provision the new nodes into the empty slots, creating new relays ONLY if needed
        for idx in range(payload.nodes_to_add):
            if available_slots:
                # 🎯 Use an existing empty slot on a current board
                assigned_relay, pos = available_slots.pop(0)
            else:
                # 🏗️ All boards are 100% full. Provision a new relay board.
                max_r_idx += 1
                assigned_relay = f"SMRTELEX-F{f_id}-R{max_r_idx}"
                await db.execute(
                    text("INSERT INTO relay_boards (relay_mac, hub_id, factory_id) VALUES (:rmac, :hid, :fid) ON CONFLICT DO NOTHING;"),
                    {"rmac": assigned_relay, "hid": hub_id, "fid": f_id}
                )
                new_relays_created += 1
                
                # The node takes the first position (0), leaving positions 1 and 2 open for the next iterations
                pos = 0
                available_slots.append((assigned_relay, 1))
                available_slots.append((assigned_relay, 2))
                
            # Convert the position back into specific physical channel pins
            fan_ch = (pos * 2) + 1
            bulb_ch = (pos * 2) + 2
            
            # Generate your 8-digit unique serial tracker
            new_sn = str(10000000 + (f_id * 10000) + global_offset + idx + 1)
            
            await db.execute(
                text("""
                    INSERT INTO mini_nodes (mininode_id, hub_id, relay_mac, fan_channel, bulb_channel)
                    VALUES (:mid, :hid, :rmac, :fch, :bch) ON CONFLICT DO NOTHING;
                """),
                {"mid": new_sn, "hid": hub_id, "rmac": assigned_relay, "fch": fan_ch, "bch": bulb_ch}
            )

        await db.commit()
        
        # Return exact number of extra physical boards needed so the frontend alerts the user accurately
        return {"success": True, "additional_relays_needed": new_relays_created}
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Expansion execution error: {str(e)}")