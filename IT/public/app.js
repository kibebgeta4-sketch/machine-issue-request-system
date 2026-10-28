const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let repairClockInterval;
let managerRefreshInterval;

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const result = contentType.includes('application/json') ? await response.json() : { error: 'Request failed.' };
    throw new Error(result.error || 'Request failed.');
  }
  return contentType.includes('application/json') ? response.json() : response;
}

function notify(message, type = 'info') {
  let container = $('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-relevant', 'additions');
    document.body.append(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${['success', 'error', 'info'].includes(type) ? type : 'info'}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  toast.append(icon, text, close);
  container.append(toast);
  const dismiss = () => {
    if (toast.classList.contains('toast-leaving')) return;
    toast.classList.add('toast-leaving');
    window.setTimeout(() => toast.remove(), 200);
  };
  close.addEventListener('click', dismiss);
  window.requestAnimationFrame(() => toast.classList.add('toast-visible'));
  window.setTimeout(dismiss, 5000);
}

function confirmInApp(message, title = 'Confirm action') {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'app-modal-backdrop';
    const modal = document.createElement('section');
    modal.className = 'app-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'app-modal-title');
    const heading = document.createElement('h2');
    heading.id = 'app-modal-title';
    heading.textContent = title;
    const content = document.createElement('p');
    content.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'app-modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn secondary';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'btn';
    confirm.type = 'button';
    confirm.textContent = 'Confirm';
    actions.append(cancel, confirm);
    modal.append(heading, content, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      backdrop.classList.remove('app-modal-visible');
      window.setTimeout(() => backdrop.remove(), 180);
      resolve(accepted);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(false);
    });
    window.requestAnimationFrame(() => backdrop.classList.add('app-modal-visible'));
    cancel.focus();
  });
}

function statusBadge(status) {
  const value = String(status || '').toLowerCase();
  const label = value === 'pending' ? 'SUBMITTED' : value.replace('_', ' ').toUpperCase();
  return `<span class="badge ${value}">${escapeHtml(label)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function dateText(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function updateRepairClocks() {
  $$('.repair-clock').forEach((clock) => {
    const started = new Date(clock.dataset.startedAt).getTime();
    const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const remainder = String(seconds % 60).padStart(2, '0');
    clock.textContent = `${hours}:${minutes}:${remainder}`;
  });
}

async function fillSelect(selector, rows, emptyLabel, valueKey = 'id', labelFn = (row) => row.name) {
  const select = $(selector);
  if (!select) return;
  select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>` + rows.map((row) => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(labelFn(row))}</option>`).join('');
}

async function loadLookups() {
  const [departments, machines] = await Promise.all([api('/api/departments'), api('/api/machines')]);
  await fillSelect('#department_id', departments, 'Select department');
  await fillSelect('#machine-department', departments, 'Select department');
  await fillSelect('#machine_id', machines, 'Select machine', 'id', (machine) => `${machine.name} · ${machine.machine_code}`);
  await fillSelect('#filter-department', departments, 'All departments');
  await fillSelect('#filter-machine', machines, 'All machines', 'id', (machine) => `${machine.name} · ${machine.machine_code}`);
  const department = $('#department_id');
  if (department) department.addEventListener('change', () => {
    const machineSelect = $('#machine_id');
    const code = $('#machine-code');
    const filtered = machines.filter((machine) => !department.value || String(machine.department_id) === department.value);
    machineSelect.innerHTML = '<option value="">Select machine</option>' + filtered.map((machine) => `<option value="${machine.id}" data-code="${escapeHtml(machine.machine_code)}">${escapeHtml(machine.name)} · ${escapeHtml(machine.machine_code)}</option>`).join('');
    if (code) code.value = '';
  });
  const machineSelect = $('#machine_id');
  if (machineSelect) machineSelect.addEventListener('change', () => { $('#machine-code').value = machineSelect.selectedOptions[0]?.dataset.code || ''; });
}

async function initBreakdownForm() {
  const [mapping, departments, machines] = await Promise.all([
    fetch('/machineData.json').then((response) => {
      if (!response.ok) throw new Error('Could not load machine data.');
      return response.json();
    }),
    api('/api/departments'),
    api('/api/machines')
  ]);
  const departmentIds = new Map(departments.map((department) => [department.name, department.id]));
  const machineRows = new Map(machines.map((machine) => [`${machine.department_name}\u0000${machine.name}\u0000${machine.machine_code}`, machine]));
  const departmentSelect = $('#department_id');
  const machineSelect = $('#machine_id');
  const singleCodeInput = $('#machine-code-single');
  const codeSelect = $('#machine-code-select');
  const machineIdInput = $('#selected-machine-id');
  const selectedCodeInput = $('#selected-machine-code');

  departmentSelect.innerHTML = '<option value="">Select section</option>' + Object.keys(mapping).map((name) => {
    const id = departmentIds.get(name);
    return id ? `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>` : '';
  }).join('');

  function clearMachineAndCode() {
    machineSelect.innerHTML = '<option value="">Select section first</option>';
    machineSelect.disabled = true;
    machineIdInput.value = '';
    singleCodeInput.value = '';
    singleCodeInput.disabled = true;
    singleCodeInput.classList.remove('hidden');
    codeSelect.innerHTML = '<option value="">Select code</option>';
    codeSelect.disabled = true;
    codeSelect.classList.add('hidden');
    selectedCodeInput.value = '';
  }

  $('#request-form').addEventListener('reset', () => window.setTimeout(clearMachineAndCode, 0));

  function selectMachineCode(code, departmentName, machineName) {
    const row = machineRows.get(`${departmentName}\u0000${machineName}\u0000${code}`);
    machineIdInput.value = row?.id || '';
    selectedCodeInput.value = row ? code : '';
    if (!row) notify(`Machine code ${code} is not registered in the database.`, 'error');
  }

  departmentSelect.addEventListener('change', () => {
    clearMachineAndCode();
    const departmentName = departmentSelect.selectedOptions[0]?.textContent;
    const availableMachines = mapping[departmentName];
    if (!departmentSelect.value || !availableMachines) return;
    machineSelect.innerHTML = '<option value="">Select machine</option>' + Object.keys(availableMachines).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    machineSelect.disabled = false;
  });

  machineSelect.addEventListener('change', () => {
    machineIdInput.value = '';
    selectedCodeInput.value = '';
    singleCodeInput.value = '';
    const departmentName = departmentSelect.selectedOptions[0]?.textContent;
    const machineName = machineSelect.value;
    const codes = mapping[departmentName]?.[machineName] || [];
    codeSelect.innerHTML = '<option value="">Select code</option>' + codes.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join('');
    if (codes.length === 1) {
      singleCodeInput.classList.remove('hidden');
      singleCodeInput.disabled = false;
      codeSelect.classList.add('hidden');
      codeSelect.disabled = true;
      singleCodeInput.value = codes[0];
      selectMachineCode(codes[0], departmentName, machineName);
      return;
    }
    singleCodeInput.classList.add('hidden');
    singleCodeInput.disabled = true;
    codeSelect.classList.remove('hidden');
    codeSelect.disabled = codes.length === 0;
  });

  codeSelect.addEventListener('change', () => {
    if (!codeSelect.value) {
      machineIdInput.value = '';
      selectedCodeInput.value = '';
      return;
    }
    selectMachineCode(codeSelect.value, departmentSelect.selectedOptions[0]?.textContent, machineSelect.value);
  });
}

async function loadRequests() {
  const rows = await api('/api/requests');
  const body = $('#request-rows');
  if (!body) return rows;
  if (!rows.length) { body.innerHTML = '<tr><td class="empty" colspan="7">No requests to display.</td></tr>'; return rows; }
  body.innerHTML = rows.map((row) => `<tr><td>#${row.id}</td><td>${escapeHtml(row.machine_name)}<div class="inline-note">${escapeHtml(row.machine_code)}</div></td><td>${escapeHtml(row.department_name)}</td><td>${dateText(row.request_time)}</td><td>${statusBadge(row.status)}</td><td>${escapeHtml(row.breakdown_category)}</td><td>${escapeHtml(row.technician_name || 'Unassigned')}</td></tr>`).join('');
  return rows;
}

async function initLogin() {
  const form = $('#login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const user = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const destinations = { LINE_SUPERVISOR: '/supervisor', TECHNICIAN_MANAGER: '/manager', TECHNICIAN: '/manager', ADMIN: '/admin' };
      window.location.assign(destinations[user.user.role] || '/');
    } catch (error) { notify(error.message, 'error'); }
  });
}

async function initSupervisor() {
  await initBreakdownForm();
  await loadRequests();
  $('#request-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (!values.machine_id || !values.machine_code) {
      notify('Select a machine and its machine code.', 'error');
      return;
    }
    values.is_production_stopped = values.is_production_stopped === 'true';
    try {
      await api('/api/requests', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      $('#selected-machine-id').value = '';
      $('#selected-machine-code').value = '';
      $('#machine_id').disabled = true;
      $('#machine-code-single').disabled = true;
      $('#machine-code-select').disabled = true;
      notify('Request submitted.', 'success');
      await loadRequests();
    } catch (error) { notify(error.message, 'error'); }
  });
  window.setInterval(() => loadRequests().catch(() => {}), 30000);
}

async function initManager() {
  const currentUser = (await api('/api/auth/me')).user;
  const [rows, technicians, dispatches] = await Promise.all([
    api('/api/requests'),
    currentUser.role === 'TECHNICIAN' ? Promise.resolve([]) : api('/api/technicians'),
    currentUser.role === 'TECHNICIAN' ? api('/api/technician/dispatches') : Promise.resolve([])
  ]);
  if (currentUser.role === 'TECHNICIAN') $('#incoming-panel').classList.add('hidden');
  const dispatchPanel = $('#technician-dispatch-panel');
  if (currentUser.role === 'TECHNICIAN') {
    dispatchPanel.classList.remove('hidden');
    $('#technician-dispatches').innerHTML = dispatches.length ? dispatches.map((dispatch) => `<article class="panel" id="dispatch-${dispatch.request_id}"><div class="panel-heading"><h2>Work order #${dispatch.request_id} · ${statusBadge(dispatch.status)}</h2><small>Dispatched ${dateText(dispatch.sent_at)}${dispatch.assigned_by_name ? ` by ${escapeHtml(dispatch.assigned_by_name)}` : ''}</small></div><p><strong>Department:</strong> ${escapeHtml(dispatch.department_name)} &nbsp; <strong>Machine:</strong> ${escapeHtml(dispatch.machine_name)} &nbsp; <strong>Tag:</strong> ${escapeHtml(dispatch.machine_code)}</p><p><strong>Issue type:</strong> ${escapeHtml(dispatch.issue_type)} &nbsp; <strong>Production stopped:</strong> ${dispatch.is_production_stopped ? 'Yes' : 'No'}</p><p><strong>Reported issue:</strong> ${escapeHtml(dispatch.reported_issue)}</p><p><strong>Work instructions:</strong> ${escapeHtml(dispatch.assignment_explanation || 'No additional instructions.')}</p><div class="btn-row">${dispatch.acknowledged_at ? `<span class="badge resolved">Acknowledged ${dateText(dispatch.acknowledged_at)}</span>` : `<button class="btn acknowledge-dispatch" data-request="${dispatch.request_id}" data-action-url="${escapeHtml(dispatch.action_url)}">Acknowledge &amp; open work order</button>`}<a class="btn secondary" href="${escapeHtml(dispatch.action_url)}">Open work order</a></div></article>`).join('') : '<p class="empty">No dispatch notifications.</p>';
    $$('.acknowledge-dispatch').forEach((button) => button.addEventListener('click', async () => {
      try {
        await api(`/api/requests/${button.dataset.request}/acknowledge`, { method: 'PATCH', body: JSON.stringify({}) });
        window.location.assign(button.dataset.actionUrl);
      } catch (error) { notify(error.message, 'error'); }
    }));
  }
  const pending = rows.filter((row) => row.status === 'PENDING');
  const incoming = $('#incoming-rows');
  incoming.innerHTML = pending.length ? pending.map((row) => `<tr><td>#${row.id}</td><td>${escapeHtml(row.department_name)}</td><td>${escapeHtml(row.machine_name)}</td><td>${escapeHtml(row.machine_code)}</td><td>${escapeHtml(row.breakdown_category)}<div class="inline-note">${escapeHtml(row.breakdown_details)}</div></td><td>${dateText(row.request_time)}</td><td><select class="assign-tech" data-request="${row.id}"><option value="">Select Technician</option>${technicians.map((tech) => `<option value="${tech.id}">${escapeHtml(tech.name)} · ${escapeHtml(tech.employee_id || `ID ${tech.id}`)} · Active</option>`).join('')}</select></td><td><textarea class="assignment-explanation" data-request="${row.id}" rows="2" maxlength="10000" placeholder="Optional work instructions"></textarea></td><td><button class="btn small accept-btn" data-request="${row.id}" ${technicians.length ? '' : 'disabled'}>Assign &amp; start</button></td></tr>`).join('') : '<tr><td class="empty" colspan="9">No pending requests.</td></tr>';
  $$('.accept-btn').forEach((button) => button.addEventListener('click', async () => {
    const requestId = button.dataset.request;
    const technicianId = $(`.assign-tech[data-request="${requestId}"]`).value;
    if (!technicianId) return notify('Select a technician to assign.', 'error');
    const assignmentExplanation = $(`.assignment-explanation[data-request="${requestId}"]`).value.trim();
    button.disabled = true;
    try { await api(`/api/requests/${requestId}/accept`, { method: 'PATCH', body: JSON.stringify({ technician_id: technicianId, assignment_explanation: assignmentExplanation }) }); await initManager(); notify(`Request #${requestId} assigned. Start the repair when work begins.`, 'success'); }
    catch (error) { notify(error.message, 'error'); }
    finally { button.disabled = false; }
  }));
  const activeRows = rows.filter((row) => ['ACCEPTED', 'IN_PROGRESS'].includes(row.status));
  const resolveTable = $('#resolve-rows');
  resolveTable.innerHTML = activeRows.length ? activeRows.map((row) => `<tr id="ticket-${row.id}"><td>#${row.id}</td><td>${escapeHtml(row.department_name)}</td><td>${escapeHtml(row.machine_name)}</td><td>${escapeHtml(row.machine_code)}</td><td>${escapeHtml(row.breakdown_category)}</td><td>${escapeHtml(row.technician_name || 'Unassigned')}</td><td>${statusBadge(row.status)}<div class="inline-note">Elapsed <strong class="repair-clock" data-started-at="${escapeHtml(row.repair_start_time || '')}">00:00:00</strong></div></td><td>${row.status === 'ACCEPTED' ? `<button class="btn small start-repair" data-request="${row.id}">Start repair</button>` : `<button class="btn secondary small resolve-open" data-request="${row.id}">Enter resolution</button>`}</td></tr>`).join('') : '<tr><td class="empty" colspan="8">No accepted or in-progress repairs.</td></tr>';
  updateRepairClocks();
  window.clearInterval(repairClockInterval);
  repairClockInterval = window.setInterval(updateRepairClocks, 1000);
  const requestedTicket = new URLSearchParams(window.location.search).get('request');
  if (requestedTicket) document.getElementById(`ticket-${requestedTicket}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $$('.start-repair').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api(`/api/requests/${button.dataset.request}/start`, { method: 'PATCH', body: JSON.stringify({}) }); await initManager(); notify(`Request #${button.dataset.request} repair started.`, 'success'); }
    catch (error) { notify(error.message, 'error'); }
    finally { button.disabled = false; }
  }));
  $$('.resolve-open').forEach((button) => button.addEventListener('click', () => {
    $('#resolve-request-id').value = button.dataset.request;
    $('#resolve-title').textContent = `Resolve request #${button.dataset.request}`;
    $('#resolution-panel').classList.remove('hidden');
    $('#resolution-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('#add-part').onclick = () => {
    const row = document.createElement('div'); row.className = 'parts-row';
    row.innerHTML = '<input name="part_name" placeholder="Part name" aria-label="Part name"><input name="part_code" placeholder="Part code" aria-label="Part code"><input name="quantity" type="number" min="0.01" step="0.01" value="1" aria-label="Quantity"><input name="description" placeholder="Description" aria-label="Description"><button type="button" class="icon-btn remove-part" aria-label="Remove part">×</button>';
    $('#parts-list').append(row); row.querySelector('.remove-part').onclick = () => row.remove();
  };
  $('#resolution-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const parts = $$('.parts-row', $('#parts-list')).map((row) => Object.fromEntries([...row.querySelectorAll('input')].map((input) => [input.name, input.value]))).filter((part) => part.part_name.trim());
    const data = { tasks_performed: $('#tasks-performed').value, root_cause_fixed: $('#root-cause-fixed').value, resolution_details: $('#resolution-details').value, spare_parts_used: parts };
    try { await api(`/api/requests/${$('#resolve-request-id').value}/resolve`, { method: 'PATCH', body: JSON.stringify(data) }); notify('Repair marked resolved.', 'success'); form.reset(); $('#parts-list').innerHTML = ''; $('#resolution-panel').classList.add('hidden'); await initManager(); }
    catch (error) { notify(error.message, 'error'); }
  };
  if (!managerRefreshInterval) managerRefreshInterval = window.setInterval(() => initManager().catch(() => {}), 15000);
}

function reportFilters() {
  const params = new URLSearchParams();
  const from = $('#from')?.value; const to = $('#to')?.value;
  if (from) params.set('from', from); if (to) params.set('to', to);
  if ($('#filter-department')?.value) params.set('department_id', $('#filter-department').value);
  if ($('#filter-machine')?.value) params.set('machine_id', $('#filter-machine').value);
  return params;
}

async function initReports() {
  await loadLookups();
  const reportTypes = { downtime: '/api/reports/downtime', tasks: '/api/reports/tasks', 'issue-frequency': '/api/reports/issue-frequency', preventive: '/api/reports/preventive' };
  const render = async () => {
    const type = $('#report-type').value;
    const params = reportFilters();
    const data = await api(`${reportTypes[type]}?${params}`);
    const rows = Array.isArray(data) ? data : data.rows;
    if (data.summary) {
      $('#report-kpis').innerHTML = `<div class="kpi"><span>Affected machines</span><strong>${data.summary.affected_machines}</strong></div><div class="kpi"><span>Downtime minutes</span><strong>${data.summary.total_downtime_minutes}</strong></div><div class="kpi"><span>Downtime hours</span><strong>${data.summary.total_downtime_hours}</strong></div><div class="kpi"><span>Shift downtime</span><strong>${data.summary.downtime_percentage}%</strong></div>`;
    } else $('#report-kpis').innerHTML = '';
    const body = $('#report-rows');
    if (!rows.length) { body.innerHTML = '<tr><td class="empty">No records match these filters.</td></tr>'; return; }
    const columns = Object.keys(rows[0]);
    $('#report-head').innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.replaceAll('_', ' '))}</th>`).join('')}</tr>`;
    body.innerHTML = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join('')}</tr>`).join('');
  };
  $('#view-report').addEventListener('click', () => render().catch((error) => notify(error.message, 'error')));
  $$('.export-btn').forEach((button) => button.addEventListener('click', () => {
    const params = reportFilters(); params.set('type', $('#report-type').value); params.set('format', button.dataset.format);
    window.location.assign(`/api/reports/export?${params}`);
  }));
}

async function initAdmin() {
  await loadLookups();
  const editDialog = $('#edit-user-dialog');
  const editForm = $('#edit-user-form');
  const historyMachine = $('#history-machine');
  const historyMachineCode = $('#history-machine-code');
  let adminMachines = [];
  historyMachine.addEventListener('change', () => {
    const machine = adminMachines.find((item) => String(item.id) === historyMachine.value);
    historyMachineCode.value = machine?.machine_code || '';
  });
  const editRoleSelect = $('#edit-user-role');
  const editSpecializationField = $('#edit-specialization-field');
  const editSpecializationSelect = $('#edit-user-specialization');
  const editDepartmentSelect = $('#edit-user-department');
  editDepartmentSelect.innerHTML = $('#department_id').innerHTML;
  const updateEditSpecializationVisibility = () => {
    const isTechnician = editRoleSelect.value === 'TECHNICIAN';
    editSpecializationField.classList.toggle('hidden', !isTechnician);
    editSpecializationSelect.required = isTechnician;
  };
  editRoleSelect.addEventListener('change', updateEditSpecializationVisibility);
  $('#cancel-edit-user').addEventListener('click', () => editDialog.close());
  const roleSelect = $('#user-role');
  const specializationField = $('#specialization-field');
  const specializationSelect = $('#user-specialization');
  const updateSpecializationVisibility = () => {
    const isTechnician = roleSelect.value === 'TECHNICIAN';
    specializationField.classList.toggle('hidden', !isTechnician);
    specializationSelect.required = isTechnician;
  };
  roleSelect.addEventListener('change', updateSpecializationVisibility);
  updateSpecializationVisibility();
  const refresh = async () => {
    const [users, machines] = await Promise.all([api('/api/admin/users'), api('/api/admin/machines')]);
    const selectedMachine = historyMachine.value;
    adminMachines = machines;
    await fillSelect('#history-machine', machines, 'Select machine', 'id', (machine) => `${machine.name} · ${machine.machine_code}`);
    if (machines.some((machine) => String(machine.id) === selectedMachine)) historyMachine.value = selectedMachine;
    historyMachine.dispatchEvent(new Event('change'));
    $('#users-rows').innerHTML = users.map((user) => `<tr><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.role.replaceAll('_', ' '))}</td><td>${escapeHtml($('#department_id').querySelector(`option[value="${user.department_id}"]`)?.textContent || '—')}</td><td>${user.role === 'TECHNICIAN' ? `<select class="user-specialization" data-user="${user.id}" aria-label="${escapeHtml(user.name)} specialization"><option value="">Select specialization</option><option value="MECHANICAL" ${user.specialization === 'MECHANICAL' ? 'selected' : ''}>Mechanical</option><option value="ELECTRICAL" ${user.specialization === 'ELECTRICAL' ? 'selected' : ''}>Electrical</option><option value="UTILITY_IT" ${user.specialization === 'UTILITY_IT' ? 'selected' : ''}>Utility / IT</option></select>` : '—'}</td><td>${user.active ? 'Active' : 'Inactive'}</td><td><div class="btn-row"><button class="btn secondary small edit-user" data-user="${user.id}">Edit</button><button class="btn ${user.active ? 'danger' : 'secondary'} small toggle-user-active" data-user="${user.id}" data-active="${user.active ? 'false' : 'true'}">${user.active ? 'Deactivate' : 'Activate'}</button>${user.role === 'TECHNICIAN' ? `<button class="btn secondary small save-specialization" data-user="${user.id}">Save specialization</button>` : ''}</div></td></tr>`).join('') || '<tr><td class="empty" colspan="8">No users found.</td></tr>';
    $$('.edit-user').forEach((button) => button.addEventListener('click', () => {
      const user = users.find((item) => String(item.id) === button.dataset.user);
      if (!user) return;
      editForm.elements.id.value = user.id;
      editForm.elements.name.value = user.name;
      editForm.elements.username.value = user.username;
      editForm.elements.email.value = user.email;
      editRoleSelect.value = user.role;
      editSpecializationSelect.value = user.specialization || '';
      editDepartmentSelect.value = user.department_id || '';
      editForm.elements.password.value = '';
      updateEditSpecializationVisibility();
      editDialog.showModal();
    }));
    $$('.toggle-user-active').forEach((button) => button.addEventListener('click', async () => {
      const active = button.dataset.active === 'true';
      const user = users.find((item) => String(item.id) === button.dataset.user);
      if (!user || !(await confirmInApp(`${active ? 'Activate' : 'Deactivate'} ${user.name}'s account?`, 'Update account status'))) return;
      try {
        await api(`/api/admin/users/${button.dataset.user}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
        notify(`User account ${active ? 'activated' : 'deactivated'}.`, 'success');
        await refresh();
      } catch (error) { notify(error.message, 'error'); }
    }));
    $$('.save-specialization').forEach((button) => button.addEventListener('click', async () => {
      const select = $(`.user-specialization[data-user="${button.dataset.user}"]`);
      try {
        await api(`/api/admin/users/${button.dataset.user}/specialization`, { method: 'PATCH', body: JSON.stringify({ specialization: select.value }) });
        notify('Technician specialization saved.', 'success');
        await refresh();
      } catch (error) { notify(error.message, 'error'); }
    }));
    $('#machines-rows').innerHTML = machines.map((machine) => `<tr><td>${escapeHtml(machine.name)}</td><td>${escapeHtml(machine.machine_code)}</td><td>${escapeHtml(machine.department_name)}</td><td>${machine.active ? 'Active' : 'Inactive'}</td></tr>`).join('') || '<tr><td class="empty" colspan="4">No machines found.</td></tr>';
  };
  await refresh();
  $('#history-from').addEventListener('change', () => {
    $('#history-to').min = $('#history-from').value;
  });
  $('#history-to').addEventListener('change', () => {
    $('#history-from').max = $('#history-to').value;
  });
  $('#history-delete-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const machine = adminMachines.find((item) => String(item.id) === historyMachine.value);
    if (!machine) return notify('Select a machine before deleting report history.', 'error');
    const from = $('#history-from').value;
    const to = $('#history-to').value;
    if (from > to) return notify('The start date must be on or before the end date.', 'error');
    if (!(await confirmInApp(`Permanently delete issue reports for ${machine.name} (${machine.machine_code}) from ${from} through ${to}? This cannot be undone.`, 'Delete report history'))) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/admin/report-history', {
        method: 'DELETE',
        body: JSON.stringify({ machine_id: machine.id, machine_code: machine.machine_code, from, to })
      });
      notify(`${result.deleted} report ${result.deleted === 1 ? 'record' : 'records'} deleted.`, 'success');
      form.reset();
      historyMachineCode.value = '';
      $('#history-to').min = '';
      $('#history-from').max = '';
    } catch (error) { notify(error.message, 'error'); }
    finally { button.disabled = false; }
  };
  editForm.onsubmit = async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(editForm));
    const userId = formData.id;
    delete formData.id;
    const saveButton = editForm.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    try {
      await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(formData) });
      editDialog.close();
      try {
        await refresh();
        notify('User account updated.', 'success');
      } catch (error) {
        notify(`User account was saved, but the user list could not be refreshed: ${error.message}`, 'error');
      }
    } catch (error) { notify(error.message, 'error'); }
    finally { saveButton.disabled = false; }
  };
  $('#admin-user-form').onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); updateSpecializationVisibility(); notify('User created.', 'success'); await refresh(); } catch (error) { notify(error.message, 'error'); } };
  $('#admin-machine-form').onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api('/api/admin/machines', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); notify('Machine created.', 'success'); await refresh(); } catch (error) { notify(error.message, 'error'); } };
}

async function init() {
  const page = document.body.dataset.page;
  const boot = { login: initLogin, supervisor: initSupervisor, manager: initManager, reports: initReports, admin: initAdmin }[page];
  if (boot) {
    try { if (page !== 'login') { const result = await api('/api/auth/me'); const label = $('#user-label'); if (label) label.textContent = `${result.user.name} · ${result.user.role.replaceAll('_', ' ')}`; } await boot(); }
    catch (error) { if (page !== 'login' && error.message === 'Sign in to continue.') window.location.replace('/'); else notify(error.message, 'error'); }
  }
  $('#logout')?.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); });
}

document.addEventListener('DOMContentLoaded', init);
