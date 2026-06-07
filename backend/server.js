const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// Inside backend/server.js
// Update this line to look for telemetry in the same directory:
const telemetryRouter = require('./telemetry.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize connection pool configuration to PostgreSQL database
// Enforces SSL dynamically to connect securely to AWS RDS from cloud environments
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,   // Dynamically resolves via Vercel Environment Variables
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
    ssl: process.env.NODE_ENV === 'production' || (process.env.DB_HOST && process.env.DB_HOST.includes('amazonaws.com')) 
        ? { rejectUnauthorized: false } 
        : false
});

// Establish initial database handshake confirmation log
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client from PostgreSQL Pool:', err.stack);
    }
    const envType = process.env.NODE_ENV === 'production' || (process.env.DB_HOST && process.env.DB_HOST.includes('amazonaws.com')) 
        ? 'AWS Production' 
        : 'Local';
    console.log(`Successfully connected to ${envType} PostgreSQL Database [${process.env.DB_NAME}]`);
    release();
});

// ==========================================================
// MOUNT EXTERNAL ROUTERS (Passing the initialized DB pool)
// ==========================================================
// Twin-mounted to catch requests whether Vercel strips the prefix or keeps it intact
app.use('/api/telemetry', telemetryRouter(pool));
app.use('/telemetry', telemetryRouter(pool)); 


// ==========================================================
// ROUTE: GET /api/devices (Get current node configurations)
// ==========================================================
app.get('/api/devices', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mininodes ORDER BY mininode_id ASC;');
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
        const result = await pool.query(queryText, [min_temp, max_temp, min_moisture, max_moisture, mininode_id]);
        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Base Root Route
app.get('/', (req, res) => { 
    const isProduction = process.env.NODE_ENV === 'production' || (process.env.DB_HOST && process.env.DB_HOST.includes('amazonaws.com'));
    const message = isProduction ? 'IoT Cloud Backend Live.' : 'IoT Local Live.';
    res.send(message); 
});

// Start Server Listen Execution Loop
app.listen(PORT, () => { 
    console.log(`Server executing safely on port: ${PORT}`); 
});

// Root Export Compatibility for Vercel Serverless Architecture
module.exports = app;