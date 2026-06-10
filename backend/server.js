const express = require('express');
const cors = require('cors');
// Import the centralized database connection pool you created
const db = require('./database.js');
require('dotenv').config();

// Router imports
const telemetryRouter = require('./telemetry.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ==========================================================
// MOUNT EXTERNAL ROUTERS (Passing the initialized DB pool)
// ==========================================================
// Passed db down smoothly into your telemetry engines
app.use('/api/telemetry', telemetryRouter(db));
app.use('/telemetry', telemetryRouter(db)); 


// ==========================================================
// ROUTE: GET /api/devices (Get current node configurations)
// ==========================================================
app.get('/api/devices', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM mininodes ORDER BY mininode_id ASC;');
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================================
// ROUTE: POST /api/thresholds (Update node operational limits)
// ==========================================================
app.post('/api/thresholds', async (req, res) => {
    const { mininode_id, min_temp, max_temp, min_moisture, max_moisture } = req.body;
    try {
        const queryText = `
            UPDATE mininodes 
            SET min_temp = $1, max_temp = $2, min_moisture = $3, max_moisture = $4 
            WHERE mininode_id = $5 RETURNING *;
        `;
        const result = await db.query(queryText, [min_temp, max_temp, min_moisture, max_moisture, mininode_id]);
        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Base Root Route
app.get('/', (req, res) => { 
    const isProduction = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('amazonaws.com');
    const message = isProduction ? 'IoT Cloud Backend Live via Unified Connection String.' : 'IoT Local Live.';
    res.send(message); 
});

// Start Server Listen Execution Loop
app.listen(PORT, () => { 
    console.log(`Server executing safely on port: ${PORT}`); 
});

// Root Export Compatibility for Vercel Serverless Architecture
module.exports = app;