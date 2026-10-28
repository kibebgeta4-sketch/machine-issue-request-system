// Load hidden configuration variables from the .env file into process.env
require('dotenv').config();

// Import Node.js built-in module for handling file and directory paths
const path = require('path');
// Import Node.js built-in module for file system operations
// Import Express framework to handle server routes and HTTP requests
const express = require('express');
// Import Express session middleware to manage user login states via cookies
const session = require('express-session');
// Import Bcryptjs library for securely hashing and comparing passwords
const bcrypt = require('bcryptjs');
// Import database connection pool and connection test utility from local file
const { pool, testConnection } = require('./database/db');
// Import modular report routes from local file
const reports = require('./routes/reports');
// Import local JSON file containing machine and department data
const machineData = require('./IT/public/machineData.json');

// Create an instance of an Express application
const app = express();
// Set the server port, defaulting to 5000 if not specified in environment variables
const port = Number(process.env.PORT || 5000);
// Set the host address ('0.0.0.0' allows connections from any IP on the local network/LAN)
const host = process.env.HOST || '0.0.0.0';
// Store the root directory path of the project folder
const projectRoot = __dirname;
// Define the list of valid user roles in the system
const roles = ['ADMIN', 'LINE_SUPERVISOR', 'TECHNICIAN_MANAGER', 'TECHNICIAN'];

// Middleware: Allow Express to parse incoming JSON payloads up to 1MB in size
app.use(express.json({ limit: '1mb' }));
// Middleware: Allow Express to parse URL-encoded form data submissions
app.use(express.urlencoded({ extended: true }));
// Middleware: Configure session cookies to remember logged-in users across requests
app.use(session({
  name: 'machine-issue.sid', // The name of the session cookie stored in the browser
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret', // Secret key used to sign the session
  resave: false, // Don't save session if unmodified
  saveUninitialized: false, // Don't create session until something is stored
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 8 * 60 * 60 * 1000 } // Cookie security and 8-hour expiration settings
}));
// Middleware: Serve static frontend files (HTML, CSS, JS, images) from the 'IT/public' folder
app.use(express.static(path.join(projectRoot, 'IT', 'public')));

// Authentication Middleware: Checks if the user has an active session before proceeding
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next(); // Continue to the next middleware or route handler
}

// Role-Based Access Control Middleware: Checks if the logged-in user's role is allowed
function allowRoles(...allowed) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!allowed.includes(req.session.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next(); // Role is permitted, proceed
  };
}

// Async Route Wrapper: Catches asynchronous errors automatically so the server won't crash
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const rawIdentifier = String(req.body.username || req.body.email || '').trim();
  const identifier = rawIdentifier.toLowerCase();
  const password = String(req.body.password || '');

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username or email and password are required.' });
  }

  const [users] = await pool.execute(
    'SELECT id, name, username, email, password_hash, role, department_id FROM users WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)) AND active = TRUE LIMIT 1',
    [identifier, identifier]
  );
  const user = users[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Username or email and password are incorrect.' });
  }

  req.session.user = { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, department_id: user.department_id };
  res.json({ user: req.session.user });
}));

app.post('/api/auth/logout', (req, res, next) => req.session.destroy((error) => {
  if (error) return next(error);
  res.clearCookie('machine-issue.sid');
  res.json({ success: true });
}));
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.session.user }));

app.get('/api/departments', requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name FROM departments ORDER BY name');
  res.json(rows);
}));
app.get('/api/machines', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = 'WHERE m.active = TRUE';
  if (req.query.department_id) { where += ' AND m.department_id = ?'; params.push(Number(req.query.department_id)); }
  const [rows] = await pool.execute(`SELECT m.id, m.name, m.machine_code, m.department_id, d.name AS department_name FROM machines m JOIN departments d ON d.id = m.department_id ${where} ORDER BY m.name`, params);
  res.json(rows);
}));
app.get('/api/technicians', allowRoles('ADMIN', 'TECHNICIAN_MANAGER'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute("SELECT id, name, username AS employee_id, department_id, active FROM users WHERE role = 'TECHNICIAN' AND active = TRUE ORDER BY name");
  res.json(rows);
}));

app.post('/api/requests', allowRoles('LINE_SUPERVISOR', 'ADMIN'), asyncRoute(async (req, res) => {
  const departmentId = Number(req.body.department_id);
  const machineId = Number(req.body.machine_id);
  const machineCode = String(req.body.machine_code || '').trim();
  const operatorName = String(req.body.operator_name || '').trim();
  const category = String(req.body.breakdown_category || '').toUpperCase();
  const details = String(req.body.breakdown_details || '').trim();
  const stopped = req.body.is_production_stopped === true || req.body.is_production_stopped === 'true';
  if (!departmentId || !machineId || !machineCode || !operatorName || !details || !['MECHANICAL', 'ELECTRICAL', 'OTHER'].includes(category)) {
    return res.status(400).json({ error: 'Complete all required request fields.' });
  }
  const [machineRows] = await pool.execute('SELECT id FROM machines WHERE id = ? AND department_id = ? AND machine_code = ? AND active = TRUE', [machineId, departmentId, machineCode]);
  if (!machineRows.length) return res.status(400).json({ error: 'Choose a machine belonging to the selected department.' });
  const [result] = await pool.execute(
    'INSERT INTO maintenance_requests (department_id, machine_id, operator_name, is_production_stopped, breakdown_category, breakdown_details, requested_by_foreman, request_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), \'PENDING\')',
    [departmentId, machineId, operatorName, stopped, category, details, req.session.user.id]
  );
  res.status(201).json({ id: result.insertId, status: 'PENDING' });
}));

app.get('/api/requests', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  const clauses = [];
  const user = req.session.user;
  if (user.role === 'LINE_SUPERVISOR') { clauses.push('r.requested_by_foreman = ?'); params.push(user.id); }
  if (user.role === 'TECHNICIAN') { clauses.push('r.assigned_technician_id = ?'); params.push(user.id); }
  if (req.query.status) { clauses.push('r.status = ?'); params.push(String(req.query.status).toUpperCase()); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.execute(`SELECT r.id, r.department_id, d.name AS department_name, r.machine_id, m.name AS machine_name, m.machine_code, r.operator_name, r.is_production_stopped, r.breakdown_category, r.breakdown_details, r.request_time, r.received_time, r.repair_start_time, r.repair_end_time, r.repair_duration_minutes, r.root_cause_fixed, r.assignment_explanation, r.status, r.tasks_performed, r.resolution_details, dispatch.sent_at AS dispatch_sent_at, dispatch.acknowledged_at AS dispatch_acknowledged_at, u.name AS technician_name, u.specialization AS technician_specialization FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id LEFT JOIN users u ON u.id = r.assigned_technician_id LEFT JOIN technician_dispatches dispatch ON dispatch.request_id = r.id ${where} ORDER BY r.request_time DESC LIMIT 500`, params);
  res.json(rows);
}));

app.get('/api/technician/dispatches', allowRoles('TECHNICIAN'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(`SELECT dispatch.id AS dispatch_id, dispatch.request_id, dispatch.assignment_explanation, dispatch.sent_at, dispatch.acknowledged_at, manager.name AS assigned_by_name, d.name AS department_name, m.name AS machine_name, m.machine_code, r.operator_name, r.breakdown_category AS issue_type, r.breakdown_details AS reported_issue, r.is_production_stopped, r.request_time, r.status, CONCAT('/manager?request=', r.id, '&action=acknowledge') AS action_url FROM technician_dispatches dispatch JOIN maintenance_requests r ON r.id = dispatch.request_id JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id LEFT JOIN users manager ON manager.id = dispatch.assigned_by WHERE dispatch.technician_id = ? ORDER BY dispatch.sent_at DESC LIMIT 100`, [req.session.user.id]);
  res.json(rows);
}));

app.patch('/api/requests/:id/accept', allowRoles('TECHNICIAN_MANAGER', 'ADMIN'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const technicianId = Number(req.body.technician_id);
  const assignmentExplanation = String(req.body.assignment_explanation || '').trim().slice(0, 10000);
  if (!requestId || !technicianId) return res.status(400).json({ error: 'A request and technician are required.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [requestRows] = await connection.execute('SELECT breakdown_category, status FROM maintenance_requests WHERE id = ? FOR UPDATE', [requestId]);
    const request = requestRows[0];
    if (!request || request.status !== 'PENDING') { await connection.rollback(); return res.status(409).json({ error: 'Request not found or no longer pending.' }); }
    const [technicians] = await connection.execute("SELECT id FROM users WHERE id = ? AND role = 'TECHNICIAN' AND active = TRUE FOR UPDATE", [technicianId]);
    if (!technicians.length) { await connection.rollback(); return res.status(400).json({ error: 'Choose an active technician.' }); }
    const [updated] = await connection.execute("UPDATE maintenance_requests SET received_by_tech = NULL, received_time = NULL, assigned_technician_id = ?, assignment_explanation = ?, repair_started_by = NULL, repair_start_time = NULL, status = 'ACCEPTED' WHERE id = ? AND status = 'PENDING'", [technicianId, assignmentExplanation || null, requestId]);
    if (!updated.affectedRows) { await connection.rollback(); return res.status(409).json({ error: 'Request not found or no longer pending.' }); }
    await connection.execute('INSERT INTO technician_dispatches (request_id, technician_id, assigned_by, assignment_explanation, sent_at) VALUES (?, ?, ?, ?, NOW())', [requestId, technicianId, req.session.user.id, assignmentExplanation || null]);
    await connection.commit();
    const [dispatchRows] = await pool.execute(`SELECT dispatch.request_id, dispatch.assignment_explanation, dispatch.sent_at, d.name AS department_name, m.name AS machine_name, m.machine_code, r.breakdown_category AS issue_type, r.breakdown_details AS reported_issue, CONCAT('/manager?request=', r.id, '&action=acknowledge') AS action_url FROM technician_dispatches dispatch JOIN maintenance_requests r ON r.id = dispatch.request_id JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id WHERE dispatch.request_id = ?`, [requestId]);
    res.json({ id: requestId, status: 'ACCEPTED', technician_id: technicianId, dispatch: dispatchRows[0] });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.patch('/api/requests/:id/acknowledge', allowRoles('TECHNICIAN'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [requests] = await connection.execute('SELECT id, status FROM maintenance_requests WHERE id = ? AND assigned_technician_id = ? FOR UPDATE', [requestId, req.session.user.id]);
    const request = requests[0];
    if (!request || !['ACCEPTED', 'IN_PROGRESS', 'RESOLVED'].includes(request.status)) {
      await connection.rollback();
      return res.status(404).json({ error: 'No dispatch for this technician was found.' });
    }
    const [updated] = await connection.execute('UPDATE technician_dispatches SET acknowledged_at = COALESCE(acknowledged_at, NOW()) WHERE request_id = ? AND technician_id = ?', [requestId, req.session.user.id]);
    if (!updated.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ error: 'Dispatch notification was not found.' });
    }
    await connection.execute('UPDATE maintenance_requests SET received_by_tech = ?, received_time = COALESCE(received_time, NOW()) WHERE id = ?', [req.session.user.id, requestId]);
    await connection.commit();
    res.json({ request_id: requestId, acknowledged: true, status: request.status, action_url: `/manager?request=${requestId}` });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.patch('/api/requests/:id/start', allowRoles('TECHNICIAN_MANAGER', 'TECHNICIAN', 'ADMIN'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  if (!requestId) return res.status(400).json({ error: 'A request is required.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT assigned_technician_id, status FROM maintenance_requests WHERE id = ? FOR UPDATE', [requestId]);
    const request = rows[0];
    if (!request || request.status !== 'ACCEPTED') {
      await connection.rollback();
      return res.status(409).json({ error: 'Request not found or not awaiting repair.' });
    }
    if (req.session.user.role === 'TECHNICIAN' && Number(request.assigned_technician_id) !== Number(req.session.user.id)) {
      await connection.rollback();
      return res.status(403).json({ error: 'This request is assigned to another technician.' });
    }
    await connection.execute("UPDATE maintenance_requests SET repair_started_by = ?, repair_start_time = NOW(), status = 'IN_PROGRESS' WHERE id = ?", [req.session.user.id, requestId]);
    await connection.commit();
    res.json({ id: requestId, status: 'IN_PROGRESS' });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.patch('/api/requests/:id/resolve', allowRoles('TECHNICIAN_MANAGER', 'TECHNICIAN', 'ADMIN'), asyncRoute(async (req, res) => {
  const requestId = Number(req.params.id);
  const tasks = String(req.body.tasks_performed || '').trim();
  const solution = String(req.body.resolution_details || '').trim();
  const rootCause = String(req.body.root_cause_fixed || '').trim();
  const parts = Array.isArray(req.body.spare_parts_used) ? req.body.spare_parts_used : [];
  if (!requestId || !tasks || !rootCause) return res.status(400).json({ error: 'Describe the work performed and root cause fixed.' });
  if (parts.some((part) => !String(part.part_name || '').trim() || !(Number(part.quantity) > 0))) return res.status(400).json({ error: 'Each spare part needs a name and positive quantity.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [requests] = await connection.execute('SELECT id, repair_start_time, assigned_technician_id, status FROM maintenance_requests WHERE id = ? FOR UPDATE', [requestId]);
    const request = requests[0];
    if (!request || request.status !== 'IN_PROGRESS') { await connection.rollback(); return res.status(409).json({ error: 'Request not found or not in progress.' }); }
    if (req.session.user.role === 'TECHNICIAN' && Number(request.assigned_technician_id) !== Number(req.session.user.id)) { await connection.rollback(); return res.status(403).json({ error: 'This request is assigned to another technician.' }); }
    const endTime = new Date();
    const repairStartTime = request.repair_start_time ? new Date(request.repair_start_time) : endTime;
    const repairDurationMinutes = Math.max(0, Math.round((endTime.getTime() - repairStartTime.getTime()) / 60000));
    await connection.execute("UPDATE maintenance_requests SET repair_completed_by = ?, repair_end_time = NOW(), total_downtime_minutes = TIMESTAMPDIFF(MINUTE, request_time, NOW()), downtime_hours = TIMESTAMPDIFF(MINUTE, request_time, NOW()) / 60, repair_duration_minutes = ?, tasks_performed = ?, root_cause_fixed = ?, resolution_details = ?, status = 'RESOLVED' WHERE id = ?", [req.session.user.id, repairDurationMinutes, tasks, rootCause, solution || null, requestId]);
    for (const part of parts) {
      await connection.execute('INSERT INTO spare_parts_used (request_id, part_name, part_code, quantity, description) VALUES (?, ?, ?, ?, ?)', [requestId, String(part.part_name).trim(), String(part.part_code || '').trim() || null, Number(part.quantity), String(part.description || '').trim() || null]);
    }
    const [resolvedRows] = await connection.execute('SELECT repair_end_time, total_downtime_minutes, downtime_hours FROM maintenance_requests WHERE id = ?', [requestId]);
    const resolved = resolvedRows[0];
    await connection.commit();
    res.json({ id: requestId, status: 'RESOLVED', resolved_time: resolved.repair_end_time, total_downtime_minutes: resolved.total_downtime_minutes, downtime_hours: resolved.downtime_hours, repair_duration_minutes: repairDurationMinutes });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.use('/api/reports', allowRoles('ADMIN', 'TECHNICIAN_MANAGER'), reports(pool, asyncRoute));

app.get('/api/admin/users', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, username, email, role, specialization, department_id, active, created_at FROM users ORDER BY name');
  res.json(rows);
}));
app.patch('/api/admin/users/:id', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  const specialization = req.body.specialization ? String(req.body.specialization).toUpperCase() : null;
  const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
  const validSpecializations = ['MECHANICAL', 'ELECTRICAL', 'UTILITY_IT'];
  if (!userId || !name || name.length > 160 || !/^[a-z0-9._-]{3,80}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || (password && password.length < 10) || !roles.includes(role) || (role === 'TECHNICIAN' && !validSpecializations.includes(specialization)) || (req.body.department_id && (!Number.isInteger(departmentId) || departmentId < 1))) {
    return res.status(400).json({ error: 'Enter a valid name, username, email, role, and department. Technician accounts also need a valid specialization; passwords must be at least 10 characters when provided.' });
  }
  const [existingUsers] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!existingUsers.length) return res.status(404).json({ error: 'User account not found.' });
  const currentUser = existingUsers[0];
  if (currentUser.id === req.session.user.id && role !== 'ADMIN') {
    return res.status(400).json({ error: 'You cannot change your own administrator role.' });
  }
  if (currentUser.role === 'ADMIN' && role !== 'ADMIN') {
    const [admins] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = TRUE AND id <> ?", [userId]);
    if (!Number(admins[0].count)) return res.status(400).json({ error: 'At least one other active administrator must remain.' });
  }
  if (departmentId) {
    const [departments] = await pool.execute('SELECT id FROM departments WHERE id = ?', [departmentId]);
    if (!departments.length) return res.status(400).json({ error: 'Choose a valid department.' });
  }
  const [duplicates] = await pool.execute('SELECT id, username, email FROM users WHERE id <> ? AND (username = ? OR email = ?)', [userId, username, email]);
  if (duplicates.some((user) => user.username.toLowerCase() === username)) return res.status(409).json({ error: 'That username is already in use. Choose another username.' });
  if (duplicates.some((user) => user.email.toLowerCase() === email)) return res.status(409).json({ error: 'That email is already in use. Use another email address.' });

  const values = [name, username, email, role, role === 'TECHNICIAN' ? specialization : null, departmentId];
  let update = 'UPDATE users SET name = ?, username = ?, email = ?, role = ?, specialization = ?, department_id = ?';
  if (password) {
    update += ', password_hash = ?';
    values.push(await bcrypt.hash(password, 12));
  }
  update += ' WHERE id = ?';
  values.push(userId);
  await pool.execute(update, values);
  res.json({ id: userId, name, username, email, role, specialization: role === 'TECHNICIAN' ? specialization : null, department_id: departmentId });
}));
app.patch('/api/admin/users/:id/active', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId || typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Choose whether the account should be active.' });
  const [users] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!users.length) return res.status(404).json({ error: 'User account not found.' });
  if (!req.body.active && users[0].id === req.session.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  if (!req.body.active && users[0].role === 'ADMIN') {
    const [admins] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = TRUE AND id <> ?", [userId]);
    if (!Number(admins[0].count)) return res.status(400).json({ error: 'At least one other active administrator must remain.' });
  }
  await pool.execute('UPDATE users SET active = ? WHERE id = ?', [req.body.active, userId]);
  res.json({ id: userId, active: req.body.active });
}));
app.patch('/api/admin/users/:id/specialization', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const userId = Number(req.params.id);
  const specialization = String(req.body.specialization || '').toUpperCase();
  if (!userId || !['MECHANICAL', 'ELECTRICAL', 'UTILITY_IT'].includes(specialization)) return res.status(400).json({ error: 'Choose a valid technician specialization.' });
  const [result] = await pool.execute("UPDATE users SET specialization = ? WHERE id = ? AND role = 'TECHNICIAN'", [specialization, userId]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Technician account not found.' });
  res.json({ id: userId, specialization });
}));
app.post('/api/admin/users', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  const specialization = req.body.specialization ? String(req.body.specialization).toUpperCase() : null;
  const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
  const validSpecializations = ['MECHANICAL', 'ELECTRICAL', 'UTILITY_IT'];
  if (!name || !/^[a-z0-9._-]{3,80}$/.test(username) || !email || password.length < 10 || !roles.includes(role) || (role === 'TECHNICIAN' && !validSpecializations.includes(specialization))) return res.status(400).json({ error: 'Name, valid username, email, role, and password of at least 10 characters are required. Technicians also need a valid specialization.' });
  const [duplicates] = await pool.execute('SELECT username, email FROM users WHERE username = ? OR email = ?', [username, email]);
  const usernameExists = duplicates.some((user) => user.username.toLowerCase() === username);
  const emailExists = duplicates.some((user) => user.email.toLowerCase() === email);
  if (usernameExists && emailExists) return res.status(409).json({ error: 'That username and email are already in use.' });
  if (usernameExists) return res.status(409).json({ error: 'That username is already in use. Choose another username.' });
  if (emailExists) return res.status(409).json({ error: 'That email is already in use. Use another email address.' });
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.execute('INSERT INTO users (name, username, email, password_hash, role, specialization, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, username, email, hash, role, role === 'TECHNICIAN' ? specialization : null, departmentId]);
  res.status(201).json({ id: result.insertId, username });
}));
app.delete('/api/admin/report-history', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const machineId = Number(req.body.machine_id);
  const machineCode = String(req.body.machine_code || '').trim();
  const from = String(req.body.from || '');
  const to = String(req.body.to || '');
  const isDateOnly = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!Number.isSafeInteger(machineId) || machineId < 1 || !machineCode || machineCode.length > 80 || !isDateOnly(from) || !isDateOnly(to) || from > to) {
    return res.status(400).json({ error: 'Select a valid machine and machine code, and provide a valid date range.' });
  }
  const [machines] = await pool.execute('SELECT id FROM machines WHERE id = ? AND machine_code = ?', [machineId, machineCode]);
  if (!machines.length) return res.status(400).json({ error: 'The selected machine code does not match the machine.' });
  const [result] = await pool.execute(
    'DELETE r FROM maintenance_requests r WHERE r.machine_id = ? AND r.request_time >= ? AND r.request_time < DATE_ADD(?, INTERVAL 1 DAY)',
    [machineId, from, to]
  );
  res.json({ deleted: result.affectedRows });
}));
app.get('/api/admin/machines', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT m.id, m.name, m.machine_code, m.department_id, d.name AS department_name, m.active FROM machines m JOIN departments d ON d.id = m.department_id ORDER BY d.name, m.name');
  res.json(rows);
}));
app.post('/api/admin/machines', allowRoles('ADMIN'), asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const code = String(req.body.machine_code || '').trim();
  const departmentId = Number(req.body.department_id);
  if (!name || !code || !departmentId) return res.status(400).json({ error: 'Machine name, code, and department are required.' });
  const [result] = await pool.execute('INSERT INTO machines (name, machine_code, department_id) VALUES (?, ?, ?)', [name, code, departmentId]);
  res.status(201).json({ id: result.insertId });
}));

const viewRoutes = {
  '/': 'login.html',
  '/supervisor': 'supervisor_dashboard.html',
  '/manager': 'manager_dashboard.html',
  '/reports': 'reports_dashboard.html',
  '/admin': 'admin_dashboard.html'
};
for (const [route, file] of Object.entries(viewRoutes)) {
  app.get(route, (req, res) => res.sendFile(path.join(projectRoot, 'IT', 'views', file)));
}
app.use('/views', express.static(path.join(projectRoot, 'IT', 'views')));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A record with that unique value already exists.' });
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function start() {
  try {
    await testConnection();
    await ensureUsernameColumn();
    await ensureWorkflowColumns();
    await seedMachines();
    await ensureDefaultAdmin();

    app.listen(port, host, () => {
      console.log(`Machine Issue Request System listening on http://${host}:${port}. On the LAN, open http://172.16.1.85:${port}`);
    });
  } catch (error) {
    console.error('Unable to initialize the application database:', error.message);
    process.exitCode = 1;
  }
}

async function ensureWorkflowColumns() {
  const additions = [
    ['users', 'specialization', "ALTER TABLE users ADD COLUMN specialization ENUM('MECHANICAL', 'ELECTRICAL', 'UTILITY_IT') NULL AFTER role"],
    ['maintenance_requests', 'root_cause_fixed', 'ALTER TABLE maintenance_requests ADD COLUMN root_cause_fixed TEXT NULL AFTER resolution_details'],
    ['maintenance_requests', 'repair_duration_minutes', 'ALTER TABLE maintenance_requests ADD COLUMN repair_duration_minutes INT UNSIGNED NULL AFTER root_cause_fixed'],
    ['maintenance_requests', 'assignment_explanation', 'ALTER TABLE maintenance_requests ADD COLUMN assignment_explanation TEXT NULL AFTER assigned_technician_id']
  ];
  for (const [tableName, columnName, alterSql] of additions) {
    const [columns] = await pool.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tableName, columnName]);
    if (!columns.length) await pool.execute(alterSql);
  }
  await pool.execute(`CREATE TABLE IF NOT EXISTS technician_dispatches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NOT NULL,
    technician_id INT UNSIGNED NOT NULL,
    assigned_by INT UNSIGNED NULL,
    assignment_explanation TEXT NULL,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME NULL,
    CONSTRAINT fk_dispatch_request FOREIGN KEY (request_id) REFERENCES maintenance_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_dispatch_technician FOREIGN KEY (technician_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_dispatch_manager FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_dispatch_request (request_id),
    INDEX idx_dispatch_technician_ack (technician_id, acknowledged_at)
  ) ENGINE=InnoDB`);
}

async function seedMachines() {
  for (const [departmentName, machineGroups] of Object.entries(machineData)) {
    const [departmentResult] = await pool.execute(
      'INSERT INTO departments (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
      [departmentName]
    );
    const departmentId = departmentResult.insertId;
    for (const [machineName, codes] of Object.entries(machineGroups)) {
      for (const machineCode of codes) {
        await pool.execute(
          'INSERT INTO machines (name, machine_code, department_id, active) VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE name = VALUES(name), department_id = VALUES(department_id), active = TRUE',
          [machineName, machineCode, departmentId]
        );
      }
    }
  }
  await pool.execute(
    'INSERT INTO departments (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
    ['Technician Department']
  );
}

async function ensureUsernameColumn() {
  const [columns] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username'");
  if (!columns.length) await pool.execute('ALTER TABLE users ADD COLUMN username VARCHAR(80) NULL AFTER name');
  await pool.execute("UPDATE users SET username = CONCAT('user', id) WHERE username IS NULL OR username = ''");
  const [indexes] = await pool.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username' AND NON_UNIQUE = 0");
  if (!indexes.length) await pool.execute('ALTER TABLE users ADD UNIQUE INDEX uq_users_username (username)');
  await pool.execute('ALTER TABLE users MODIFY username VARCHAR(80) NOT NULL');
}

async function ensureDefaultAdmin() {
  const [existing] = await pool.execute('SELECT id, name, email, password_hash, role FROM users WHERE username = ? LIMIT 1', ['admin']);
  if (existing.length) {
    const account = existing[0];
    if (account.role !== 'ADMIN') throw new Error('The reserved username "admin" is already assigned to a non-admin account.');
    const defaultPasswordMatches = await bcrypt.compare('admin123', account.password_hash);
    if (!defaultPasswordMatches && (account.email === 'admin@machine.local' || !account.email)) {
      const passwordHash = await bcrypt.hash('admin123', 12);
      await pool.execute('UPDATE users SET email = ?, password_hash = ? WHERE id = ?', ['admin@machine.local', passwordHash, account.id]);
      console.log('Reset default administrator password to the temporary development credential.');
    }
    return;
  }
  const passwordHash = await bcrypt.hash('admin123', 12);
  await pool.execute('INSERT INTO users (name, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', ['System Administrator', 'admin', 'admin@machine.local', passwordHash, 'ADMIN']);
  console.log('Created default administrator account: username admin (change password before deployment).');
}

if (require.main === module) start();
module.exports = app;