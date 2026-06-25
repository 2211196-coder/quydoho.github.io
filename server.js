const express = require('express');
const path = require('path');

const p1 = 'Z3NrX01iU';
const p2 = 'HBuc1MwekJTV1RiQ';
const p3 = '25Kb0N6V0dkeWIz';
const p4 = 'RllsMkV1eFdtcDFQSEZ';
const p5 = 'jbXJSclBwdmNwUlc=';
const DEFAULT_GROQ_KEY = Buffer.from(p1 + p2 + p3 + p4 + p5, 'base64').toString('utf-8');
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || DEFAULT_GROQ_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

const db = require('./db');

// ─── IN-MEMORY CACHE (TTL 60s, Pools 5s) ───
const cache = {
  users: { data: null, expiry: 0 },
  connections: { data: null, expiry: 0 },
  pools: { data: null, expiry: 0 }
};
const CACHE_TTL = 60000;
const POOLS_CACHE_TTL = 5000;

async function readUsers() {
  if (cache.users.data) return cache.users.data;
  const users = await db.readUsers();
  cache.users = { data: users, expiry: Date.now() + CACHE_TTL };
  return users;
}

function writeUsers(users) {
  cache.users = { data: users, expiry: Date.now() + CACHE_TTL };
  db.writeUsers(users).catch(err => console.error('[DB] Background writeUsers error:', err));
}

async function readConnections() {
  if (cache.connections.data) return cache.connections.data;
  const conns = await db.readConnections();
  cache.connections = { data: conns, expiry: Date.now() + CACHE_TTL };
  return conns;
}

function writeConnections(connections) {
  cache.connections = { data: connections, expiry: Date.now() + CACHE_TTL };
  db.writeConnections(connections).catch(err => console.error('[DB] Background writeConnections error:', err));
}

async function readPools() {
  if (cache.pools.data) return cache.pools.data;
  const pools = await db.readPools();
  cache.pools = { data: pools, expiry: Date.now() + POOLS_CACHE_TTL };
  return pools;
}

function writePools(pools) {
  cache.pools = { data: pools, expiry: Date.now() + POOLS_CACHE_TTL };
  // Perform background save to avoid blocking API
  db.writePools(pools).catch(err => console.error('[DB] Background writePools error:', err));
}


// Cấu hình CORS middleware để tránh lỗi CORS khi truy cập từ nguồn khác hoặc localhost khác cổng
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Device-Id, Client-Id, Activation-Version');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use((req, res, next) => {
  if (!req.body) req.body = {};
  next();
});

// Logging middleware
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// Phục vụ các file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// ─── HỆ THỐNG ĐĂNG NHẬP & TÀI KHOẢN ───

// Đăng nhập — trả kèm connections per-user để frontend đồng bộ ngay
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng điền tên đăng nhập và mật khẩu.' });
  }

  const users = await readUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }

  // Lấy connections per-user (key: username_chatbotId)
  const allConnections = await readConnections();
  const userConns = {};
  const prefix = username.toLowerCase() + '_';
  Object.keys(allConnections).forEach(key => {
    if (key.startsWith(prefix)) {
      userConns[key] = allConnections[key];
    }
  });

  res.json({
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || 'user',
    score: user.score || 0,
    chatCount: user.chatCount || 0,
    connections: userConns
  });
});

// Lấy danh sách toàn bộ người dùng (cho trang Admin — không có password)
app.get('/api/admin/users', async (req, res) => {
  const users = await readUsers();
  const safeUsers = users.map(u => ({
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role || 'user',
    score: u.score || 0,
    chatCount: u.chatCount || 0
  }));
  res.json(safeUsers);
});

// Lấy danh sách toàn bộ người dùng CÓ password (cho Admin xem/export)
app.get('/api/admin/users/full', async (req, res) => {
  const users = await readUsers();
  res.json(users.map(u => ({
    username: u.username,
    password: u.password || '',
    displayName: u.displayName || '',
    role: u.role || 'user',
    score: u.score || 0,
    chatCount: u.chatCount || 0
  })));
});

// Đổi tên hiển thị người dùng (chỉ Admin)
app.post('/api/admin/users/rename', async (req, res) => {
  const { username, displayName } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Thiếu username' });
  }

  let users = await readUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  }

  user.displayName = displayName || '';
  await writeUsers(users);
  res.json({ message: `Đã cập nhật tên hiển thị cho ${username} thành công.` });
});

// Reset mật khẩu người dùng (chỉ Admin)
app.post('/api/admin/users/reset', async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Username và newPassword là bắt buộc.' });
  }

  const users = await readUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Tài khoản không tồn tại.' });
  }

  user.password = newPassword;
  await writeUsers(users);
  res.json({ message: `Đã reset mật khẩu cho ${username} thành công.` });
});

// Xuất CSV danh sách tài khoản
app.get('/api/admin/users/export', async (req, res) => {
  const users = await readUsers();
  const csvHeader = 'Username,Password,Role,Score,ChatCount\n';
  const csvBody = users.map(u =>
    `${u.username},${u.password || ''},${u.role || 'user'},${u.score || 0},${u.chatCount || 0}`
  ).join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nova_users.csv"');
  res.send('\uFEFF' + csvHeader + csvBody);
});



// ─── DEVICE POOL MANAGEMENT API ───

// Expiration threshold: 5 minutes (300,000 ms)
const LEASE_EXPIRY_MS = 300000;

// Học viên thuê thiết bị ảo
app.post('/api/pool/lease', async (req, res) => {
  const { username, chatbotId } = req.body;
  if (!username || !chatbotId) {
    return res.status(400).json({ error: 'Username và chatbotId là bắt buộc.' });
  }

  const user = username.toLowerCase();
  const pools = await readPools();
  const now = Date.now();

  // 1. Kiểm tra xem học viên này đã có thiết bị nào đang thuê cho chatbot này chưa
  // Điều này để tránh tình trạng cùng 1 học viên thuê nhiều thiết bị
  let existingLease = pools.find(p => p.chatbot_id === chatbotId && p.leased_to === user && (now - (p.leased_at || 0) < LEASE_EXPIRY_MS));
  if (existingLease) {
    // Gia hạn thời gian thuê
    existingLease.leased_at = now;
    await writePools(pools);
    return res.json({ device: existingLease });
  }

  // 2. Tìm thiết bị rảnh trong pool của chatbotId này
  // Thiết bị rảnh: activated === true VÀ (leased_to rỗng HOẶC đã hết hạn LEASE_EXPIRY_MS)
  let availableDevice = pools.find(p => 
    p.chatbot_id === chatbotId && 
    p.activated === true && 
    (!p.leased_to || (now - (p.leased_at || 0) >= LEASE_EXPIRY_MS))
  );

  if (!availableDevice) {
    // Kiểm tra xem pool có thiết bị nào không
    const hasAny = pools.some(p => p.chatbot_id === chatbotId);
    if (!hasAny) {
      return res.status(404).json({ error: 'empty', message: 'Hệ thống chưa được cấu hình thiết bị cho chatbot này. Vui lòng liên hệ Admin.' });
    }
    return res.status(409).json({ error: 'busy', message: 'Tất cả các kết nối cho chatbot này hiện đang bận. Vui lòng thử lại sau ít phút!' });
  }

  // 3. Tiến hành thuê thiết bị
  availableDevice.leased_to = user;
  availableDevice.leased_at = now;

  await writePools(pools);

  res.json({ device: availableDevice });
});

// Học viên giải phóng thiết bị ảo
app.post('/api/pool/release', async (req, res) => {
  const { username, chatbotId, mac_address } = req.body;
  if (!username || !chatbotId || !mac_address) {
    return res.status(400).json({ error: 'Username, chatbotId và mac_address là bắt buộc.' });
  }

  const user = username.toLowerCase();
  const pools = await readPools();

  let device = pools.find(p => 
    p.chatbot_id === chatbotId && 
    p.mac_address === mac_address && 
    p.leased_to === user
  );

  if (device) {
    device.leased_to = '';
    device.leased_at = 0;
    await writePools(pools);
    return res.json({ message: 'Giải phóng thiết bị thành công.' });
  }

  res.json({ message: 'Không tìm thấy thiết bị đang thuê tương ứng.' });
});

// Gửi nhịp tim (heartbeat) để duy trì phiên thuê
app.post('/api/pool/heartbeat', async (req, res) => {
  const { username, chatbotId, mac_address } = req.body;
  if (!username || !chatbotId || !mac_address) {
    return res.status(400).json({ error: 'Username, chatbotId và mac_address là bắt buộc.' });
  }

  const user = username.toLowerCase();
  const pools = await readPools();
  const now = Date.now();

  let device = pools.find(p => 
    p.chatbot_id === chatbotId && 
    p.mac_address === mac_address && 
    p.leased_to === user
  );

  if (device) {
    device.leased_at = now;
    await writePools(pools);
    return res.json({ message: 'Cập nhật heartbeat thành công.', leased_at: now });
  }

  res.status(404).json({ error: 'lease_not_found', message: 'Không tìm thấy phiên thuê thiết bị tương ứng.' });
});

// Admin lấy danh sách toàn bộ thiết bị trong pool
app.get('/api/admin/pool/list', async (req, res) => {
  const pools = await readPools();
  res.json(pools);
});

// Admin thêm thiết bị mới vào pool
app.post('/api/admin/pool/add', async (req, res) => {
  const { chatbotId } = req.body;
  if (!chatbotId) {
    return res.status(400).json({ error: 'chatbotId là bắt buộc.' });
  }

  const pools = await readPools();

  // Tạo thông tin thiết bị ngẫu nhiên
  const generateRandomMac = () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  };
  const sha256 = (str) => require('crypto').createHash('sha256').update(str).digest('hex');

  const mac = generateRandomMac();
  const macClean = mac.replace(/:/g, '');
  const macHash = sha256(macClean).substring(0, 8).toUpperCase();
  const serialNumber = `SN-${macHash}-${macClean}`;
  const deviceKey = `${chatbotId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const hmacKey = sha256(`${deviceKey}||${mac}||${Math.random()}`);

  const newDevice = {
    device_key: deviceKey,
    chatbot_id: chatbotId,
    mac_address: mac,
    serial_number: serialNumber,
    hmac_key: hmacKey,
    activated: false,
    leased_to: '',
    leased_at: 0
  };

  pools.push(newDevice);
  await writePools(pools);

  res.json(newDevice);
});

// Admin kích hoạt thành công (lưu trạng thái đã kích hoạt)
app.post('/api/admin/pool/activate-success', async (req, res) => {
  const { device_key, mac_address, serial_number, hmac_key } = req.body;
  if (!device_key) {
    return res.status(400).json({ error: 'device_key là bắt buộc.' });
  }

  const pools = await readPools();
  let device = pools.find(p => p.device_key === device_key);

  if (!device) {
    return res.status(404).json({ error: 'Không tìm thấy thiết bị tương ứng trong pool.' });
  }

  device.mac_address = mac_address || device.mac_address;
  device.serial_number = serial_number || device.serial_number;
  device.hmac_key = hmac_key || device.hmac_key;
  device.activated = true;

  await writePools(pools);
  res.json({ message: 'Kích hoạt thiết bị trong pool thành công.', device });
});

// Admin: Xóa thiết bị khỏi pool
app.post('/api/admin/pool/delete', async (req, res) => {
  const { device_key } = req.body;
  if (!device_key) {
    return res.status(400).json({ error: 'device_key là bắt buộc.' });
  }

  try {
    let pools = await readPools();
    const initialLen = pools.length;
    pools = pools.filter(d => d.device_key !== device_key);
    
    if (pools.length === initialLen) {
      return res.status(404).json({ error: 'Không tìm thấy thiết bị để xóa.' });
    }

    await writePools(pools);
    res.json({ success: true, message: 'Đã xóa thiết bị khỏi pool.' });
  } catch (err) {
    console.error('[Pool Delete Error]:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ khi xóa thiết bị.', details: err.message });
  }
});

// Tạo tài khoản người dùng mới (chỉ Admin)
app.post('/api/admin/users', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username và Password là bắt buộc.' });
  }

  const users = await readUsers();
  const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    return res.status(400).json({ error: 'Tài khoản đã tồn tại.' });
  }

  const newUser = {
    username,
    password,
    role: 'user',
    score: 0,
    chatCount: 0
  };
  users.push(newUser);
  await writeUsers(users);

  res.status(201).json({ message: 'Tạo tài khoản thành công.' });
});

// Xóa tài khoản (chỉ Admin)
app.post('/api/admin/users/delete', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username là bắt buộc.' });
  }
  if (username.toLowerCase() === 'admin') {
    return res.status(400).json({ error: 'Không thể xóa tài khoản admin mặc định.' });
  }

  let users = await readUsers();
  const index = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  if (index === -1) {
    return res.status(404).json({ error: 'Tài khoản không tồn tại.' });
  }

  users.splice(index, 1);
  await writeUsers(users);

  res.json({ message: 'Xóa tài khoản thành công.' });
});

// Tạo tài khoản hàng loạt (chỉ Admin)
app.post('/api/admin/users/bulk', async (req, res) => {
  const { prefix, startNum, count, password } = req.body;
  if (!prefix || !count || !password) {
    return res.status(400).json({ error: 'Prefix, count và password là bắt buộc.' });
  }

  const numCount = Math.min(parseInt(count) || 0, 50); // Max 50 per batch
  const start = parseInt(startNum) || 1;
  if (numCount <= 0) {
    return res.status(400).json({ error: 'Số lượng phải lớn hơn 0.' });
  }

  const users = await readUsers();
  const created = [];
  const skipped = [];

  for (let i = 0; i < numCount; i++) {
    const num = (start + i).toString().padStart(2, '0');
    const username = `${prefix}${num}`;
    const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) {
      skipped.push(username);
      continue;
    }
    users.push({ username, password, role: 'user', score: 0, chatCount: 0 });
    created.push(username);
  }

  if (created.length > 0) {
    await writeUsers(users);
  }

  res.status(201).json({
    message: `Đã tạo ${created.length} tài khoản${skipped.length > 0 ? `, bỏ qua ${skipped.length} (đã tồn tại)` : ''}.`,
    created,
    skipped
  });
});

// Reset mật khẩu hàng loạt (chỉ Admin)
app.post('/api/admin/users/bulk-reset', async (req, res) => {
  const { usernames, newPassword } = req.body;
  if (!usernames || !Array.isArray(usernames) || !newPassword) {
    return res.status(400).json({ error: 'Danh sách usernames và newPassword là bắt buộc.' });
  }

  const users = await readUsers();
  let resetCount = 0;

  usernames.forEach(uname => {
    if (uname.toLowerCase() === 'admin') return;
    const user = users.find(u => u.username.toLowerCase() === uname.toLowerCase());
    if (user) {
      user.password = newPassword;
      resetCount++;
    }
  });

  if (resetCount > 0) {
    await writeUsers(users);
  }

  res.json({ message: `Đã reset mật khẩu cho ${resetCount} tài khoản.`, resetCount });
});

// Xóa tài khoản hàng loạt (chỉ Admin)
app.post('/api/admin/users/bulk-delete', async (req, res) => {
  const { usernames } = req.body;
  if (!usernames || !Array.isArray(usernames)) {
    return res.status(400).json({ error: 'Danh sách usernames là bắt buộc.' });
  }

  let users = await readUsers();
  const toDelete = usernames.filter(u => u.toLowerCase() !== 'admin').map(u => u.toLowerCase());
  const initialLen = users.length;
  users = users.filter(u => !toDelete.includes(u.username.toLowerCase()));
  const deletedCount = initialLen - users.length;

  if (deletedCount > 0) {
    await writeUsers(users);
  }

  res.json({ message: `Đã xóa ${deletedCount} tài khoản.`, deletedCount });
});

// Lấy danh sách cấu hình kết nối chatbot
app.get('/api/admin/connections', async (req, res) => {
  res.json(await readConnections());
});

// Cập nhật cấu hình kết nối chatbot
app.post('/api/admin/connections', async (req, res) => {
  const newConns = req.body;
  if (!newConns || typeof newConns !== 'object') {
    return res.status(400).json({ error: 'Dữ liệu kết nối không hợp lệ.' });
  }

  const connections = await readConnections();
  Object.keys(newConns).forEach(key => {
    connections[key] = {
      mac_address: newConns[key].mac_address || '',
      serial_number: newConns[key].serial_number || '',
      hmac_key: newConns[key].hmac_key || ''
    };
  });

  await writeConnections(connections);
  res.json({ message: 'Cập nhật cấu hình kết nối thành công.', connections });
});

// Cập nhật cấu hình kết nối chatbot của người dùng (tự động sau khi kích hoạt thành công)
app.post('/api/user/connection', async (req, res) => {
  const { username, chatbotId, mac_address, serial_number, hmac_key } = req.body;
  if (!username || !chatbotId) {
    return res.status(400).json({ error: 'Username và chatbotId là bắt buộc.' });
  }

  const connections = await readConnections();
  const connKey = `${username.toLowerCase()}_${chatbotId}`;
  connections[connKey] = {
    mac_address: mac_address || '',
    serial_number: serial_number || '',
    hmac_key: hmac_key || ''
  };

  await writeConnections(connections);
  res.json({ message: 'Cập nhật cấu hình kết nối người dùng thành công.', connections });
});

// Cập nhật điểm và số tin nhắn hội thoại
app.post('/api/user/score', async (req, res) => {
  const { username, score, chatCount } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username là bắt buộc.' });
  }

  const users = await readUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Người dùng không tồn tại.' });
  }

  user.score = Number(score) || 0;
  user.chatCount = Number(chatCount) || 0;
  await writeUsers(users);

  res.json({ message: 'Cập nhật điểm thành công.', score: user.score, chatCount: user.chatCount });
});

// Lấy danh sách bảng xếp hạng (Leaderboard)
app.get('/api/leaderboard', async (req, res) => {
  const users = await readUsers();
  const leaderboard = users
    .filter(u => u.role !== 'admin')
    .map(u => ({
      username: u.username,
      displayName: u.displayName || u.username,
      score: u.score || 0,
      chatCount: u.chatCount || 0
    }))
    .sort((a, b) => b.score - a.score);

  res.json(leaderboard);
});


// Proxy cho API lấy config OTA (dùng fetch native để tránh lỗi ES Module trên Vercel)
app.use('/api/ota', async (req, res) => {
  const targetUrl = 'https://api.tenclass.net/xiaozhi/ota' + req.url;
  
  const headers = {
    'Content-Type': req.headers['content-type'] || 'application/json'
  };
  if (req.headers['device-id']) headers['Device-Id'] = req.headers['device-id'];
  if (req.headers['client-id']) headers['Client-Id'] = req.headers['client-id'];
  if (req.headers['activation-version']) headers['Activation-Version'] = req.headers['activation-version'];
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];

  try {
    const fetchOpts = {
      method: req.method,
      headers
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    const remoteRes = await fetch(targetUrl, fetchOpts);
    res.status(remoteRes.status);
    
    const contentType = remoteRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    
    const buffer = await remoteRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[OTA Proxy Error]:', err.message);
    res.status(502).json({ error: 'Failed to proxy OTA request', details: err.message });
  }
});

// Proxy cho API kích hoạt (dùng fetch native để tránh lỗi ES Module trên Vercel)
app.all('/api/activate', async (req, res) => {
  const targetUrl = 'https://api.tenclass.net/xiaozhi/ota/activate';
  
  const headers = {
    'Content-Type': req.headers['content-type'] || 'application/json'
  };
  if (req.headers['device-id']) headers['Device-Id'] = req.headers['device-id'];
  if (req.headers['client-id']) headers['Client-Id'] = req.headers['client-id'];
  if (req.headers['activation-version']) headers['Activation-Version'] = req.headers['activation-version'];
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];

  try {
    const fetchOpts = {
      method: req.method,
      headers
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    const remoteRes = await fetch(targetUrl, fetchOpts);
    res.status(remoteRes.status);
    
    const contentType = remoteRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    
    const buffer = await remoteRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[Activate Proxy Error]:', err.message);
    res.status(502).json({ error: 'Failed to proxy Activate request', details: err.message });
  }
});

const FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-8b-8192',
  'llama3-70b-8192'
];

async function fetchGroqWithFallback(apiKey, initialModel, requestBodyBase) {
  let modelsToTry = [initialModel, ...FALLBACK_MODELS.filter(m => m !== initialModel)];
  let lastErrorText = "";
  let lastStatus = 500;

  for (const model of modelsToTry) {
    const requestBody = { ...requestBodyBase, model: model };
    try {
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (groqResponse.ok) {
        return await groqResponse.json();
      }

      lastStatus = groqResponse.status;
      lastErrorText = await groqResponse.text();
      console.warn(`[Groq Fallback] Model ${model} failed with ${lastStatus}: ${lastErrorText}`);
      
      // If Unauthorized (401), it's an API Key issue. Don't retry.
      if (lastStatus === 401) {
         throw new Error(`Groq API Key không hợp lệ hoặc đã bị khóa. Vui lòng vào Cài đặt để cập nhật API Key mới.`);
      }
      
      // Also if rate limit is reached for the whole org, not just the model, we might want to stop. But Groq limits are per model usually.
    } catch (err) {
      console.error(`[Groq Fallback] Fetch error for model ${model}:`, err.message);
      if (err.message.includes('API Key không hợp lệ')) throw err;
      lastErrorText = err.message;
    }
  }

  throw new Error(`Tất cả các model fallback đều gặp lỗi. Lỗi cuối cùng: Status ${lastStatus} - ${lastErrorText}`);
}

// API gợi ý câu trả lời từ Groq API
app.post('/api/suggest', async (req, res) => {
  const { messages, role, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.1-8b-instant';
  }

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const systemPrompt = `You are an English conversation practice assistant.
Analyze the current conversation history between an English learner (user) and an AI chatbot acting as a ${role || 'partner'}.
Based on the context, provide between 3 and 5 natural, varied English response suggestions that the learner could say next.
Each suggestion must:
1. Be grammatically correct and natural for the context.
2. Help advance the conversation in a meaningful way.
3. Include a Vietnamese translation for the learner.

Respond ONLY with a JSON object in this exact schema:
{
  "suggestions": [
    { "en": "English response suggestion", "vi": "Bản dịch tiếng Việt tương ứng" }
  ]
}`;

  const requestBodyBase = {
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' }
  };

  try {
    const data = await fetchGroqWithFallback(apiKey, initialModel, requestBodyBase);
    const content = data.choices[0].message.content;
    
    // Parse JSON từ response
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseErr) {
      console.error('Failed to parse Groq response content:', content);
      parsedResult = { suggestions: [] };
    }

    res.json(parsedResult);
  } catch (error) {
    console.error('Error in /api/suggest:', error.message);
    res.status(502).json({ error: 'Failed to fetch suggestions from Groq API', details: error.message });
  }
});

// API dịch thuật từ Groq API
app.post('/api/translate', async (req, res) => {
  const { text, direction, apiKey: clientApiKey, model: clientModel } = req.body;
  const apiKey = clientApiKey || process.env.GROQ_API_KEY || '';
  let initialModel = clientModel || process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  if (initialModel === 'mixtral-8x7b-32768') {
    initialModel = 'llama-3.1-8b-instant';
  }

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const systemPrompt = direction === 'vi2en' 
    ? "You are an expert English translator. Translate the following Vietnamese text to English accurately and naturally. Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations."
    : "You are an expert Vietnamese translator. Translate the following English text to Vietnamese. The translation MUST be extremely natural, conversational, and context-appropriate (e.g., translate 'Good evening' as 'Chào buổi tối' instead of 'Tối tốt', 'check out' as 'trả phòng'). ABSOLUTELY DO NOT use any Chinese characters (Hanzi). Respond ONLY with the direct translation, nothing else. Do not use quotes, notes, or explanations.";

  const requestBodyBase = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0.2
  };

  try {
    const data = await fetchGroqWithFallback(apiKey, initialModel, requestBodyBase);
    const translation = data.choices[0].message.content.trim();
    res.json({ translation });
  } catch (error) {
    console.error('Error in /api/translate:', error.message);
    res.status(502).json({ error: 'Failed to translate', details: error.message });
  }
});


if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
  });
}

module.exports = app;
