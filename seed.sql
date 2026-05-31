-- Invoker demo seed data
-- Demo login: admin@invoker.dev / password123

-- Company
INSERT OR IGNORE INTO companies (id, name, slug, type, brand_color, address, phone, email, currency, tax_rate)
VALUES ('co_demo0001', 'City General Hospital', 'city-general-demo', 'hospital', '#6366f1',
        '123 Health Ave, Dhaka, Bangladesh', '+880 1700 000000', 'billing@citygeneral.com', 'BDT', 5);

INSERT OR IGNORE INTO companies (id, name, slug, type, brand_color, currency, tax_rate)
VALUES ('co_demo0002', 'Acme Diagnostics Ltd', 'acme-diag-demo', 'corporate', '#06b6d4', 'BDT', 10);

-- Branches
INSERT OR IGNORE INTO branches (id, company_id, name, address) VALUES
  ('br_demo0001', 'co_demo0001', 'Main Campus', '123 Health Ave'),
  ('br_demo0002', 'co_demo0001', 'North Wing', '45 North Rd');

-- Users (password = password123)
INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES
  ('usr_admin0001', 'admin@invoker.dev', 'Dr. Sarah Admin',
   'pbkdf2$100000$cf1dfc86df08d56b380cfc054f7391f2$ba32d6edd4cce7b26b57ac58679edc96a05b656b770a0faf08e638b0a98276ce'),
  ('usr_staff0001', 'staff@invoker.dev', 'Karim Staff',
   'pbkdf2$100000$cf1dfc86df08d56b380cfc054f7391f2$ba32d6edd4cce7b26b57ac58679edc96a05b656b770a0faf08e638b0a98276ce');

-- Memberships (RBAC)
INSERT OR IGNORE INTO memberships (id, user_id, company_id, role) VALUES
  ('mem_demo0001', 'usr_admin0001', 'co_demo0001', 'admin'),
  ('mem_demo0002', 'usr_admin0001', 'co_demo0002', 'admin'),
  ('mem_demo0003', 'usr_staff0001', 'co_demo0001', 'staff');

-- Documents
INSERT OR IGNORE INTO documents (id, company_id, type, number, template, title, client_name, client_email, data_json, subtotal, tax, discount, total, status, created_by) VALUES
  ('doc_demo0001', 'co_demo0001', 'invoice', 'INV-0001', 'modern', 'Surgery Bill', 'Mr. Rahim Uddin', 'rahim@example.com',
   '{"items":[{"name":"Consultation","qty":1,"price":1500},{"name":"Surgery - Appendectomy","qty":1,"price":45000},{"name":"Medicines","qty":1,"price":3200}],"discount":2000}',
   49700, 2385, 2000, 50085, 'paid', 'usr_admin0001'),
  ('doc_demo0002', 'co_demo0001', 'invoice', 'INV-0002', 'classic', 'Lab Tests', 'Mrs. Fatima Begum', 'fatima@example.com',
   '{"items":[{"name":"Blood CBC","qty":1,"price":600},{"name":"X-Ray Chest","qty":1,"price":1200}],"discount":0}',
   1800, 90, 0, 1890, 'due', 'usr_staff0001'),
  ('doc_demo0003', 'co_demo0001', 'certificate', 'CRT-0001', 'elegant', 'Medical Fitness Certificate', 'Mr. Jamal Hossain', 'jamal@example.com',
   '{"purpose":"Medical Fitness Certificate","body":"This certifies that the above-named individual has been examined and found medically fit.","signatory":"Dr. Sarah Admin, Chief Medical Officer"}',
   0, 0, 0, 0, 'issued', 'usr_admin0001'),
  ('doc_demo0004', 'co_demo0001', 'report', 'RPT-0001', 'modern', 'Monthly Revenue Report', 'Internal', '',
   '{"body":"Total patient admissions increased 12% this quarter. Revenue from diagnostics grew steadily.","period":"Q1 2026"}',
   0, 0, 0, 0, 'issued', 'usr_admin0001');

-- Payments
INSERT OR IGNORE INTO payments (id, company_id, document_id, method, amount, tendered, change_due, status, created_by) VALUES
  ('pay_demo0001', 'co_demo0001', 'doc_demo0001', 'bkash', 50085, NULL, 0, 'completed', 'usr_admin0001'),
  ('pay_demo0002', 'co_demo0001', NULL, 'cash', 500, 1000, 500, 'completed', 'usr_staff0001');
