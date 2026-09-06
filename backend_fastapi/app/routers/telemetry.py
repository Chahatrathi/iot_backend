from datetime import timedelta, datetime
import json
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.config import get_db
from app.security import require_roles, get_current_user, assert_factory_scope, verify_hub_key, ADMIN_ROLES

router = APIRouter(prefix="/api/telemetry", tags=["Hardware Telemetry & Command"])

def calculate_trimmed_mean(readings_list: List[int]) -> int:
    """Sorts, trims the 10 highest and 10 lowest outliers, and averages the rest."""
    if len(readings_list) < 20: 
        return int(sum(readings_list) / max(len(readings_list), 1))
    
    sorted_data = sorted(readings_list)
    trimmed_data = sorted_data[10:-10] # Drop top 10 and bottom 10
    return int(sum(trimmed_data) / len(trimmed_data))

# =====================================================================
# INBOUND PAYLOAD SCHEMAS
# =====================================================================
class SensorReading(BaseModel):
    mininode_id: str
    temperature: Optional[float] = None
    moisture: Optional[float] = None
    # 0 = timer wake (normal deep-sleep cycle), 1 = cold boot (power restored / reset).
    # Old firmware doesn't send this; None means "unknown", not "normal".
    boot_reason: Optional[int] = None
    # The mini node's own firmware version (nodes on >= 1.3.0 report it every wake;
    # older nodes send nothing and keep their last-known value).
    fw_version: Optional[str] = None

class RelayStatusReport(BaseModel):
    relay_mac: str
    channel_states: List[int]  # 6 entries, index 0 = channel 1
    uptime_seconds: int
    # Relay boards on >= 1.3.0 report their firmware version in every status message.
    fw_version: Optional[str] = None

class HubPayload(BaseModel):
    hub_id: str
    uptime_seconds: int
    readings: List[SensorReading]
    # "BOOT" on the hub's first call after power-up, "HEARTBEAT" for the 5-minute keepalive,
    # absent on ordinary telemetry batches (old firmware sends nothing here).
    event: Optional[str] = None
    firmware_version: Optional[str] = None
    relay_status: Optional[List[RelayStatusReport]] = None
    # Direct-upload mini nodes (P2P deployments, no central hub) identify themselves here so
    # the ingest can skip the hub-only dispatch machinery (command queue / desired states).
    # The node posts hub_id = its own chip ID and is provisioned as its own central_nodes row.
    node_type: Optional[str] = None
    # A2c: the hub's own OTA action summary (state/detail/attempts/ts), reported every
    # heartbeat so the cloud shows what the hub did and why anything failed.
    ota_status: Optional[dict] = None

class CommandAck(BaseModel):
    command_id: int
    status: str # "SUCCESS" or "FAILED"

class HubAckPayload(BaseModel):
    hub_id: str
    acknowledgments: List[CommandAck]

class IntervalUpdateRequest(BaseModel):
    hub_id: str
    mininode_id: str
    interval_minutes: int

class CalibrationTrigger(BaseModel):
    mode: str # "DRY" or "WET"

class AutomatedSweepSchema(BaseModel):
    relay_mac: str
    hub_id: str
    channel: int  
    state: int    

class SaveSweepMatrixSchema(BaseModel):
    mininode_id: str
    fan_relay_mac: str
    fan_channel: int
    bulb_relay_mac: str
    bulb_channel: int

# =====================================================================
# 1. CORE INGESTION & BI-DIRECTIONAL DISPATCH (Adaptive Edge Engine)
# =====================================================================
@router.post("/ingest", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_hub_key)])
async def ingest_hardware_data(payload: HubPayload, db: AsyncSession = Depends(get_db)):
    """
    Listens for central nodes, saves telemetry, and returns the C-compliant 
    system configuration (adaptive polling limits) and manual override commands.
    """
    print(f"INCOMING PAYLOAD FROM {payload.hub_id}: {payload.model_dump_json()}")
    try:
        current_time = datetime.utcnow()

        # ---------------------------------------------------------
        # Singular device flow, stage 1 (INTAKE): a device flashing our fleet
        # firmware calls home on first boot. Its X-Hub-Key already proved fleet
        # membership, so register it automatically as an unassigned INTAKE device -
        # SUPER_ADMIN routes it to a manufacturer account from the intake screen.
        # ---------------------------------------------------------
        check_hub_query = text("SELECT hub_id FROM central_nodes WHERE hub_id = :hub_id;")
        hub_check_res = await db.execute(check_hub_query, {"hub_id": payload.hub_id})
        
        if not hub_check_res.first():
            await db.execute(
                text("""
                    INSERT INTO central_nodes (hub_id, stage, stage_updated_at, status, firmware_version, last_seen)
                    VALUES (:hub_id, 'INTAKE', :now, 'ONLINE', :fw, :now);
                """),
                {"hub_id": payload.hub_id, "now": current_time, "fw": payload.firmware_version}
            )
            print(f"[INTAKE] Auto-registered unknown device {payload.hub_id} as INTAKE")

        # P2P deployments (mini_node_p2p / relay_board_p2p): there is no central hub — every
        # mini node is its own gateway and uploads directly with hub_id = its chip ID. Those
        # nodes are fully autonomous: they decide fan/bulb states on-device and apply them
        # over the mesh, so the hub-only dispatch machinery below (CENTRAL_HUB boot log,
        # desired_states snapshot, autonomous command queue) must be skipped for them.
        is_mini_node = payload.node_type == "MINI_NODE"

        # 1. Update Hub Status (+ firmware_version, which the schema already had a column
        #    for — COALESCE keeps the last-known version if an older Hub build doesn't send it)
        hub_query = text("""
            UPDATE central_nodes
            SET status = 'ONLINE', last_seen = :now,
                firmware_version = COALESCE(:fw, firmware_version),
                ota_status = COALESCE(:ota_status_json, ota_status)
            WHERE hub_id = :hub_id;
        """)
        ota_status_json = None
        if payload.ota_status is not None:
            ota_status_json = json.dumps(payload.ota_status)
        await db.execute(hub_query, {"hub_id": payload.hub_id, "now": current_time, "fw": payload.firmware_version, "ota_status_json": ota_status_json})

        # Tank auto-intake (singular flow): a reading from a tank this hub has never
        # reported before registers it as an INTAKE device so the FK holds and it
        # surfaces in the intake screen. Covers bench sim tanks and new field tanks.
        if payload.readings:
            known_res = await db.execute(
                text("SELECT mininode_id FROM mini_nodes WHERE hub_id = :hub_id;"),
                {"hub_id": payload.hub_id}
            )
            known_ids = {row["mininode_id"] for row in known_res.mappings().all()}
            for r in payload.readings:
                mid = (r.mininode_id or "").strip()
                if mid and mid not in known_ids:
                    await db.execute(
                        text("""
                            INSERT INTO mini_nodes (mininode_id, hub_id, fan_channel, bulb_channel,
                                                    node_index, stage, firmware_version, last_seen)
                            VALUES (:mid, :hub_id, 1, 2,
                                    (SELECT COALESCE(MAX(node_index), 0) + 1 FROM mini_nodes WHERE hub_id = :hub_id_sub),
                                    'INTAKE', :fw, :now)
                            ON CONFLICT (mininode_id) DO NOTHING;
                        """),
                        {"mid": mid, "hub_id": payload.hub_id, "hub_id_sub": payload.hub_id, "fw": r.fw_version, "now": current_time}
                    )
                    known_ids.add(mid)
                    print(f"[INTAKE] Auto-registered tank {mid} under hub {payload.hub_id}")

        # Log hub power-cut recoveries so operations can see them per site
        # (mini nodes log their own cold boots via boot_reason on each reading, so a
        # direct-upload node does not also log a CENTRAL_HUB event here.)
        if payload.event == "BOOT" and not is_mini_node:
            await db.execute(
                text("""
                    INSERT INTO device_boot_logs (device_type, device_id, hub_id, boot_reason, firmware_version, logged_at)
                    VALUES ('CENTRAL_HUB', :hub_id, :hub_id, 'POWER_ON', :fw, :now);
                """),
                {"hub_id": payload.hub_id, "fw": payload.firmware_version, "now": current_time}
            )

        # Relay board status piggybacked on the heartbeat: freshness + physically-reported channel states
        if payload.relay_status:
            for rs in payload.relay_status:
                await db.execute(
                    text("""
                        UPDATE relay_boards
                        SET last_seen = :now, reported_states = :states,
                            firmware_version = COALESCE(:fw, firmware_version)
                        WHERE relay_mac = :mac;
                    """),
                    {"now": current_time, "states": str(rs.channel_states), "fw": rs.fw_version, "mac": rs.relay_mac.strip()}
                )
                # A relay reporting <2 min of uptime just recovered from a power cut
                if rs.uptime_seconds < 120:
                    await db.execute(
                        text("""
                            INSERT INTO device_boot_logs (device_type, device_id, hub_id, boot_reason, logged_at)
                            VALUES ('RELAY_BOARD', :mac, :hub_id, 'POWER_ON', :now);
                        """),
                        {"mac": rs.relay_mac.strip(), "hub_id": payload.hub_id, "now": current_time}
                    )

        # Default fallback interval
        c_interval_ms = 900000

        # =====================================================================
        # 2. Fetch hardware edge rules, calibration data, AND current state.
        #    Telemetry batches fetch the reporting nodes; heartbeats (empty readings)
        #    fetch every node under this hub, because the response must always carry
        #    the full desired-state snapshot and rule set for offline caching.
        # =====================================================================
        node_ids = [r.mininode_id for r in payload.readings]
        edge_rules = []
        node_states = {}
        desired_states = []

        if node_ids:
            nodes_query = text("""
                SELECT mininode_id, temp_min, temp_max, moisture_min, moisture_max,
                       telemetry_interval_ms, raw_dry_cal, raw_wet_cal, last_smoothed_moisture,
                       calibration_mode, calibration_buffer, fan_relay_mac, bulb_relay_mac,
                       fan_channel, bulb_channel, fan_status, bulb_status,
                       cycle_status, last_seen, node_index
                FROM mini_nodes
                WHERE mininode_id = ANY(:node_ids);
            """)
            nodes_res = await db.execute(nodes_query, {"node_ids": node_ids})
        else:
            nodes_query = text("""
                SELECT mininode_id, temp_min, temp_max, moisture_min, moisture_max,
                       telemetry_interval_ms, raw_dry_cal, raw_wet_cal, last_smoothed_moisture,
                       calibration_mode, calibration_buffer, fan_relay_mac, bulb_relay_mac,
                       fan_channel, bulb_channel, fan_status, bulb_status,
                       cycle_status, last_seen, node_index
                FROM mini_nodes
                WHERE hub_id = :hub_id;
            """)
            nodes_res = await db.execute(nodes_query, {"hub_id": payload.hub_id})

        for index, row in enumerate(nodes_res.mappings().all()):
            if index == 0 and row["telemetry_interval_ms"]:
                c_interval_ms = row["telemetry_interval_ms"]

            node_states[row["mininode_id"]] = {
                "raw_dry_cal": row["raw_dry_cal"] or 2540,
                "raw_wet_cal": row["raw_wet_cal"] or 1200,
                "last_ema": row["last_smoothed_moisture"],
                "calibration_mode": row["calibration_mode"],
                "calibration_buffer": row["calibration_buffer"],
                "fan_relay_mac": row["fan_relay_mac"],
                "bulb_relay_mac": row["bulb_relay_mac"],
                "fan_channel": row["fan_channel"],
                "bulb_channel": row["bulb_channel"],
                "fan_status": row["fan_status"] or 0,
                "bulb_status": row["bulb_status"] or 0,
                "cycle_status": row["cycle_status"],
                "last_seen": row["last_seen"]
            }

            # Relay mapping + calibration travel with the rules so the hub can evaluate
            # thresholds locally (raw ADC -> percent) when the internet is down.
            # node_index lets the hub's local portal label tanks the same way the
            # cloud dashboard does ("Tank #N"), not just by serial.
            edge_rules.append({
                "mininode_id": row["mininode_id"],
                "node_index": row["node_index"],
                "temp_min": float(row["temp_min"]) if row["temp_min"] else 25.0,
                "temp_max": float(row["temp_max"]) if row["temp_max"] else 35.0,
                "moisture_min": float(row["moisture_min"]) if row["moisture_min"] else 40.0,
                "moisture_max": float(row["moisture_max"]) if row["moisture_max"] else 60.0,
                "raw_dry_cal": row["raw_dry_cal"] or 2540,
                "raw_wet_cal": row["raw_wet_cal"] or 1200,
                "fan_relay_mac": row["fan_relay_mac"],
                "fan_channel": row["fan_channel"],
                "bulb_relay_mac": row["bulb_relay_mac"],
                "bulb_channel": row["bulb_channel"]
            })

            # Authoritative desired states — what each actuator SHOULD be right now.
            # The hub dispatches these idempotently (only when they differ from its
            # last-dispatched cache), which is what restores relays after a power cut.
            # P2P mini nodes skip this: they apply states locally over the mesh and
            # never poll /ingest for a desired-state snapshot.
            if not is_mini_node:
                if row["fan_relay_mac"] and row["fan_relay_mac"] != "UNASSIGNED" and row["fan_channel"]:
                    desired_states.append({
                        "relay_mac": row["fan_relay_mac"],
                        "channel": row["fan_channel"],
                        "state": row["fan_status"] or 0
                    })
                if row["bulb_relay_mac"] and row["bulb_relay_mac"] != "UNASSIGNED" and row["bulb_channel"]:
                    desired_states.append({
                        "relay_mac": row["bulb_relay_mac"],
                        "channel": row["bulb_channel"],
                        "state": row["bulb_status"] or 0
                    })

        # Hard ceiling: no device may go quieter than 15 minutes (business requirement)
        c_interval_ms = min(c_interval_ms, 900000)


        # 3. Batch Process Telemetry Data
        if payload.readings:
            batch_data = []
            alpha = 0.2  

            for r in payload.readings:
                state = node_states.get(r.mininode_id)

                # Firmware version travels with every reading from nodes on >= 1.3.0;
                # only write when it actually changed to keep the hot path cheap.
                if r.fw_version:
                    await db.execute(
                        text("""
                            UPDATE mini_nodes SET firmware_version = :fw
                            WHERE mininode_id = :mid AND firmware_version IS DISTINCT FROM :fw;
                        """),
                        {"fw": r.fw_version.strip(), "mid": r.mininode_id}
                    )

                # Mini node cold boots (power restored, not a timer wake) get logged per site
                if r.boot_reason == 1:
                    await db.execute(
                        text("""
                            INSERT INTO device_boot_logs (device_type, device_id, hub_id, boot_reason, firmware_version, logged_at)
                            VALUES ('MINI_NODE', :mid, :hub_id, 'POWER_ON', :fw, :now);
                        """),
                        {"mid": r.mininode_id, "hub_id": payload.hub_id, "fw": r.fw_version, "now": current_time}
                    )

                if state and r.moisture is not None:
                    # =======================================================
                    # AUTOMATED CALIBRATION INTERCEPTOR
                    # =======================================================
                    if state.get("calibration_mode", "IDLE") != "IDLE":
                        current_mode = state["calibration_mode"]
                        current_buffer = state.get("calibration_buffer", [])
                        if current_buffer is None: current_buffer = []
                        
                        current_buffer.append(int(r.moisture))
                        
                        if len(current_buffer) >= 10:
                            new_baseline = calculate_trimmed_mean(current_buffer)
                            column_to_update = "raw_dry_cal" if current_mode == "DRY" else "raw_wet_cal"
                            new_interval = 900000 if current_mode == "WET" else 60000
                            
                            update_cal_query = text(f"""
                                UPDATE mini_nodes 
                                SET {column_to_update} = :baseline, 
                                    calibration_mode = 'IDLE', 
                                    calibration_buffer = '{{}}',
                                    telemetry_interval_ms = :new_interval,
                                    last_seen = :now
                                WHERE mininode_id = :mid
                            """)
                            await db.execute(update_cal_query, {
                                "baseline": new_baseline, 
                                "new_interval": new_interval,
                                "mid": r.mininode_id,
                                "now": current_time
                            })
                            print(f"[{r.mininode_id}] CALIBRATION COMPLETE: {current_mode} = {new_baseline}")
                        else:
                            update_buf_query = text("""
                                UPDATE mini_nodes 
                                SET calibration_buffer = :buf , last_seen = :now
                                WHERE mininode_id = :mid
                            """)
                            await db.execute(update_buf_query, {
                                "buf": current_buffer, 
                                "mid": r.mininode_id,
                                "now": current_time
                            })
                        
                        continue 
                    # =======================================================

                    # NORMAL EMA % MATHEMATICS (Runs only if IDLE)
                    raw_dry = state.get("raw_dry_cal") or 2540
                    raw_wet = state.get("raw_wet_cal") or 700
                    if raw_dry == raw_wet: raw_dry += 1 

                    raw_pct = ((raw_dry - r.moisture) / (raw_dry - raw_wet)) * 100.0
                    raw_pct = max(0.0, min(100.0, raw_pct))

                    if state.get("last_ema") is None:
                        final_moisture_pct = raw_pct 
                    else:
                        final_moisture_pct = (alpha * raw_pct) + ((1.0 - alpha) * float(state["last_ema"]))

                    update_ema_query = text("UPDATE mini_nodes SET last_smoothed_moisture = :ema, last_seen = :now WHERE mininode_id = :mid")
                    await db.execute(update_ema_query, {"ema": final_moisture_pct, "now": current_time, "mid": r.mininode_id})
                    
                    # =======================================================
                    # NAVYAKOSH AUTO-RESTART LOGIC (48-Hour Threshold)
                    # =======================================================
                    node_cycle_status = state.get("cycle_status", "FERMENTATION_ACTIVE")
                    node_last_seen = state.get("last_seen")
                    
                    if node_cycle_status == "READY_FOR_PACKAGING" and node_last_seen:
                        if (current_time - node_last_seen).total_seconds() > 172800:
                            await db.execute(
                                text("UPDATE mini_nodes SET cycle_status = 'FERMENTATION_ACTIVE', cycle_start_time = :now WHERE mininode_id = :mid"),
                                {"now": current_time, "mid": r.mininode_id}
                            )
                            print(f"[{r.mininode_id}] NEW NAVYAKOSH BATCH DETECTED. Cycle auto-started.")

                    batch_data.append({
                        "mininode_id": r.mininode_id, "hub_id": payload.hub_id,
                        "temperature": r.temperature, 
                        "moisture": round(final_moisture_pct, 1), 
                        "current_time": current_time
                    })

                    # =====================================================================
                    # AUTONOMOUS LIMIT ENGINE: SMART STATE-AWARE RELAY DIFFING
                    # =====================================================================
                    rule = next((item for item in edge_rules if item["mininode_id"] == r.mininode_id), None)
                    if is_mini_node:
                        # P2P mini nodes are fully autonomous: they evaluate these same
                        # thresholds on-device and apply fan/bulb states over the mesh
                        # directly, so they never pull queued commands. Nulling the rule
                        # skips the whole hub-only command dispatch below.
                        rule = None
                    if rule:
                        calculated_fan_state = 0
                        calculated_bulb_state = 0

                        # 1. Evaluate Sensor Thresholds
                        if r.temperature is not None:
                            if r.temperature > rule["temp_max"]:
                                calculated_fan_state = 1
                            elif r.temperature < rule["temp_min"]:
                                calculated_bulb_state = 1

                        if final_moisture_pct is not None:
                            if final_moisture_pct > rule["moisture_max"]:
                                calculated_fan_state = 1

                        # Hardware Interlock Safety: When fans are ON, the bulb MUST be OFF.
                        if calculated_fan_state == 1:
                            calculated_bulb_state = 0

                        # 2. Extract Cached Configuration & State
                        target_fan_mac = state.get("fan_relay_mac")
                        target_bulb_mac = state.get("bulb_relay_mac")
                        f_ch = state.get("fan_channel")
                        b_ch = state.get("bulb_channel")
                        current_fan_state = state.get("fan_status", 0)
                        current_bulb_state = state.get("bulb_status", 0)

                        # =====================================================================
                        # NEW: TRUE HARDWARE STATE VERIFICATION (Time & Sync Logic Fixed)
                        # =====================================================================
                        expected_interval_sec = c_interval_ms / 1000
                        
                        # FIX 1: Only true for the first 60 seconds after the ESP32 boots up
                        recent_reboot = payload.uptime_seconds < 60
                        
                        # FIX 2: Triggers exactly once every 120 seconds. 
                        # We check `< 15` assuming your ESP32 sends a ping at least every 10-12 seconds during testing.
                        periodic_sync = (payload.uptime_seconds % 120) < 15

                        # 3. SMART QUEUE: EXHAUST FAN
                        if target_fan_mac and target_fan_mac != "UNASSIGNED":
                            # OVERRIDE triggered if states differ OR if hardware recently rebooted
                            if (calculated_fan_state != current_fan_state) or recent_reboot or periodic_sync:
                                # Flush old pending commands to prevent avalanches
                                await db.execute(
                                    text("DELETE FROM relay_commands_queue WHERE hub_id = :hub_id AND relay_mac = :mac AND fan_channel IS NOT NULL AND status = 'PENDING'"),
                                    {"hub_id": payload.hub_id.strip(), "mac": target_fan_mac}
                                )
                                # Queue the new authoritative command
                                await db.execute(
                                    text("""
                                        INSERT INTO relay_commands_queue (hub_id, relay_mac, fan_channel, fan_state, status, created_at)
                                        VALUES (:hub_id, :relay_mac, :fan_ch, :fan_state, 'PENDING', :now);
                                    """),
                                    {"hub_id": payload.hub_id.strip(), "relay_mac": target_fan_mac, "fan_ch": f_ch, "fan_state": calculated_fan_state, "now": current_time}
                                )
                                await db.execute(
                                    text("UPDATE mini_nodes SET fan_status = :state WHERE mininode_id = :mid"),
                                    {"state": calculated_fan_state, "mid": r.mininode_id}
                                )
                                state["fan_status"] = calculated_fan_state

                        # 4. SMART QUEUE: HEATER BULB
                        if target_bulb_mac and target_bulb_mac != "UNASSIGNED":
                            if (calculated_bulb_state != current_bulb_state) or recent_reboot or periodic_sync:
                                await db.execute(
                                    text("DELETE FROM relay_commands_queue WHERE hub_id = :hub_id AND relay_mac = :mac AND bulb_channel IS NOT NULL AND status = 'PENDING'"),
                                    {"hub_id": payload.hub_id.strip(), "mac": target_bulb_mac}
                                )
                                await db.execute(
                                    text("""
                                        INSERT INTO relay_commands_queue (hub_id, relay_mac, bulb_channel, bulb_state, status, created_at)
                                        VALUES (:hub_id, :relay_mac, :bulb_ch, :bulb_state, 'PENDING', :now);
                                    """),
                                    {"hub_id": payload.hub_id.strip(), "relay_mac": target_bulb_mac, "bulb_ch": b_ch, "bulb_state": calculated_bulb_state, "now": current_time}
                                )
                                await db.execute(
                                    text("UPDATE mini_nodes SET bulb_status = :state WHERE mininode_id = :mid"),
                                    {"state": calculated_bulb_state, "mid": r.mininode_id}
                                )
                                state["bulb_status"] = calculated_bulb_state
                                
            # Insert normal telemetry into database
            if batch_data:
                insert_telemetry_query = text("""
                    INSERT INTO hardware_data_received 
                    (mininode_id, hub_id, temperature, moisture, timestamp) 
                    VALUES (:mininode_id, :hub_id, :temperature, :moisture, :current_time);
                """)
                await db.execute(insert_telemetry_query, batch_data)

        # =====================================================================
        # COMMIT INSERTS SO THE SELECT QUERY CAN SEE THEM
        # =====================================================================
        await db.commit()

        # 4. Fetch Pending Manual/Autonomous Override Commands
        fetch_commands_query = text("""
            SELECT id, relay_mac, fan_state, bulb_state, target_channel, fan_channel, bulb_channel 
            FROM relay_commands_queue 
            WHERE hub_id = :hub_id AND status = 'PENDING'
            ORDER BY created_at ASC;
        """)
        commands_result = await db.execute(fetch_commands_query, {"hub_id": payload.hub_id})
        
        pending_commands = []
        command_ids = []

        for row in commands_result.mappings().all():
            if is_mini_node:
                # P2P mini nodes are autonomous and never pull commands; skip the queue
                # entirely for them so stale PENDING entries do not pile up per node.
                continue
            pending_commands.append({
                "command_id": row["id"],
                "relay_mac": row["relay_mac"],
                "fan_state": row["fan_state"],
                "bulb_state": row["bulb_state"],
                "target_channel": row["target_channel"],
                "fan_channel": row["fan_channel"],
                "bulb_channel": row["bulb_channel"]
            })
            command_ids.append(row["id"])

        # Mark commands as Dispatched so they don't get sent twice
        if command_ids:
            update_commands_query = text("""
                UPDATE relay_commands_queue 
                SET status = 'DISPATCHED', dispatched_at = :current_time
                WHERE id = ANY(:command_ids);
            """)
            await db.execute(update_commands_query, {"current_time": current_time, "command_ids": command_ids})
            await db.commit()

        return {
            "success": True,
            "system_config": {
                "telemetry_interval_ms": c_interval_ms,
                "urgent_interval_ms": 60000,
                "temp_warning_margin": 2.0,
                "moisture_warning_margin": 5.0,
                "sync_time_utc": current_time.isoformat(),
                "edge_rules": edge_rules
            },
            # Authoritative actuator snapshot. The hub dispatches any entry that differs
            # from its own last-dispatched cache — this is the power-cut recovery path,
            # and also a continuous self-heal for relays that missed a queued command.
            "desired_states": desired_states,
            "commands_count": len(pending_commands),
            "commands": pending_commands
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Ingestion Error: {str(e)}")

# =====================================================================
# 2. HARDWARE COMMAND ACKNOWLEDGMENT
# =====================================================================
@router.post("/acknowledge", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_hub_key)])
async def acknowledge_commands(payload: dict, db: AsyncSession = Depends(get_db)):
    """Accepts two payload shapes:

    1. What the Hub firmware actually sends — one physically-verified relay execution,
       forwarded from the relay board's mesh ack:
       {hub_id, relay_chip_id, channel, state, success, relay_mac?, timestamp_ms?}
    2. The legacy queue-completion list this endpoint originally demanded:
       {hub_id, acknowledgments: [{command_id, status}]}

    Shape 1 was 422-ing against the strict legacy schema for as long as the firmware has
    existed, so no execution proof was ever stored. The endpoint now takes a raw dict and
    branches on shape instead of rejecting the one the hardware speaks."""
    try:
        current_time = datetime.utcnow()
        hub_id = str(payload.get("hub_id", "")).strip()
        if not hub_id:
            raise HTTPException(status_code=400, detail="hub_id is required.")

        # --- Shape 1: hardware-verified ack from the mesh ---
        if "relay_chip_id" in payload:
            relay_mac = (payload.get("relay_mac") or "").strip() or None
            if relay_mac:
                # relay_mac carries an FK to relay_boards — log unknown MACs without the link
                # rather than failing the whole ack on a constraint violation.
                known = await db.execute(
                    text("SELECT 1 FROM relay_boards WHERE relay_mac = :mac;"), {"mac": relay_mac}
                )
                if not known.first():
                    relay_mac = None

            succeeded = bool(payload.get("success"))
            await db.execute(
                text("""
                    INSERT INTO relay_execution_acks
                        (relay_id, relay_mac, channel, state, status, hub_id, execution_status, executed_at)
                    VALUES (:rid, :mac, :ch, :st, :status, :hub, :estatus, :now);
                """),
                {
                    "rid": str(payload.get("relay_chip_id")),
                    "mac": relay_mac,
                    "ch": int(payload.get("channel", 0)),
                    "st": int(payload.get("state", 0)),
                    "status": "VERIFIED_SUCCESS" if succeeded else "VERIFIED_FAILED",
                    "hub": hub_id,
                    "estatus": "SUCCESS" if succeeded else "FAILED",
                    "now": current_time,
                },
            )
            if relay_mac:
                await db.execute(
                    text("UPDATE relay_boards SET last_seen = :now WHERE relay_mac = :mac;"),
                    {"now": current_time, "mac": relay_mac},
                )
            await db.commit()
            return {"success": True, "detail": "Hardware ack recorded."}

        # --- Shape 2: legacy queue-completion list ---
        acknowledgments = payload.get("acknowledgments") or []
        if not acknowledgments:
            return {"success": True, "detail": "No acknowledgments provided."}

        for ack in acknowledgments:
            await db.execute(
                text("""
                    INSERT INTO relay_execution_acks (command_id, hub_id, execution_status, executed_at)
                    VALUES (:command_id, :hub_id, :status, :executed_at);
                """),
                {
                    "command_id": ack.get("command_id"),
                    "hub_id": hub_id,
                    "status": ack.get("status"),
                    "executed_at": current_time,
                },
            )
            await db.execute(
                text("""
                    UPDATE relay_commands_queue
                    SET status = :status
                    WHERE id = :command_id AND hub_id = :hub_id;
                """),
                {
                    "status": "COMPLETED" if ack.get("status") == "SUCCESS" else "FAILED",
                    "command_id": ack.get("command_id"),
                    "hub_id": hub_id,
                },
            )

        await db.commit()
        return {"success": True, "detail": "Acknowledgments processed successfully."}

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Acknowledgment Error: {str(e)}")


# =====================================================================
# 3. DYNAMIC INTERVAL CONFIGURATION (From UI)
# =====================================================================
@router.put("/update-interval", status_code=status.HTTP_200_OK)
async def update_telemetry_interval(
    payload: IntervalUpdateRequest, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles(*ADMIN_ROLES))
):
    if payload.interval_minutes <= 0:
        raise HTTPException(status_code=400, detail="Interval must be greater than 0.")

    calculated_ms = payload.interval_minutes * 60 * 1000

    try:
        query = text("""
            UPDATE mini_nodes 
            SET telemetry_interval_ms = :calc_ms 
            WHERE mininode_id = :mininode_id;
        """)
        await db.execute(query, {"calc_ms": calculated_ms, "mininode_id": payload.mininode_id})
        await db.commit()
        return {"success": True, "new_interval_ms": calculated_ms}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Interval update failed: {str(e)}")


# =====================================================================
# 4. SINGLE TANK DRILL-DOWN DATA (For React Graphs)
# =====================================================================
@router.get("/device/{mininode_id}", status_code=status.HTTP_200_OK)
async def get_device_details(
    mininode_id: str, hours: int = 24, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)
):
    try:
        config_query = text("""
            SELECT m.mininode_id, m.fan_relay_mac, m.bulb_relay_mac, m.temp_min, m.temp_max,
                   m.moisture_min, m.moisture_max, m.telemetry_interval_ms, m.cycle_status, m.hub_id,
                   m.last_seen AS node_last_seen, c.last_seen AS hub_last_seen, c.factory_id, m.cycle_start_time,
                   m.fan_channel, m.bulb_channel, m.fan_status, m.bulb_status, m.node_index
            FROM mini_nodes m
            LEFT JOIN central_nodes c ON m.hub_id = c.hub_id
            WHERE m.mininode_id = :mid;
        """)
        config_res = await db.execute(config_query, {"mid": mininode_id})
        config_data = config_res.mappings().first()

        if not config_data:
            raise HTTPException(status_code=404, detail="Hardware node not found.")

        assert_factory_scope(current_user, config_data["factory_id"])

        config_dict = dict(config_data)
        if config_dict.get("node_last_seen"): config_dict["node_last_seen"] = config_dict["node_last_seen"].isoformat()
        if config_dict.get("hub_last_seen"): config_dict["hub_last_seen"] = config_dict["hub_last_seen"].isoformat()
        if config_dict.get("cycle_start_time"): config_dict["cycle_start_time"] = config_dict["cycle_start_time"].isoformat()

        # Fetch Relays
        relays_list = []
        if config_dict["hub_id"]:
            relays_query = text("SELECT DISTINCT relay_mac FROM relay_boards WHERE factory_id = (SELECT factory_id FROM central_nodes WHERE hub_id = :hid);")
            relays_res = await db.execute(relays_query, {"hid": config_dict["hub_id"]})
            relays_list = [str(row[0]).strip() for row in relays_res.fetchall() if row[0]]

        # --- SAFE TIME CALCULATION IN PYTHON ---
        max_time_query = text("SELECT MAX(timestamp) FROM hardware_data_received WHERE mininode_id = :mid")
        max_time_res = await db.execute(max_time_query, {"mid": mininode_id})
        max_time = max_time_res.scalar() or datetime.utcnow()
        
        start_time = max_time - timedelta(hours=hours)

        # Fetch Telemetry
        history_query = text("""
            SELECT temperature, moisture, timestamp
            FROM hardware_data_received
            WHERE mininode_id = :mid AND timestamp >= :start_time
            ORDER BY timestamp ASC;
        """)
        history_res = await db.execute(history_query, {"mid": mininode_id, "start_time": start_time})
        history_data = [dict(row) for row in history_res.mappings().all()]

        # Fetch Master Off Graph Markers
        markers_query = text("""
            SELECT concluded_at 
            FROM cycle_history_logs 
            WHERE mininode_id = :mid AND concluded_at >= :start_time
        """)
        markers_res = await db.execute(markers_query, {"mid": mininode_id, "start_time": start_time})
        marker_data = [row[0].isoformat() for row in markers_res.fetchall()]

        return {
            "success": True,
            "config": config_dict,
            "history": history_data,
            "available_relays": relays_list,
            "master_off_events": marker_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =====================================================================
# 5. MASTER OFF & PACKAGING NOTIFICATION TRIGGER
# =====================================================================
@router.post("/device/{mininode_id}/master-off", status_code=status.HTTP_200_OK)
async def trigger_master_off(
    mininode_id: str, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles(*ADMIN_ROLES))
):
    try:
        node_query = text("SELECT hub_id, fan_relay_mac, bulb_relay_mac FROM mini_nodes WHERE mininode_id = :mid;")
        node_res = await db.execute(node_query, {"mid": mininode_id})
        node = node_res.mappings().first()

        if not node:
            raise HTTPException(status_code=404, detail="Node not found.")

        current_time = datetime.utcnow()

        # Update status and log the historical event for the chart
        await db.execute(
            text("UPDATE mini_nodes SET cycle_status = 'READY_FOR_PACKAGING' WHERE mininode_id = :mid;"),
            {"mid": mininode_id}
        )
        await db.execute(
            text("INSERT INTO cycle_history_logs (mininode_id, concluded_at) VALUES (:mid, :now);"),
            {"mid": mininode_id, "now": current_time}
        )

        relays_to_kill = set([node["fan_relay_mac"], node["bulb_relay_mac"]])
        for r_mac in relays_to_kill:
            if r_mac and r_mac != "UNASSIGNED":
                await db.execute(
                    text("""
                        INSERT INTO relay_commands_queue (hub_id, relay_mac, fan_channel, bulb_channel, fan_state, bulb_state, status, created_at)
                        VALUES (:hub_id, :relay_mac, NULL, NULL, 0, 0, 'PENDING', :now);
                    """),
                    {"hub_id": node["hub_id"], "relay_mac": r_mac, "now": current_time}
                )

        await db.commit()
        return {"success": True, "detail": "Navyakosh Cycle finalized. Master OFF triggered."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

  

# =====================================================================
# 6. CONFIGURATION EDITOR
# =====================================================================
@router.put("/device/{mininode_id}/config", status_code=status.HTTP_200_OK)
async def update_device_config(
    mininode_id: str, payload: dict, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles(*ADMIN_ROLES))
):
    try:
        query = text("""
            UPDATE mini_nodes 
            SET temp_min = :temp_min, 
                temp_max = :temp_max, 
                moisture_min = :moisture_min, 
                moisture_max = :moisture_max, 
                telemetry_interval_ms = :telemetry_interval_ms
            WHERE mininode_id = :mid;
        """)
        await db.execute(query, {**payload, "mid": mininode_id})
        await db.commit()
        return {"success": True}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# 7. COMMAND HISTORY (For UI Table)
# =====================================================================
@router.get("/device/{mininode_id}/history", status_code=status.HTTP_200_OK)
async def get_device_history(
    mininode_id: str, db: AsyncSession = Depends(get_db), _: dict = Depends(get_current_user)
):
    acks = await db.execute(text("""
        SELECT * FROM relay_execution_acks 
        WHERE command_id IN (
            SELECT id FROM relay_commands_queue 
            WHERE relay_mac IN (
                SELECT fan_relay_mac FROM mini_nodes WHERE mininode_id = :mid
                UNION
                SELECT bulb_relay_mac FROM mini_nodes WHERE mininode_id = :mid
            )
        ) 
        ORDER BY executed_at DESC 
        LIMIT 20;
    """), {"mid": mininode_id})
    return {"acks": [dict(r) for r in acks.mappings()]}

@router.post("/device/{mininode_id}/calibrate", status_code=status.HTTP_200_OK)
async def start_calibration_phase(
    mininode_id: str,
    payload: CalibrationTrigger,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_roles(*ADMIN_ROLES)),
):
    if payload.mode not in ["DRY", "WET"]:
        raise HTTPException(status_code=400, detail="Mode must be DRY or WET")
        
    try:
        query = text("""
            UPDATE mini_nodes 
            SET calibration_mode = :mode, 
                calibration_buffer = '{}', 
                telemetry_interval_ms = 60000 
            WHERE mininode_id = :mid;
        """)
        await db.execute(query, {"mode": payload.mode, "mid": mininode_id})
        await db.commit()
        return {"success": True, "detail": f"Node entering {payload.mode} calibration phase."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# =====================================================================
# 8. INTERACTIVE SWEEPER API (For React Configuration Wizard)
# =====================================================================
@router.post("/device/diagnostic-pulse", status_code=status.HTTP_200_OK)
async def diagnostic_pulse_test(
    payload: AutomatedSweepSchema, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))
):
    try:
        # We now explicitly pass the `target_channel` to the queue so the ESP32 knows which pin to fire
        await db.execute(
            text("""
                INSERT INTO relay_commands_queue 
                (hub_id, relay_mac, target_channel, fan_state, bulb_state, status, created_at)
                VALUES (:hub_id, :relay_mac, :channel, :state, :state, 'PENDING', :now);
            """),
            {
                "hub_id": payload.hub_id.strip(),
                "relay_mac": payload.relay_mac.strip(),
                "channel": payload.channel,
                "state": payload.state,
                "now": datetime.utcnow()
            }
        )
        await db.commit()
        return {"success": True, "detail": f"Sweep pulsing {payload.relay_mac} Channel {payload.channel}"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/device/bind-confirmed-ports", status_code=status.HTTP_200_OK)
async def bind_confirmed_ports(
    payload: SaveSweepMatrixSchema, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))
):
    try:
        query = text("""
            UPDATE mini_nodes 
            SET fan_relay_mac = :fan_relay_mac, 
                fan_channel = :fan_ch, 
                bulb_relay_mac = :bulb_relay_mac,
                bulb_channel = :bulb_ch
            WHERE mininode_id = :mid;
        """)
        await db.execute(query, {
            "fan_relay_mac": payload.fan_relay_mac.strip(),
            "fan_ch": payload.fan_channel,
            "bulb_relay_mac": payload.bulb_relay_mac.strip(),
            "bulb_ch": payload.bulb_channel,
            "mid": payload.mininode_id.strip()
        })
        await db.commit()
        return {"success": True, "detail": "Flexible matrix mapping confirmed."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))