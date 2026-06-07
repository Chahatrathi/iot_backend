-- 1. PLANT CONFIGURATION
CREATE TABLE plants (
    plant_id SERIAL PRIMARY KEY,
    plant_name VARCHAR(100) NOT NULL,
    factory_username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    mobile_no VARCHAR(15)
);

-- 2. HARDWARE INFRASTRUCTURE CENTRAL HUBS
CREATE TABLE central_hubs (
    central_id VARCHAR(50) PRIMARY KEY, -- e.g., 'HUB-GURUGRAM-01'
    plant_id INT REFERENCES plants(plant_id) ON DELETE CASCADE
);

-- 3. RELAY CONTROLLER BOARDS
CREATE TABLE relay_boards (
    relay_id VARCHAR(50) PRIMARY KEY, -- e.g., 'RELAY-BOARD-01'
    central_id VARCHAR(50) REFERENCES central_hubs(central_id) ON DELETE CASCADE
);

-- 4. HARDWARE NODES (ESP-001, ESP-003, etc.)
CREATE TABLE mininodes (
    mininode_id VARCHAR(50) PRIMARY KEY, -- e.g., 'ESP-001'
    tank_name VARCHAR(100) NOT NULL,    -- e.g., 'Tank A Mixer'
    central_id VARCHAR(50) REFERENCES central_hubs(central_id) ON DELETE CASCADE,
    relay_id VARCHAR(50) REFERENCES relay_boards(relay_id) ON DELETE SET NULL,
    min_temp NUMERIC(5,2) DEFAULT 68.00,
    max_temp NUMERIC(5,2) DEFAULT 85.00,
    min_moisture NUMERIC(5,2) DEFAULT 38.00,
    max_moisture NUMERIC(5,2) DEFAULT 60.00,
    status VARCHAR(10) DEFAULT 'OFF' CHECK (status IN ('ON', 'OFF'))
);

-- 5. ROLE ACCESS MATRIX
CREATE TABLE role_access (
    role_name VARCHAR(30) PRIMARY KEY, -- 'SuperAdmin', 'Admin', 'User'
    access_level VARCHAR(10) NOT NULL  -- 'UA', 'LCB', 'Factory'
);

-- 6. INVENTORY HISTORICAL TELEMETRY (TIME-SERIES)
CREATE TABLE hardware_data_received (
    data_id BIGSERIAL PRIMARY KEY,
    mininode_id VARCHAR(50) REFERENCES mininodes(mininode_id) ON DELETE CASCADE,
    temperature NUMERIC(5,2) NOT NULL,
    moisture NUMERIC(5,2) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Populate structural access defaults
INSERT INTO role_access (role_name, access_level) VALUES 
('SuperAdmin', 'UA'),
('Admin', 'LCB'),
('User', 'Factory');