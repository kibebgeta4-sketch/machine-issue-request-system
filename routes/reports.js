const PDFDocument = require('pdfkit');

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function addDowntimeHours(rows) {
  for (const row of rows) {
    row.total_downtime_minutes = Number(row.total_downtime_minutes || 0);
    row.total_downtime_hours = Number((row.total_downtime_minutes / 60).toFixed(2));
  }
  return rows;
}

function filters(query) {
  const clauses = [];
  const values = [];
  if (query.from) { clauses.push('DATE(r.request_time) >= ?'); values.push(query.from); }
  if (query.to) { clauses.push('DATE(r.request_time) <= ?'); values.push(query.to); }
  if (query.department_id) { clauses.push('r.department_id = ?'); values.push(Number(query.department_id)); }
  if (query.machine_id) { clauses.push('r.machine_id = ?'); values.push(Number(query.machine_id)); }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

module.exports = (pool, asyncRoute) => {
  const router = require('express').Router();
  const filterParams = (req) => filters(req.query);

  router.get('/downtime', asyncRoute(async (req, res) => {
    const { sql, values } = filterParams(req);
    const [resultRows] = await pool.execute(`SELECT r.breakdown_category, DATE(r.request_time) AS report_date, d.id AS department_id, d.name AS department, m.id AS machine_id, m.name AS machine, m.machine_code, COUNT(*) AS issue_count, SUM(CASE WHEN r.status = 'RESOLVED' AND r.repair_end_time IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, r.request_time, r.repair_end_time) ELSE 0 END) AS total_downtime_minutes FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id ${sql} GROUP BY r.breakdown_category, DATE(r.request_time), d.id, d.name, m.id, m.name, m.machine_code ORDER BY report_date, department, machine, machine_code`, values);
    const rows = addDowntimeHours(resultRows);
    const hoursByCategory = rows.reduce((totals, row) => {
      totals[row.breakdown_category] = (totals[row.breakdown_category] || 0) + Number(row.total_downtime_hours || 0);
      return totals;
    }, {});
    for (const row of rows) {
      const categoryTotal = hoursByCategory[row.breakdown_category] || 0;
      row.category_downtime_percentage = categoryTotal ? Number(((Number(row.total_downtime_hours || 0) / categoryTotal) * 100).toFixed(2)) : 0;
    }
    const affectedMachines = new Set(rows.map((row) => row.machine_id)).size;
    const totalDowntimeMinutes = rows.reduce((sum, row) => sum + row.total_downtime_minutes, 0);
    const totalDowntime = Number((totalDowntimeMinutes / 60).toFixed(2));
    const start = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : (rows.length ? new Date(`${rows[0].report_date}T00:00:00Z`) : new Date());
    const end = req.query.to ? new Date(`${req.query.to}T00:00:00Z`) : (rows.length ? new Date(`${rows[rows.length - 1].report_date}T00:00:00Z`) : start);
    const days = Math.max(1, Math.floor((end - start) / 86400000) + 1);
    const shiftHours = Number(req.query.shift_hours || 8);
    const capacity = affectedMachines * days * shiftHours;
    res.json({ summary: { affected_machines: affectedMachines, total_downtime_minutes: totalDowntimeMinutes, total_downtime_hours: totalDowntime, downtime_percentage: capacity ? Number(((totalDowntime / capacity) * 100).toFixed(2)) : 0, shift_hours_per_machine_per_day: shiftHours }, rows });
  }));

  router.get('/tasks', asyncRoute(async (req, res) => {
    const { sql, values } = filterParams(req);
    const [rows] = await pool.execute(`SELECT DATE(r.request_time) AS report_date, d.name AS department, m.name AS machine, m.machine_code, r.id AS request_id, r.tasks_performed, r.root_cause_fixed, TIMESTAMPDIFF(MINUTE, r.request_time, r.repair_end_time) AS total_downtime_minutes, r.repair_duration_minutes, r.repair_start_time, r.repair_end_time, technician.name AS technician_name, technician.specialization AS technician_specialization FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id LEFT JOIN users technician ON technician.id = r.repair_completed_by ${sql ? `${sql} AND` : 'WHERE'} r.status = 'RESOLVED' ORDER BY report_date, department, machine`, values);
    res.json(rows);
  }));

  router.get('/issue-frequency', asyncRoute(async (req, res) => {
    const { sql, values } = filterParams(req);
    const [rows] = await pool.execute(`SELECT r.breakdown_category, DATE(r.request_time) AS report_date, d.name AS department, m.name AS machine, m.machine_code, COUNT(*) AS frequency FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id ${sql} GROUP BY r.breakdown_category, DATE(r.request_time), d.id, d.name, m.id, m.name, m.machine_code ORDER BY r.breakdown_category, report_date, department, machine`, values);
    res.json(rows);
  }));

  router.get('/preventive', asyncRoute(async (req, res) => {
    const clauses = [];
    const values = [];
    if (req.query.from) { clauses.push('pm.scheduled_date >= ?'); values.push(req.query.from); }
    if (req.query.to) { clauses.push('pm.scheduled_date <= ?'); values.push(req.query.to); }
    if (req.query.department_id) { clauses.push('m.department_id = ?'); values.push(Number(req.query.department_id)); }
    if (req.query.machine_id) { clauses.push('pm.machine_id = ?'); values.push(Number(req.query.machine_id)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.execute(`SELECT pm.id, pm.scheduled_date, pm.maintenance_type, pm.duration_hours, pm.notes, m.name AS machine, m.machine_code, d.name AS department, u.name AS completed_by, GROUP_CONCAT(CONCAT(pp.part_name, ' (', pp.quantity, ')') ORDER BY pp.part_name SEPARATOR ', ') AS spare_parts_used FROM preventive_maintenance pm JOIN machines m ON m.id = pm.machine_id JOIN departments d ON d.id = m.department_id LEFT JOIN users u ON u.id = pm.completed_by LEFT JOIN preventive_maintenance_parts pp ON pp.preventive_maintenance_id = pm.id ${where} GROUP BY pm.id, pm.scheduled_date, pm.maintenance_type, pm.duration_hours, pm.notes, m.name, m.machine_code, d.name, u.name ORDER BY pm.scheduled_date, d.name, m.name`, values);
    res.json(rows);
  }));

  router.get('/export', asyncRoute(async (req, res) => {
    const type = String(req.query.type || 'downtime');
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!['downtime', 'tasks', 'issue-frequency', 'preventive'].includes(type)) return res.status(400).json({ error: 'Unknown report type.' });
    if (!['csv', 'pdf'].includes(format)) return res.status(400).json({ error: 'Format must be csv or pdf.' });
    const endpoint = type === 'issue-frequency' ? '/issue-frequency' : type === 'preventive' ? '/preventive' : `/${type}`;
    const { sql, values } = filters(req.query);
    let rows;
    if (type === 'downtime') {
      const [resultRows] = await pool.execute(`SELECT r.breakdown_category, DATE(r.request_time) AS report_date, d.name AS department, m.name AS machine, m.machine_code, COUNT(*) AS issue_count, SUM(CASE WHEN r.status = 'RESOLVED' AND r.repair_end_time IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, r.request_time, r.repair_end_time) ELSE 0 END) AS total_downtime_minutes FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id ${sql} GROUP BY r.breakdown_category, DATE(r.request_time), d.name, m.name, m.machine_code ORDER BY report_date, department, machine, machine_code`, values);
      rows = addDowntimeHours(resultRows);
      const hoursByCategory = rows.reduce((totals, row) => {
        totals[row.breakdown_category] = (totals[row.breakdown_category] || 0) + Number(row.total_downtime_hours || 0);
        return totals;
      }, {});
      for (const row of rows) {
        const categoryTotal = hoursByCategory[row.breakdown_category] || 0;
        row.category_downtime_percentage = categoryTotal ? Number(((Number(row.total_downtime_hours || 0) / categoryTotal) * 100).toFixed(2)) : 0;
      }
    } else if (type === 'tasks') {
      [rows] = await pool.execute(`SELECT DATE(r.request_time) AS report_date, d.name AS department, m.name AS machine, m.machine_code, r.id AS request_id, r.tasks_performed, r.root_cause_fixed, TIMESTAMPDIFF(MINUTE, r.request_time, r.repair_end_time) AS total_downtime_minutes, r.repair_duration_minutes, r.repair_start_time, r.repair_end_time, technician.name AS technician_name, technician.specialization AS technician_specialization FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id LEFT JOIN users technician ON technician.id = r.repair_completed_by ${sql ? `${sql} AND` : 'WHERE'} r.status = 'RESOLVED' ORDER BY report_date, department, machine`, values);
    } else if (type === 'issue-frequency') {
      [rows] = await pool.execute(`SELECT r.breakdown_category, DATE(r.request_time) AS report_date, d.name AS department, m.name AS machine, m.machine_code, COUNT(*) AS frequency FROM maintenance_requests r JOIN departments d ON d.id = r.department_id JOIN machines m ON m.id = r.machine_id ${sql} GROUP BY r.breakdown_category, DATE(r.request_time), d.name, m.name, m.machine_code ORDER BY r.breakdown_category, report_date, department, machine`, values);
    } else {
      const clauses = [];
      const preventiveValues = [];
      if (req.query.from) { clauses.push('pm.scheduled_date >= ?'); preventiveValues.push(req.query.from); }
      if (req.query.to) { clauses.push('pm.scheduled_date <= ?'); preventiveValues.push(req.query.to); }
      if (req.query.department_id) { clauses.push('m.department_id = ?'); preventiveValues.push(Number(req.query.department_id)); }
      if (req.query.machine_id) { clauses.push('pm.machine_id = ?'); preventiveValues.push(Number(req.query.machine_id)); }
      [rows] = await pool.execute(`SELECT pm.scheduled_date, d.name AS department, m.name AS machine, m.machine_code, pm.maintenance_type, pm.duration_hours, pm.notes, GROUP_CONCAT(CONCAT(pp.part_name, ' (', pp.quantity, ')') ORDER BY pp.part_name SEPARATOR ', ') AS spare_parts_used FROM preventive_maintenance pm JOIN machines m ON m.id = pm.machine_id JOIN departments d ON d.id = m.department_id LEFT JOIN preventive_maintenance_parts pp ON pp.preventive_maintenance_id = pm.id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} GROUP BY pm.id, pm.scheduled_date, d.name, m.name, m.machine_code, pm.maintenance_type, pm.duration_hours, pm.notes ORDER BY pm.scheduled_date, department, machine`, preventiveValues);
    }
    const filename = `machine-${type}-report.${format}`;
    if (format === 'csv') {
      const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const body = [headers.map(escapeCsv).join(','), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(`\uFEFF${body}`);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ margin: 42, size: 'A4', layout: 'landscape' });
    doc.pipe(res);
    doc.fontSize(18).text(`Machine Issue ${type.replace('-', ' ')} Report`);
    doc.moveDown(0.5).fontSize(9).text(`Generated ${new Date().toLocaleString()} | ${rows.length} rows`);
    doc.moveDown();
    rows.forEach((row, index) => {
      const line = Object.entries(row).map(([key, value]) => `${key}: ${value ?? ''}`).join('    |    ');
      doc.fontSize(8).text(`${index + 1}. ${line}`, { paragraphGap: 4 });
      if (doc.y > 520) doc.addPage();
    });
    if (!rows.length) doc.fontSize(10).text('No records match these filters.');
    doc.end();
  }));

  return router;
};
