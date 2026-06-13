/**
 * Google Apps Script Web App Database
 * Copy this code and deploy it as a Web App in Google Sheets.
 * Ensure you share it as "Anyone" and configure the URL in your environment.
 */

function doPost(e) {
  var response = { error: "Unknown error" };
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var payload = data.payload;
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === 'readUsers') {
      response = readUsers(doc);
    } else if (action === 'writeUsers') {
      response = writeUsers(doc, payload);
    } else if (action === 'readConnections') {
      response = readConnections(doc);
    } else if (action === 'writeConnections') {
      response = writeConnections(doc, payload);
    } else if (action === 'readDevices') {
      response = readDevices(doc);
    } else if (action === 'writeDevices') {
      response = writeDevices(doc, payload);
    } else if (action === 'readPools') {
      response = readPools(doc);
    } else if (action === 'writePools') {
      response = writePools(doc, payload);
    } else {
      response = { error: "Unknown action: " + action };
    }
  } catch (err) {
    response = { error: err.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── USER SHEETS OPERATIONS ───

function readUsers(doc) {
  var sheet = doc.getSheetByName('users');
  if (!sheet) {
    sheet = doc.insertSheet('users');
    sheet.appendRow(['Username', 'Password', 'Role', 'Score', 'ChatCount']);
    sheet.appendRow(['admin', 'admin123', 'admin', 0, 0]);
  }
  var data = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    users.push({
      username: row[0].toString(),
      password: row[1] ? row[1].toString() : '',
      role: row[2] ? row[2].toString() : 'user',
      score: Number(row[3]) || 0,
      chatCount: Number(row[4]) || 0
    });
  }
  return users;
}

function writeUsers(doc, users) {
  var sheet = doc.getSheetByName('users');
  if (!sheet) {
    sheet = doc.insertSheet('users');
  }
  sheet.clear();
  var rows = [['Username', 'Password', 'Role', 'Score', 'ChatCount']];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    rows.push([
      u.username,
      u.password || '',
      u.role || 'user',
      u.score || 0,
      u.chatCount || 0
    ]);
  }
  sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  return { success: true };
}

// ─── CONNECTION SHEETS OPERATIONS (LEGACY) ───

function readConnections(doc) {
  var sheet = doc.getSheetByName('connections');
  if (!sheet) {
    sheet = doc.insertSheet('connections');
    sheet.appendRow(['ConnKey', 'MacAddress', 'SerialNumber', 'HmacKey']);
  }
  var data = sheet.getDataRange().getValues();
  var conns = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var key = row[0].toString();
    conns[key] = {
      mac_address: row[1] ? row[1].toString() : '',
      serial_number: row[2] ? row[2].toString() : '',
      hmac_key: row[3] ? row[3].toString() : ''
    };
  }
  return conns;
}

function writeConnections(doc, conns) {
  var sheet = doc.getSheetByName('connections');
  if (!sheet) {
    sheet = doc.insertSheet('connections');
  }
  sheet.clear();
  var rows = [['ConnKey', 'MacAddress', 'SerialNumber', 'HmacKey']];
  var keys = Object.keys(conns);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var c = conns[key];
    rows.push([
      key,
      c.mac_address || '',
      c.serial_number || '',
      c.hmac_key || ''
    ]);
  }
  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  return { success: true };
}

// ─── SHARED DEVICE SHEETS OPERATIONS ───

function readDevices(doc) {
  var sheet = doc.getSheetByName('devices');
  if (!sheet) {
    sheet = doc.insertSheet('devices');
    sheet.appendRow(['ChatbotId', 'DeviceCode', 'MacAddress', 'SerialNumber', 'HmacKey', 'Activated']);
    // Seed default 4 chatbots
    sheet.appendRow(['teacher', '', '', '', '', false]);
    sheet.appendRow(['receptionist', '', '', '', '', false]);
    sheet.appendRow(['airport', '', '', '', '', false]);
    sheet.appendRow(['shopping', '', '', '', '', false]);
  }
  var data = sheet.getDataRange().getValues();
  var devices = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var botId = row[0].toString();
    devices[botId] = {
      device_code: row[1] ? row[1].toString() : '',
      mac_address: row[2] ? row[2].toString() : '',
      serial_number: row[3] ? row[3].toString() : '',
      hmac_key: row[4] ? row[4].toString() : '',
      activated: row[5] === true || row[5].toString() === 'true'
    };
  }
  return devices;
}

function writeDevices(doc, devices) {
  var sheet = doc.getSheetByName('devices');
  if (!sheet) {
    sheet = doc.insertSheet('devices');
  }
  sheet.clear();
  var rows = [['ChatbotId', 'DeviceCode', 'MacAddress', 'SerialNumber', 'HmacKey', 'Activated']];
  var keys = Object.keys(devices);
  for (var i = 0; i < keys.length; i++) {
    var botId = keys[i];
    var d = devices[botId];
    rows.push([
      botId,
      d.device_code || '',
      d.mac_address || '',
      d.serial_number || '',
      d.hmac_key || '',
      d.activated || false
    ]);
  }
  sheet.getRange(1, 1, rows.length, 6).setValues(rows);
  return { success: true };
}

// ─── DEVICE POOLS SHEETS OPERATIONS ───

function readPools(doc) {
  var sheet = doc.getSheetByName('pools');
  if (!sheet) {
    sheet = doc.insertSheet('pools');
    sheet.appendRow(['DeviceKey', 'ChatbotId', 'MacAddress', 'SerialNumber', 'HmacKey', 'Activated', 'LeasedTo', 'LeasedAt']);
  }
  var data = sheet.getDataRange().getValues();
  var pools = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    pools.push({
      device_key: row[0].toString(),
      chatbot_id: row[1] ? row[1].toString() : '',
      mac_address: row[2] ? row[2].toString() : '',
      serial_number: row[3] ? row[3].toString() : '',
      hmac_key: row[4] ? row[4].toString() : '',
      activated: row[5] === true || row[5].toString() === 'true',
      leased_to: row[6] ? row[6].toString() : '',
      leased_at: Number(row[7]) || 0
    });
  }
  return pools;
}

function writePools(doc, pools) {
  var sheet = doc.getSheetByName('pools');
  if (!sheet) {
    sheet = doc.insertSheet('pools');
  }
  sheet.clear();
  var rows = [['DeviceKey', 'ChatbotId', 'MacAddress', 'SerialNumber', 'HmacKey', 'Activated', 'LeasedTo', 'LeasedAt']];
  for (var i = 0; i < pools.length; i++) {
    var p = pools[i];
    rows.push([
      p.device_key,
      p.chatbot_id || '',
      p.mac_address || '',
      p.serial_number || '',
      p.hmac_key || '',
      p.activated || false,
      p.leased_to || '',
      p.leased_at || 0
    ]);
  }
  sheet.getRange(1, 1, rows.length, 8).setValues(rows);
  return { success: true };
}
