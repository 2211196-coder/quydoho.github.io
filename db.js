const fs = require('fs');
const path = require('path');

const DB_TYPE = process.env.DB_TYPE || 'sheets'; // 'json' | 'supabase' | 'mongodb' | 'sheets'

// JSON Files Path
const USERS_FILE = path.join(__dirname, 'users.json');
const CONNECTIONS_FILE = path.join(__dirname, 'connections.json');
const POOLS_FILE = path.join(__dirname, 'pools.json');

// MongoDB config
const MONGO_URI = process.env.MONGO_URI || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'xiaozhi';
let mongoClient = null;

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Google Sheets config
const GOOGLE_SHEET_SCRIPT_URL = process.env.GOOGLE_SHEET_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzAmQ2MvHHcAa3t1x9NE8VhvVkO5cJbIF1T0JqlvPmUZIq0Ai51KGr6uQnZMGggedKA/exec';

// Initialize local JSON files if DB_TYPE is json
function initJsonFiles() {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
      {
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        score: 0,
        chatCount: 0
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
  }

  if (!fs.existsSync(CONNECTIONS_FILE)) {
    fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify({}, null, 2), 'utf8');
  }

  if (!fs.existsSync(POOLS_FILE)) {
    fs.writeFileSync(POOLS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

if (DB_TYPE === 'json') {
  initJsonFiles();
}

// MongoDB helper
async function getMongoClient() {
  if (mongoClient) return mongoClient;
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured in environment variables');
  }
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  return mongoClient;
}

// ─── USER OPERATIONS ───

async function readUsers() {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) {
      console.warn('[DB] GOOGLE_SHEET_SCRIPT_URL is not configured. Falling back to local users.');
    } else {
      try {
        const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'readUsers' })
        });
        if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
        const data = await res.json();
        if (data && data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        console.error('[DB] Error reading users from Google Sheets, falling back to local users:', err.message);
      }
    }
    // Fallback: JSON File
    try {
      if (!fs.existsSync(USERS_FILE)) initJsonFiles();
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Lỗi đọc file users.json:', err);
      return [];
    }
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.warn('[DB] Supabase is not configured. Falling back to empty users list.');
      return [];
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=*`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
      const data = await res.json();
      return data.map(u => ({
        username: u.username,
        password: u.password,
        role: u.role,
        score: u.score,
        chatCount: u.chat_count // Map DB snake_case to JS camelCase
      }));
    } catch (err) {
      console.error('[DB] Error reading users from Supabase:', err.message);
      return [];
    }
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      const users = await db.collection('users').find({}).toArray();
      return users.map(u => ({
        username: u.username,
        password: u.password,
        role: u.role,
        score: u.score,
        chatCount: u.chatCount
      }));
    } catch (err) {
      console.error('[DB] Error reading users from MongoDB:', err.message);
      return [];
    }
  }

  // Fallback: JSON File (non-sheets modes)
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Lỗi đọc file users.json:', err);
    return [];
  }
}

async function writeUsers(users) {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) return;
    try {
      const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'writeUsers', payload: users })
      });
      if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
    } catch (err) {
      console.error('[DB] Error writing users to Google Sheets:', err.message);
    }
    return;
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      // Supabase upsert
      const payload = users.map(u => ({
        username: u.username,
        password: u.password,
        role: u.role || 'user',
        score: u.score || 0,
        chat_count: u.chatCount || 0
      }));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
    } catch (err) {
      console.error('[DB] Error writing users to Supabase:', err.message);
    }
    return;
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      // Clean and bulk write/replace collection
      await db.collection('users').deleteMany({});
      if (users.length > 0) {
        await db.collection('users').insertMany(users);
      }
    } catch (err) {
      console.error('[DB] Error writing users to MongoDB:', err.message);
    }
    return;
  }

  // Fallback: JSON File
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('Lỗi ghi file users.json:', err);
  }
}

// ─── CONNECTION OPERATIONS ───

async function readConnections() {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) {
      console.warn('[DB] GOOGLE_SHEET_SCRIPT_URL is not configured. Falling back to local connections.');
    } else {
      try {
        const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'readConnections' })
        });
        if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
        const data = await res.json();
        if (data && data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        console.error('[DB] Error reading connections from Google Sheets, falling back to local connections:', err.message);
      }
    }
    // Fallback: JSON File
    try {
      if (!fs.existsSync(CONNECTIONS_FILE)) initJsonFiles();
      const data = fs.readFileSync(CONNECTIONS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Lỗi đọc file connections.json:', err);
      return {};
    }
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return {};
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/connections?select=*`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
      const data = await res.json();
      const conns = {};
      data.forEach(c => {
        conns[c.conn_key] = {
          mac_address: c.mac_address,
          serial_number: c.serial_number,
          hmac_key: c.hmac_key
        };
      });
      return conns;
    } catch (err) {
      console.error('[DB] Error reading connections from Supabase:', err.message);
      return {};
    }
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      const connectionsList = await db.collection('connections').find({}).toArray();
      const conns = {};
      connectionsList.forEach(c => {
        conns[c.connKey] = {
          mac_address: c.mac_address,
          serial_number: c.serial_number,
          hmac_key: c.hmac_key
        };
      });
      return conns;
    } catch (err) {
      console.error('[DB] Error reading connections from MongoDB:', err.message);
      return {};
    }
  }

  // Fallback: JSON File
  try {
    const data = fs.readFileSync(CONNECTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Lỗi đọc file connections.json:', err);
    return {};
  }
}

async function writeConnections(connections) {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) return;
    try {
      const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'writeConnections', payload: connections })
      });
      if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
    } catch (err) {
      console.error('[DB] Error writing connections to Google Sheets:', err.message);
    }
    return;
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      const payload = Object.keys(connections).map(key => ({
        conn_key: key,
        mac_address: connections[key].mac_address || '',
        serial_number: connections[key].serial_number || '',
        hmac_key: connections[key].hmac_key || ''
      }));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/connections`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
    } catch (err) {
      console.error('[DB] Error writing connections to Supabase:', err.message);
    }
    return;
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      await db.collection('connections').deleteMany({});
      const payload = Object.keys(connections).map(key => ({
        connKey: key,
        mac_address: connections[key].mac_address || '',
        serial_number: connections[key].serial_number || '',
        hmac_key: connections[key].hmac_key || ''
      }));
      if (payload.length > 0) {
        await db.collection('connections').insertMany(payload);
      }
    } catch (err) {
      console.error('[DB] Error writing connections to MongoDB:', err.message);
    }
    return;
  }

  // Fallback: JSON File
  try {
    fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2), 'utf8');
  } catch (err) {
    console.error('Lỗi ghi file connections.json:', err);
  }
}

// ─── POOLS OPERATIONS ───

async function readPools() {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) {
      console.warn('[DB] GOOGLE_SHEET_SCRIPT_URL is not configured. Falling back to local pools.');
    } else {
      try {
        const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'readPools' })
        });
        if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
        const data = await res.json();
        if (data && data.error) throw new Error(data.error);
        return data;
      } catch (err) {
        console.error('[DB] Error reading pools from Google Sheets, falling back to local pools:', err.message);
      }
    }
    // Fallback: JSON File
    try {
      if (!fs.existsSync(POOLS_FILE)) initJsonFiles();
      const data = fs.readFileSync(POOLS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Lỗi đọc file pools.json:', err);
      return [];
    }
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return [];
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pools?select=*`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
      const data = await res.json();
      return data.map(p => ({
        device_key: p.device_key,
        chatbot_id: p.chatbot_id,
        mac_address: p.mac_address,
        serial_number: p.serial_number,
        hmac_key: p.hmac_key,
        activated: p.activated,
        leased_to: p.leased_to,
        leased_at: p.leased_at
      }));
    } catch (err) {
      console.error('[DB] Error reading pools from Supabase:', err.message);
      return [];
    }
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      const poolsList = await db.collection('pools').find({}).toArray();
      return poolsList.map(p => ({
        device_key: p.deviceKey,
        chatbot_id: p.chatbotId,
        mac_address: p.macAddress,
        serial_number: p.serialNumber,
        hmac_key: p.hmacKey,
        activated: p.activated,
        leased_to: p.leasedTo,
        leased_at: p.leasedAt
      }));
    } catch (err) {
      console.error('[DB] Error reading pools from MongoDB:', err.message);
      return [];
    }
  }

  // Fallback: JSON File
  try {
    const data = fs.readFileSync(POOLS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Lỗi đọc file pools.json:', err);
    return [];
  }
}

async function writePools(pools) {
  if (DB_TYPE === 'sheets') {
    if (!GOOGLE_SHEET_SCRIPT_URL) return;
    try {
      const res = await fetch(GOOGLE_SHEET_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'writePools', payload: pools })
      });
      if (!res.ok) throw new Error(`Google Sheet returned status ${res.status}`);
      const data = await res.json().catch(() => ({}));
      if (data && data.error) throw new Error(data.error);
    } catch (err) {
      console.error('[DB] Error writing pools to Google Sheets, falling back to local pools.json:', err.message);
      try {
        fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2), 'utf8');
      } catch (localErr) {
        console.error('Lỗi ghi file pools.json:', localErr);
      }
    }
    return;
  }

  if (DB_TYPE === 'supabase') {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      const payload = pools.map(p => ({
        device_key: p.device_key,
        chatbot_id: p.chatbot_id,
        mac_address: p.mac_address || '',
        serial_number: p.serial_number || '',
        hmac_key: p.hmac_key || '',
        activated: p.activated || false,
        leased_to: p.leased_to || '',
        leased_at: p.leased_at || 0
      }));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pools`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Supabase returned status ${res.status}`);
    } catch (err) {
      console.error('[DB] Error writing pools to Supabase:', err.message);
    }
    return;
  }

  if (DB_TYPE === 'mongodb') {
    try {
      const client = await getMongoClient();
      const db = client.db(MONGO_DB_NAME);
      await db.collection('pools').deleteMany({});
      const payload = pools.map(p => ({
        deviceKey: p.device_key,
        chatbotId: p.chatbot_id,
        macAddress: p.mac_address || '',
        serialNumber: p.serial_number || '',
        hmacKey: p.hmac_key || '',
        activated: p.activated || false,
        leasedTo: p.leased_to || '',
        leasedAt: p.leased_at || 0
      }));
      if (payload.length > 0) {
        await db.collection('pools').insertMany(payload);
      }
    } catch (err) {
      console.error('[DB] Error writing pools to MongoDB:', err.message);
    }
    return;
  }

  // Fallback: JSON File
  try {
    fs.writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 2), 'utf8');
  } catch (err) {
    console.error('Lỗi ghi file pools.json:', err);
  }
}

module.exports = {
  readUsers,
  writeUsers,
  readConnections,
  writeConnections,
  readPools,
  writePools
};
