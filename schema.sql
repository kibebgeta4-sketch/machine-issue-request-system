CREATE DATABASE IF NOT EXISTS machine_issue_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE machine_issue_db;

CREATE TABLE IF NOT EXISTS departments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS machines (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  machine_code VARCHAR(80) NOT NULL UNIQUE,
  department_id INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_machines_department FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'LINE_SUPERVISOR', 'TECHNICIAN_MANAGER', 'TECHNICIAN') NOT NULL,
  specialization ENUM('MECHANICAL', 'ELECTRICAL', 'UTILITY_IT') NULL,
  department_id INT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  department_id INT UNSIGNED NOT NULL,
  machine_id INT UNSIGNED NOT NULL,
  operator_name VARCHAR(160) NOT NULL,
  is_production_stopped BOOLEAN NOT NULL DEFAULT FALSE,
  breakdown_category ENUM('MECHANICAL', 'ELECTRICAL', 'OTHER') NOT NULL,
  breakdown_details TEXT NOT NULL,
  requested_by_foreman INT UNSIGNED NULL,
  request_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by_tech INT UNSIGNED NULL,
  received_time DATETIME NULL,
  assigned_technician_id INT UNSIGNED NULL,
  assignment_explanation TEXT NULL,
  repair_started_by INT UNSIGNED NULL,
  repair_start_time DATETIME NULL,
  repair_completed_by INT UNSIGNED NULL,
  repair_end_time DATETIME NULL,
  accepted_by_foreman INT UNSIGNED NULL,
  completion_accepted_time DATETIME NULL,
  total_downtime_minutes INT UNSIGNED NULL,
  downtime_hours DECIMAL(10,2) NULL,
  tasks_performed TEXT NULL,
  resolution_details TEXT NULL,
  root_cause_fixed TEXT NULL,
  repair_duration_minutes INT UNSIGNED NULL,
  status ENUM('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_requests_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_requests_machine FOREIGN KEY (machine_id) REFERENCES machines(id),
  CONSTRAINT fk_requests_foreman FOREIGN KEY (requested_by_foreman) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_requests_received FOREIGN KEY (received_by_tech) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_requests_assigned FOREIGN KEY (assigned_technician_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_requests_started FOREIGN KEY (repair_started_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_requests_completed FOREIGN KEY (repair_completed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_requests_accepted FOREIGN KEY (accepted_by_foreman) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_requests_status_time (status, request_time),
  INDEX idx_requests_department_machine (department_id, machine_id),
  INDEX idx_requests_category_time (breakdown_category, request_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS technician_dispatches (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS spare_parts_used (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  part_name VARCHAR(160) NOT NULL,
  part_code VARCHAR(80) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  description TEXT NULL,
  CONSTRAINT fk_spare_parts_request FOREIGN KEY (request_id) REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  INDEX idx_spare_parts_request (request_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS preventive_maintenance (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  machine_id INT UNSIGNED NOT NULL,
  maintenance_type VARCHAR(160) NOT NULL,
  duration_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  scheduled_date DATE NOT NULL,
  completed_by INT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_preventive_machine FOREIGN KEY (machine_id) REFERENCES machines(id),
  CONSTRAINT fk_preventive_user FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_preventive_scheduled (scheduled_date, machine_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS preventive_maintenance_parts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  preventive_maintenance_id BIGINT UNSIGNED NOT NULL,
  part_name VARCHAR(160) NOT NULL,
  part_code VARCHAR(80) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  description TEXT NULL,
  CONSTRAINT fk_preventive_parts_job FOREIGN KEY (preventive_maintenance_id) REFERENCES preventive_maintenance(id) ON DELETE CASCADE,
  INDEX idx_preventive_parts_job (preventive_maintenance_id)
) ENGINE=InnoDB;
