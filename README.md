# Machine Issue Request System

Express and MySQL application for submitting machine breakdowns, managing repairs, and reviewing maintenance reports.

## Requirements

- Node.js 18 or newer
- MySQL 8

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set the MySQL connection values and a long random `SESSION_SECRET`. Keep `.env` private.
3. Create the database tables by running `mysql -u root -p < schema.sql` (adjust the MySQL user if needed).
4. Create the first `ADMIN` user and additional department, machine, manager, supervisor, and technician records directly in MySQL. Store bcrypt password hashes in `users.password_hash`; the login endpoint verifies these hashes.
5. Start the app with `npm start`, then open `http://localhost:5000` on the server, or `http://172.16.1.85:5000` from another device on the LAN.

## Deploy on the LAN

The app listens on all network interfaces by default (`HOST=0.0.0.0`), while MySQL remains local to the server (`DB_HOST=127.0.0.1`). Keep those settings in `.env` unless the database is on a different computer.

1. Configure the server computer's active network adapter with the static IPv4 address `172.16.1.85`, the subnet mask/prefix used by your LAN, and default gateway `172.16.1.4`. Ensure these addresses are reserved for this server and do not conflict with another device. The gateway is an operating-system/router setting, not an application setting.
2. In an elevated PowerShell window on the server, allow inbound TCP port `5000` through Windows Firewall:

   ```powershell
   New-NetFirewallRule -DisplayName "Machine Issue Request System (TCP 5000)" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
   ```

3. Configure `.env` with the database credentials and a unique, long `SESSION_SECRET`. Leave `HOST=0.0.0.0` and `PORT=5000` to accept connections from LAN clients.
4. Start the application on the server with `npm start`. Confirm the console reports that it is listening and database initialization succeeded.
5. On another device on the same LAN, browse to `http://172.16.1.85:5000`. If it cannot connect, check the server's IP/subnet/gateway, verify the port is listening, and confirm that the firewall rule and LAN routing permit the connection.

The application uses plain HTTP and does not require TLS certificates. Traffic, including login sessions, is not encrypted; use it only on a trusted network.

On startup, the server ensures a `Technician Department` department exists and creates an initial administrator if the username `admin` is not already present. Sign in with username `admin` and password `admin123`; the login page has no role selection, and the account role is determined securely from the database after authentication. This is a temporary development credential: change it before exposing the app to a network. The administrator can create accounts for all roles from the Administration page.

The server checks database connectivity before listening. On the Administration page, admins can edit user names, usernames, emails, roles, departments, technician specializations, and passwords; they can also activate or deactivate accounts. Passwords are only changed when a new password is entered, and the app prevents deactivating your own account or removing the last active administrator. Reports accept `from`, `to`, `department_id`, and `machine_id` query parameters. Session cookies are used for login and role-checked workflow APIs.

## Main routes

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/departments`, `GET /api/machines`, `GET /api/technicians`
- `POST /api/requests`, `GET /api/requests`
- `PATCH /api/requests/:id/accept`, `PATCH /api/requests/:id/resolve`
- `GET /api/technician/dispatches`, `PATCH /api/requests/:id/acknowledge`
- `GET /api/reports/downtime`, `/tasks`, `/issue-frequency`, `/preventive`
- `GET /api/reports/export?type=downtime&format=csv|pdf`
- `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `PATCH /api/admin/users/:id/active`, `PATCH /api/admin/users/:id/specialization`, `GET /api/admin/machines`, `POST /api/admin/machines`
