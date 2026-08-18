from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_db
from app.security import ADMIN_ROLES, get_current_user, require_roles, verify_hub_key

router = APIRouter(prefix="/api/firmware", tags=["Firmware OTA"])

VALID_DEVICE_TYPES = ("CENTRAL_HUB", "MINI_NODE", "RELAY_BOARD")


class FirmwarePublishSchema(BaseModel):
    device_type: str
    version: str = Field(..., max_length=32)  # e.g. "1.2.0"
    url: str                                   # direct .bin download URL (GitHub Release asset)
    sha256: str = Field(..., min_length=64, max_length=64)
    notes: Optional[str] = None


@router.get("/latest", dependencies=[Depends(verify_hub_key)])
async def get_latest_firmware(device_type: str, db: AsyncSession = Depends(get_db)):
    """Called by the Central Hub (hub-key auth) on its OTA check cadence. Returns the newest
    active release for a device type. The hub compares `version` against its compiled-in
    FW_VERSION and only downloads on mismatch; `sha256` is what makes the download trustworthy
    even though the binary itself is fetched from GitHub outside the pinned TLS channel."""
    if device_type not in VALID_DEVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"device_type must be one of {VALID_DEVICE_TYPES}")

    result = await db.execute(
        text("""
            SELECT device_type, version, url, sha256, notes, released_at
            FROM firmware_versions
            WHERE device_type = :dt AND active = TRUE
            ORDER BY released_at DESC
            LIMIT 1;
        """),
        {"dt": device_type}
    )
    row = result.mappings().first()
    if not row:
        return {"success": True, "update_available": False}

    return {
        "success": True,
        "update_available": True,
        "device_type": row["device_type"],
        "version": row["version"],
        "url": row["url"],
        "sha256": row["sha256"],
        "notes": row["notes"],
        "released_at": row["released_at"].isoformat() if row["released_at"] else None,
    }


@router.post("/publish", status_code=status.HTTP_201_CREATED)
async def publish_firmware(
    payload: FirmwarePublishSchema,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_roles("SUPER_ADMIN")),
):
    """Registers a new firmware release. Upload the .bin to a GitHub Release first, compute its
    SHA-256 (`certutil -hashfile firmware.bin SHA256` on Windows), then call this with the asset's
    direct download URL. Publishing deactivates all previous releases for that device type."""
    if payload.device_type not in VALID_DEVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"device_type must be one of {VALID_DEVICE_TYPES}")

    try:
        await db.execute(
            text("UPDATE firmware_versions SET active = FALSE WHERE device_type = :dt;"),
            {"dt": payload.device_type}
        )
        result = await db.execute(
            text("""
                INSERT INTO firmware_versions (device_type, version, url, sha256, notes, released_at, active)
                VALUES (:dt, :version, :url, :sha256, :notes, :now, TRUE)
                RETURNING id, device_type, version;
            """),
            {
                "dt": payload.device_type,
                "version": payload.version.strip(),
                "url": payload.url.strip(),
                "sha256": payload.sha256.strip().lower(),
                "notes": payload.notes,
                "now": datetime.utcnow(),
            }
        )
        await db.commit()
        return {"success": True, "data": dict(result.mappings().first())}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fleet-status")
async def get_fleet_status(db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """Every device in the fleet with its last data, last_seen, and running firmware
    version, plus the active (latest published) version per device type so the
    dashboard can badge devices as up-to-date or outdated. Admin roles see all
    factories; PLANT_POC is scoped to their own (read-only, like the rest of
    their dashboard)."""
    factory_filter = None
    if current_user["role"] not in ADMIN_ROLES:
        factory_filter = current_user.get("factory_id")
        if factory_filter is None:
            raise HTTPException(status_code=403, detail="No factory scoped to this account.")

    try:
        latest_res = await db.execute(
            text("""
                SELECT DISTINCT ON (device_type) device_type, version, released_at
                FROM firmware_versions
                WHERE active = TRUE
                ORDER BY device_type, released_at DESC;
            """)
        )
        latest = {}
        for row in latest_res.mappings().all():
            latest[row["device_type"]] = {
                "version": row["version"],
                "released_at": row["released_at"].isoformat() if row["released_at"] else None,
            }

        hub_query = """
            SELECT c.hub_id, c.factory_id, f.name AS factory_name, c.status, c.last_seen, c.firmware_version
            FROM central_nodes c
            LEFT JOIN factories f ON c.factory_id = f.id
        """
        node_query = """
            SELECT m.mininode_id, m.hub_id, m.node_index, c.factory_id, m.last_seen,
                   m.firmware_version, m.last_smoothed_moisture,
                   h.temperature AS last_temperature, h.moisture AS last_moisture,
                   h.timestamp AS last_reading_at
            FROM mini_nodes m
            LEFT JOIN central_nodes c ON m.hub_id = c.hub_id
            LEFT JOIN LATERAL (
                SELECT temperature, moisture, timestamp
                FROM hardware_data_received
                WHERE mininode_id = m.mininode_id
                ORDER BY timestamp DESC
                LIMIT 1
            ) h ON TRUE
        """
        relay_query = """
            SELECT r.relay_mac, r.hub_id, r.factory_id, r.last_seen, r.firmware_version, r.reported_states
            FROM relay_boards r
        """
        params = {}
        if factory_filter is not None:
            hub_query += " WHERE c.factory_id = :fid"
            node_query += " WHERE c.factory_id = :fid"
            relay_query += " WHERE r.factory_id = :fid"
            params = {"fid": factory_filter}

        def serialize(rows):
            out = []
            for row in rows:
                d = dict(row)
                for k, v in d.items():
                    if isinstance(v, datetime):
                        d[k] = v.isoformat()
                out.append(d)
            return out

        hubs_res = await db.execute(text(hub_query + " ORDER BY c.hub_id;"), params)
        nodes_res = await db.execute(text(node_query + " ORDER BY m.node_index NULLS LAST, m.mininode_id;"), params)
        relays_res = await db.execute(text(relay_query + " ORDER BY r.relay_mac;"), params)

        return {
            "success": True,
            "latest": latest,
            "hubs": serialize(hubs_res.mappings().all()),
            "mini_nodes": serialize(nodes_res.mappings().all()),
            "relay_boards": serialize(relays_res.mappings().all()),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/versions")
async def list_firmware_versions(
    db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))
):
    result = await db.execute(
        text("""
            SELECT id, device_type, version, url, sha256, notes, released_at, active
            FROM firmware_versions
            ORDER BY released_at DESC;
        """)
    )
    versions = []
    for row in result.mappings().all():
        d = dict(row)
        if d.get("released_at"):
            d["released_at"] = d["released_at"].isoformat()
        versions.append(d)
    return {"success": True, "versions": versions}
