const express = require('express');

// Export a function that accepts the db pool instance directly
module.exports = function(pool) {
    const router = express.Router();

    // ==========================================================
    // ROUTE: GET /api/telemetry (Mounted at base context /api/telemetry)
    // ==========================================================
    router.get('/', async (req, res) => {
        // Extract streamlined data array from the query string parameters
        const { tankId, temp, moisture, timestamp, hubId } = req.query;

        // 1. Parameter presence verification
        if (!tankId || temp === undefined || moisture === undefined || !hubId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing fields. Expected parameters: tankId, temp, moisture, timestamp, hubId.' 
            });
        }

        // Keep tankId as a sanitized String to match your database schema VARCHAR(50) primary key
        const parsedTankId = String(tankId).trim();
        const parsedTemp = parseFloat(temp);
        const parsedMoisture = parseFloat(moisture);

        // Validate parsing for float parameters to avoid hitting database execution constraints
        if (isNaN(parsedTemp) || isNaN(parsedMoisture)) {
            return res.status(400).json({
                success: false,
                error: 'Format mismatch. temp and moisture must be numerical values.'
            });
        }

        try {
            // 2. Database Insertion (Targeting your exact 5 data columns, including hub_id)
            const queryText = `
                INSERT INTO hardware_data_received (mininode_id, temperature, moisture, timestamp, hub_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            
            const finalTimestamp = timestamp ? timestamp : new Date().toISOString();
            const values = [parsedTankId, parsedTemp, parsedMoisture, finalTimestamp, hubId];
            
            // Using the directly passed pool instance
            const result = await pool.query(queryText, values);

            console.log(`[Database Ingest Success] Tank: ${parsedTankId} | Hub ID: ${hubId}`);

            // --- Non-blocking Central Gateway Sync ---
            /*try {
                const CENTRAL_NODE_API = "http://YOUR_CENTRAL_NODE_PUBLIC_IP_OR_URL/api/notify";
                await fetch(CENTRAL_NODE_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event: "WORKER_DATA_INGESTED",
                        mininode_id: parsedTankId,
                        temperature: parsedTemp,
                        moisture: parsedMoisture,
                        hub_id: hubId,
                        hardware_timestamp: finalTimestamp,
                        forwardedAt: new Date().toISOString()
                    }),
                    signal: AbortSignal.timeout(3000) 
                });
            } catch (centralError) {
                console.warn(`[Central Sync] Forwarding skipped: ${centralError.message}`);
            }*/

            return res.status(200).json({ 
                success: true, 
                message: `Telemetry safely committed to database table row for Hub: ${hubId}`, 
                data: result.rows[0] 
            });

        } catch (dbError) {
            console.error('[Critical DB Fault]', dbError);
            return res.status(500).json({ 
                success: false, 
                error: 'Database transaction insertion error.',
                database_says: dbError.message,
                database_detail: dbError.detail
            });
        }
    });

    // ==========================================================
    // ROUTE: GET /api/telemetry/history/:nodeId (Mounted at /api/telemetry/history/:nodeId)
    // ==========================================================
    router.get('/history/:nodeId', async (req, res) => {
        const { nodeId } = req.params;
        
        try {
            const queryText = `
                SELECT to_char(timestamp, 'HH24:MI') as time_label, temperature, moisture 
                FROM hardware_data_received 
                WHERE mininode_id = $1 
                ORDER BY timestamp DESC 
                LIMIT 16;
            `;
            // Using the directly passed pool instance
            const result = await pool.query(queryText, [nodeId]);
            res.status(200).json({ success: true, data: result.rows.reverse() });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};