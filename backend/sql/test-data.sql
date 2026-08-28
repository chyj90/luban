-- ============================================================
-- 自动洞察 Phase 2 测试数据
-- 用途：为 5 个零售场景 + 1 个运营商场景创建测试表和数据
-- 库结构：
--   luban_retail    - 零售电商库（场景 1-5）
--   luban_carrier   - 运营商网络库（场景 6）
-- 注意：数据源连接需要通过 API 创建，不在 SQL 中插入
-- 执行方式：mysql -u root -p < test-data.sql
-- ============================================================

-- ============================================================
-- 创建数据库
-- ============================================================

CREATE DATABASE IF NOT EXISTS luban_retail DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS luban_carrier DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- 零售电商库：场景 1-5
-- ============================================================

USE luban_retail;

-- ============================================================
-- 场景 1：退货率异常
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
    order_id INT PRIMARY KEY AUTO_INCREMENT,
    product_line_id INT NOT NULL,
    region_id INT NOT NULL,
    batch_id INT NOT NULL,
    channel_id INT DEFAULT NULL,
    logistics_id INT DEFAULT NULL,
    customer_id INT NOT NULL,
    order_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    INDEX idx_product_line (product_line_id),
    INDEX idx_region (region_id),
    INDEX idx_batch (batch_id),
    INDEX idx_channel (channel_id),
    INDEX idx_logistics (logistics_id),
    INDEX idx_order_date (order_date)
);

CREATE TABLE IF NOT EXISTS returns (
    return_id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    return_date DATE NOT NULL,
    return_reason VARCHAR(100) NOT NULL,
    return_qty INT NOT NULL DEFAULT 1,
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    INDEX idx_return_date (return_date)
);

-- ============================================================
-- 场景 2：产能下降
-- ============================================================

CREATE TABLE IF NOT EXISTS production_lines (
    line_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    daily_capacity INT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
    equip_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
);

CREATE TABLE IF NOT EXISTS work_orders (
    wo_id INT PRIMARY KEY AUTO_INCREMENT,
    line_id INT NOT NULL,
    equipment_id INT NOT NULL,
    planned_qty INT NOT NULL,
    actual_qty INT NOT NULL,
    work_date DATE NOT NULL,
    FOREIGN KEY (line_id) REFERENCES production_lines(line_id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(equip_id),
    INDEX idx_line_date (line_id, work_date),
    INDEX idx_equip_date (equipment_id, work_date)
);

CREATE TABLE IF NOT EXISTS equipment_logs (
    log_id INT PRIMARY KEY AUTO_INCREMENT,
    equip_id INT NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    FOREIGN KEY (equip_id) REFERENCES equipment(equip_id),
    INDEX idx_equip_time (equip_id, start_time)
);

-- ============================================================
-- 场景 3：客诉上升
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_channels (
    channel_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS logistics (
    logistics_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    avg_delivery_days DECIMAL(5,2) NOT NULL DEFAULT 3.00
);

CREATE TABLE IF NOT EXISTS complaints (
    complaint_id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    channel_id INT NOT NULL,
    logistics_id INT NOT NULL,
    complaint_type VARCHAR(30) NOT NULL,
    complaint_date DATE NOT NULL,
    INDEX idx_channel_date (channel_id, complaint_date),
    INDEX idx_logistics_date (logistics_id, complaint_date)
);

-- ============================================================
-- 场景 4：库存积压
-- ============================================================

CREATE TABLE IF NOT EXISTS materials (
    material_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    safety_stock INT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
    inv_id INT PRIMARY KEY AUTO_INCREMENT,
    material_id INT NOT NULL,
    qty INT NOT NULL,
    inbound_date DATE NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materials(material_id),
    INDEX idx_material_date (material_id, inbound_date)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    po_id INT PRIMARY KEY AUTO_INCREMENT,
    material_id INT NOT NULL,
    supplier_id INT NOT NULL,
    qty INT NOT NULL,
    order_date DATE NOT NULL,
    expected_date DATE NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materials(material_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
    INDEX idx_material_date (material_id, order_date)
);

CREATE TABLE IF NOT EXISTS production_plans (
    plan_id INT PRIMARY KEY AUTO_INCREMENT,
    material_id INT NOT NULL,
    planned_qty INT NOT NULL,
    plan_date DATE NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materials(material_id),
    INDEX idx_material_date (material_id, plan_date)
);

-- ============================================================
-- 场景 5：成本异常
-- ============================================================

CREATE TABLE IF NOT EXISTS cost_items (
    item_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    budget_amount DECIMAL(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_records (
    record_id INT PRIMARY KEY AUTO_INCREMENT,
    item_id INT NOT NULL,
    line_id INT NOT NULL,
    actual_amount DECIMAL(12,2) NOT NULL,
    record_date DATE NOT NULL,
    FOREIGN KEY (item_id) REFERENCES cost_items(item_id),
    INDEX idx_item_date (item_id, record_date),
    INDEX idx_line_date (line_id, record_date)
);

CREATE TABLE IF NOT EXISTS raw_materials (
    material_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    price_date DATE NOT NULL,
    INDEX idx_name_date (name, price_date)
);

CREATE TABLE IF NOT EXISTS defect_records (
    record_id INT PRIMARY KEY AUTO_INCREMENT,
    line_id INT NOT NULL,
    wo_id INT NOT NULL,
    produced_qty INT NOT NULL,
    defect_qty INT NOT NULL,
    record_date DATE NOT NULL,
    INDEX idx_line_date (line_id, record_date),
    INDEX idx_wo_date (wo_id, record_date)
);

-- ============================================================
-- 运营商库：场景 6
-- ============================================================

USE luban_carrier;

CREATE TABLE IF NOT EXISTS dedicated_lines (
    line_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL COMMENT 'OTN/VPN',
    src_station VARCHAR(50) NOT NULL,
    dst_station VARCHAR(50) NOT NULL,
    bandwidth VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    INDEX idx_type (type),
    INDEX idx_status (status)
);

CREATE TABLE IF NOT EXISTS stations (
    station_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    province VARCHAR(30) NOT NULL
);

CREATE TABLE IF NOT EXISTS fiber_segments (
    seg_id INT PRIMARY KEY AUTO_INCREMENT,
    line_id INT NOT NULL,
    src_station VARCHAR(50) NOT NULL,
    dst_station VARCHAR(50) NOT NULL,
    fiber_length DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (line_id) REFERENCES dedicated_lines(line_id),
    INDEX idx_line (line_id)
);

CREATE TABLE IF NOT EXISTS transmission_segments (
    seg_id INT PRIMARY KEY AUTO_INCREMENT,
    otn_line_id INT NOT NULL,
    src_station VARCHAR(50) NOT NULL,
    dst_station VARCHAR(50) NOT NULL,
    wavelength VARCHAR(20) NOT NULL,
    FOREIGN KEY (otn_line_id) REFERENCES dedicated_lines(line_id),
    INDEX idx_otn_line (otn_line_id)
);

CREATE TABLE IF NOT EXISTS ip_links (
    link_id INT PRIMARY KEY AUTO_INCREMENT,
    vpn_line_id INT NOT NULL,
    src_station VARCHAR(50) NOT NULL,
    dst_station VARCHAR(50) NOT NULL,
    ip_prefix VARCHAR(30) NOT NULL,
    FOREIGN KEY (vpn_line_id) REFERENCES dedicated_lines(line_id),
    INDEX idx_vpn_line (vpn_line_id)
);

CREATE TABLE IF NOT EXISTS ports (
    port_id INT PRIMARY KEY AUTO_INCREMENT,
    device_id INT NOT NULL,
    port_type VARCHAR(20) NOT NULL COMMENT 'OPTICAL/ELECTRICAL',
    owner_id INT NOT NULL COMMENT '关联对象ID',
    owner_type VARCHAR(20) NOT NULL COMMENT 'FIBER_SEGMENT/TRANSMISSION_SEGMENT/IP_LINK',
    INDEX idx_owner (owner_id, owner_type)
);

CREATE TABLE IF NOT EXISTS alarms (
    alarm_id INT PRIMARY KEY AUTO_INCREMENT,
    source_type VARCHAR(20) NOT NULL COMMENT 'FIBER/TRANSMISSION/IP',
    source_id INT NOT NULL,
    severity VARCHAR(10) NOT NULL COMMENT 'CRITICAL/MAJOR/MINOR/WARNING',
    alarm_type VARCHAR(50) NOT NULL,
    alarm_time DATETIME NOT NULL,
    clear_time DATETIME,
    description VARCHAR(256),
    INDEX idx_source (source_type, source_id),
    INDEX idx_severity_time (severity, alarm_time)
);

CREATE TABLE IF NOT EXISTS network_topology (
    topo_id INT PRIMARY KEY AUTO_INCREMENT,
    upper_id INT NOT NULL,
    upper_type VARCHAR(20) NOT NULL,
    lower_id INT NOT NULL,
    lower_type VARCHAR(20) NOT NULL,
    relation_type VARCHAR(20) NOT NULL DEFAULT 'CARRIED_BY',
    INDEX idx_upper (upper_id, upper_type),
    INDEX idx_lower (lower_id, lower_type)
);

-- ============================================================
-- 基础数据插入：零售电商库
-- ============================================================

USE luban_retail;

-- 清空已有数据（按外键依赖顺序）
DELETE FROM defect_records;
DELETE FROM cost_records;
DELETE FROM raw_materials;
DELETE FROM cost_items;
DELETE FROM purchase_orders;
DELETE FROM production_plans;
DELETE FROM equipment_logs;
DELETE FROM work_orders;
DELETE FROM inventory;
DELETE FROM complaints;
DELETE FROM returns;
DELETE FROM orders;
DELETE FROM logistics;
DELETE FROM sales_channels;
DELETE FROM equipment;
DELETE FROM production_lines;
DELETE FROM suppliers;
DELETE FROM materials;

-- 产品线
INSERT INTO production_lines (line_id, name, daily_capacity) VALUES
(1, '产品线A', 1000),
(2, '产品线B', 800),
(3, '产品线C', 1200);

-- 设备
INSERT INTO equipment (equip_id, name, type, status) VALUES
(1, '冲压机-01', '冲压', 'RUNNING'),
(2, '冲压机-02', '冲压', 'RUNNING'),
(3, '焊接机-01', '焊接', 'RUNNING'),
(4, '组装线-01', '组装', 'RUNNING'),
(5, '包装机-01', '包装', 'RUNNING');

-- 销售渠道
INSERT INTO sales_channels (channel_id, name, type) VALUES
(1, '天猫旗舰店', '电商'),
(2, '京东自营', '电商'),
(3, '线下门店', '线下'),
(4, '拼多多', '电商');

-- 物流商
INSERT INTO logistics (logistics_id, name, avg_delivery_days) VALUES
(1, '顺丰速运', 2.00),
(2, '中通快递', 3.50),
(3, '圆通速递', 3.00),
(4, '韵达快递', 4.00);

-- 物料/原材料
INSERT INTO materials (material_id, name, type, safety_stock) VALUES
(1, '钢材A', '金属', 500),
(2, '塑料粒子B', '塑料', 1000),
(3, '电子元件C', '电子', 300),
(4, '包装材料D', '包装', 800);

INSERT INTO raw_materials (name, unit_price, price_date) VALUES
('钢材A', 3500.00, '2024-07-01');

INSERT INTO suppliers (supplier_id, name) VALUES
(1, '供应商X'),
(2, '供应商Y'),
(3, '供应商Z');

INSERT INTO cost_items (item_id, name, type, budget_amount) VALUES
(1, '原材料成本', 'MATERIAL', 500000.00),
(2, '人工成本', 'LABOR', 200000.00),
(3, '制造费用', 'OVERHEAD', 150000.00),
(4, '废品损失', 'MATERIAL', 20000.00);

-- ============================================================
-- 场景 1：退货率异常 - 订单数据
-- ============================================================

-- 产品线A, 华东, batch_id=3（问题批次） - 前15天正常
INSERT INTO orders (order_id, product_line_id, region_id, batch_id, customer_id, order_date, status) VALUES
(1, 1, 1, 3, 101, '2024-08-01', 'COMPLETED'),
(2, 1, 1, 3, 102, '2024-08-02', 'COMPLETED'),
(3, 1, 1, 3, 103, '2024-08-03', 'COMPLETED'),
(4, 1, 1, 3, 104, '2024-08-04', 'COMPLETED'),
(5, 1, 1, 3, 105, '2024-08-05', 'COMPLETED'),
(6, 1, 1, 3, 106, '2024-08-06', 'COMPLETED'),
(7, 1, 1, 3, 107, '2024-08-07', 'COMPLETED'),
(8, 1, 1, 3, 108, '2024-08-08', 'COMPLETED'),
(9, 1, 1, 3, 109, '2024-08-09', 'COMPLETED'),
(10, 1, 1, 3, 110, '2024-08-10', 'COMPLETED'),
(11, 1, 1, 3, 111, '2024-08-11', 'COMPLETED'),
(12, 1, 1, 3, 112, '2024-08-12', 'COMPLETED'),
(13, 1, 1, 3, 113, '2024-08-13', 'COMPLETED'),
(14, 1, 1, 3, 114, '2024-08-14', 'COMPLETED'),
(15, 1, 1, 3, 115, '2024-08-15', 'COMPLETED'),
(16, 1, 1, 3, 116, '2024-08-16', 'COMPLETED'),
(17, 1, 1, 3, 117, '2024-08-17', 'COMPLETED'),
(18, 1, 1, 3, 118, '2024-08-18', 'COMPLETED'),
(19, 1, 1, 3, 119, '2024-08-19', 'COMPLETED'),
(20, 1, 1, 3, 120, '2024-08-20', 'COMPLETED'),
(21, 1, 1, 3, 121, '2024-08-21', 'COMPLETED'),
(22, 1, 1, 3, 122, '2024-08-22', 'COMPLETED'),
(23, 1, 1, 3, 123, '2024-08-23', 'COMPLETED'),
(24, 1, 1, 3, 124, '2024-08-24', 'COMPLETED'),
(25, 1, 1, 3, 125, '2024-08-25', 'COMPLETED'),
(26, 1, 1, 3, 126, '2024-08-26', 'COMPLETED'),
(27, 1, 1, 3, 127, '2024-08-27', 'COMPLETED'),
(28, 1, 1, 3, 128, '2024-08-28', 'COMPLETED'),
(29, 1, 1, 3, 129, '2024-08-29', 'COMPLETED'),
(30, 1, 1, 3, 130, '2024-08-30', 'COMPLETED'),
(31, 1, 1, 3, 131, '2024-08-31', 'COMPLETED');

-- 产品线A, 华东, batch_id=1（正常批次）
INSERT INTO orders (order_id, product_line_id, region_id, batch_id, customer_id, order_date, status) VALUES
(32, 1, 1, 1, 132, '2024-08-01', 'COMPLETED'),
(33, 1, 1, 1, 133, '2024-08-05', 'COMPLETED'),
(34, 1, 1, 1, 134, '2024-08-10', 'COMPLETED'),
(35, 1, 1, 1, 135, '2024-08-15', 'COMPLETED'),
(36, 1, 1, 1, 136, '2024-08-20', 'COMPLETED'),
(37, 1, 1, 1, 137, '2024-08-25', 'COMPLETED'),
(38, 1, 1, 1, 138, '2024-08-30', 'COMPLETED');

-- 产品线B, 华东（正常）
INSERT INTO orders (order_id, product_line_id, region_id, batch_id, customer_id, order_date, status) VALUES
(39, 2, 1, 1, 139, '2024-08-01', 'COMPLETED'),
(40, 2, 1, 1, 140, '2024-08-03', 'COMPLETED'),
(41, 2, 1, 1, 141, '2024-08-06', 'COMPLETED'),
(42, 2, 1, 1, 142, '2024-08-10', 'COMPLETED'),
(43, 2, 1, 1, 143, '2024-08-13', 'COMPLETED'),
(44, 2, 1, 1, 144, '2024-08-17', 'COMPLETED'),
(45, 2, 1, 1, 145, '2024-08-20', 'COMPLETED'),
(46, 2, 1, 1, 146, '2024-08-24', 'COMPLETED'),
(47, 2, 1, 1, 147, '2024-08-28', 'COMPLETED'),
(48, 2, 1, 1, 148, '2024-08-30', 'COMPLETED');

-- 产品线C, 华南（正常）
INSERT INTO orders (order_id, product_line_id, region_id, batch_id, customer_id, order_date, status) VALUES
(49, 3, 2, 2, 149, '2024-08-02', 'COMPLETED'),
(50, 3, 2, 2, 150, '2024-08-05', 'COMPLETED'),
(51, 3, 2, 2, 151, '2024-08-08', 'COMPLETED'),
(52, 3, 2, 2, 152, '2024-08-12', 'COMPLETED'),
(53, 3, 2, 2, 153, '2024-08-16', 'COMPLETED'),
(54, 3, 2, 2, 154, '2024-08-20', 'COMPLETED'),
(55, 3, 2, 2, 155, '2024-08-24', 'COMPLETED'),
(56, 3, 2, 2, 156, '2024-08-28', 'COMPLETED'),
(57, 3, 2, 2, 157, '2024-08-30', 'COMPLETED');

-- 场景 1：退货数据
INSERT INTO returns (return_id, order_id, return_date, return_reason, return_qty) VALUES
(1, 14, '2024-08-18', '质量问题', 1),
(2, 16, '2024-08-20', '质量问题', 1),
(3, 17, '2024-08-21', '质量问题', 1),
(4, 18, '2024-08-22', '外观瑕疵', 1),
(5, 19, '2024-08-23', '质量问题', 1),
(6, 22, '2024-08-26', '质量问题', 1),
(7, 23, '2024-08-27', '功能故障', 1),
(8, 24, '2024-08-28', '质量问题', 1),
(9, 25, '2024-08-29', '外观瑕疵', 1),
(10, 27, '2024-08-30', '质量问题', 1),
(11, 28, '2024-08-31', '功能故障', 1),
(12, 30, '2024-08-31', '质量问题', 1);

-- 正常批次零星退货
INSERT INTO returns (return_id, order_id, return_date, return_reason, return_qty) VALUES
(13, 33, '2024-08-08', '不想要了', 1),
(14, 42, '2024-08-15', '尺寸不合适', 1),
(15, 51, '2024-08-12', '不想要了', 1);

-- ============================================================
-- 场景 2：产能下降 - 工单数据
-- ============================================================

-- 产品线C(line_id=3)前14天正常
INSERT INTO work_orders (wo_id, line_id, equipment_id, planned_qty, actual_qty, work_date) VALUES
(1, 3, 1, 1200, 1180, '2024-08-01'),
(2, 3, 2, 1200, 1150, '2024-08-02'),
(3, 3, 1, 1200, 1200, '2024-08-03'),
(4, 3, 2, 1200, 1190, '2024-08-04'),
(5, 3, 1, 1200, 1170, '2024-08-05'),
(6, 3, 2, 1200, 1210, '2024-08-06'),
(7, 3, 1, 1200, 1180, '2024-08-07'),
(8, 3, 2, 1200, 1160, '2024-08-08'),
(9, 3, 1, 1200, 1200, '2024-08-09'),
(10, 3, 2, 1200, 1190, '2024-08-10'),
(11, 3, 1, 1200, 1170, '2024-08-11'),
(12, 3, 2, 1200, 1200, '2024-08-12'),
(13, 3, 1, 1200, 1180, '2024-08-13'),
(14, 3, 2, 1200, 1160, '2024-08-14'),
-- 8月15-17日冲压机-02故障
(15, 3, 2, 1200, 200, '2024-08-15'),
(16, 3, 1, 1200, 1150, '2024-08-15'),
(17, 3, 2, 1200, 150, '2024-08-16'),
(18, 3, 1, 1200, 1180, '2024-08-16'),
(19, 3, 2, 1200, 180, '2024-08-17'),
(20, 3, 1, 1200, 1160, '2024-08-17'),
-- 8月18日恢复后正常
(21, 3, 2, 1200, 1170, '2024-08-18'),
(22, 3, 1, 1200, 1190, '2024-08-19'),
(23, 3, 2, 1200, 1180, '2024-08-20');

-- 产品线A、B同期正常（对照）
INSERT INTO work_orders (wo_id, line_id, equipment_id, planned_qty, actual_qty, work_date) VALUES
(24, 1, 3, 1000, 980, '2024-08-15'),
(25, 1, 3, 1000, 1000, '2024-08-16'),
(26, 1, 3, 1000, 990, '2024-08-17'),
(27, 2, 4, 800, 780, '2024-08-15'),
(28, 2, 4, 800, 800, '2024-08-16'),
(29, 2, 4, 800, 790, '2024-08-17');

-- 设备故障日志
INSERT INTO equipment_logs (log_id, equip_id, event_type, start_time, end_time) VALUES
(1, 2, 'BREAKDOWN', '2024-08-15 02:30:00', '2024-08-17 18:00:00');

-- ============================================================
-- 场景 3：客诉上升 - 订单和客诉数据
-- ============================================================

INSERT INTO orders (order_id, product_line_id, region_id, batch_id, customer_id, order_date, status) VALUES
(101, 1, 1, 1, 201, '2024-08-01', 'COMPLETED'),
(102, 1, 2, 2, 202, '2024-08-03', 'COMPLETED'),
(103, 2, 1, 1, 203, '2024-08-05', 'COMPLETED'),
(104, 2, 3, 2, 204, '2024-08-08', 'COMPLETED'),
(105, 3, 2, 1, 205, '2024-08-10', 'COMPLETED'),
(106, 3, 4, 2, 206, '2024-08-13', 'COMPLETED'),
(107, 1, 1, 1, 207, '2024-08-15', 'COMPLETED'),
(108, 2, 3, 2, 208, '2024-08-17', 'COMPLETED'),
(109, 1, 1, 1, 209, '2024-08-18', 'COMPLETED'),
(110, 2, 2, 2, 210, '2024-08-19', 'COMPLETED'),
(111, 3, 3, 1, 211, '2024-08-20', 'COMPLETED'),
(112, 1, 4, 2, 212, '2024-08-21', 'COMPLETED'),
(113, 2, 1, 1, 213, '2024-08-22', 'COMPLETED'),
(114, 3, 2, 2, 214, '2024-08-23', 'COMPLETED'),
(115, 1, 3, 1, 215, '2024-08-24', 'COMPLETED'),
(116, 2, 4, 2, 216, '2024-08-25', 'COMPLETED'),
(117, 1, 1, 1, 217, '2024-08-27', 'COMPLETED'),
(118, 2, 2, 2, 218, '2024-08-29', 'COMPLETED'),
(119, 3, 3, 1, 219, '2024-08-30', 'COMPLETED');

-- 客诉数据
INSERT INTO complaints (complaint_id, order_id, channel_id, logistics_id, complaint_type, complaint_date) VALUES
(1, 109, 2, 3, '物流延迟', '2024-08-22'),
(2, 110, 2, 3, '物流延迟', '2024-08-23'),
(3, 111, 2, 3, '物流延迟', '2024-08-24'),
(4, 112, 2, 3, '物流延迟', '2024-08-25'),
(5, 113, 2, 3, '物流延迟', '2024-08-26'),
(6, 114, 2, 3, '包装破损', '2024-08-27'),
(7, 115, 2, 3, '物流延迟', '2024-08-28'),
(8, 116, 2, 3, '物流延迟', '2024-08-29'),
(9, 101, 2, 1, '商品问题', '2024-08-05'),
(10, 105, 2, 2, '物流延迟', '2024-08-14');

-- ============================================================
-- 场景 4：库存积压 - 采购和库存数据
-- ============================================================

INSERT INTO production_plans (plan_id, material_id, planned_qty, plan_date) VALUES
(1, 1, 300, '2024-08-01'),
(2, 2, 500, '2024-08-01'),
(3, 3, 200, '2024-08-01');

INSERT INTO purchase_orders (po_id, material_id, supplier_id, qty, order_date, expected_date) VALUES
(1, 1, 1, 900, '2024-08-01', '2024-08-10'),
(2, 2, 2, 1500, '2024-08-01', '2024-08-12'),
(3, 3, 3, 200, '2024-08-01', '2024-08-08');

INSERT INTO inventory (inv_id, material_id, qty, inbound_date) VALUES
(1, 1, 200, '2024-07-01'),
(2, 2, 300, '2024-07-01'),
(3, 3, 100, '2024-07-01'),
(4, 1, 900, '2024-08-10'),
(5, 2, 1500, '2024-08-12'),
(6, 3, 200, '2024-08-08');

-- ============================================================
-- 场景 5：成本异常
-- ============================================================

INSERT INTO raw_materials (name, unit_price, price_date) VALUES
('钢材A', 4025.00, '2024-08-01'),
('塑料粒子B', 1200.00, '2024-07-01'),
('塑料粒子B', 1200.00, '2024-08-01'),
('电子元件C', 8500.00, '2024-07-01'),
('电子元件C', 8500.00, '2024-08-01');

INSERT INTO cost_records (record_id, item_id, line_id, actual_amount, record_date) VALUES
(1, 1, 1, 575000.00, '2024-08-31'),
(2, 4, 1, 50000.00, '2024-08-31'),
(3, 2, 1, 198000.00, '2024-08-31'),
(4, 3, 1, 148000.00, '2024-08-31');

INSERT INTO defect_records (record_id, line_id, wo_id, produced_qty, defect_qty, record_date) VALUES
(1, 1, 1, 1000, 20, '2024-07-15'),
(2, 1, 24, 1000, 50, '2024-08-15'),
(3, 1, 25, 1000, 48, '2024-08-16'),
(4, 1, 26, 1000, 52, '2024-08-17');

-- ============================================================
-- 基础数据插入：运营商库
-- ============================================================

USE luban_carrier;

-- 清空已有数据（按外键依赖顺序）
DELETE FROM network_topology;
DELETE FROM alarms;
DELETE FROM ports;
DELETE FROM ip_links;
DELETE FROM transmission_segments;
DELETE FROM fiber_segments;
DELETE FROM dedicated_lines;
DELETE FROM stations;

INSERT INTO stations (station_id, name, province) VALUES
(1, '北京站', '北京'),
(2, '济南站', '山东'),
(3, '徐州站', '江苏'),
(4, '南京站', '江苏'),
(5, '上海站', '上海');

INSERT INTO dedicated_lines (line_id, name, type, src_station, dst_station, bandwidth, status) VALUES
(1, '北京-上海 OTN', 'OTN', '北京站', '上海站', '100G', 'ACTIVE'),
(2, '北京-上海 IP VPN', 'VPN', '北京站', '上海站', '10G', 'ACTIVE');

INSERT INTO fiber_segments (seg_id, line_id, src_station, dst_station, fiber_length) VALUES
(1, 1, '北京站', '济南站', 420.00),
(2, 1, '济南站', '徐州站', 320.00),
(3, 1, '徐州站', '南京站', 350.00),
(4, 1, '南京站', '上海站', 300.00);

INSERT INTO transmission_segments (seg_id, otn_line_id, src_station, dst_station, wavelength) VALUES
(1, 1, '北京站', '济南站', 'λ1'),
(2, 1, '济南站', '徐州站', 'λ1'),
(3, 1, '徐州站', '南京站', 'λ1'),
(4, 1, '南京站', '上海站', 'λ1');

INSERT INTO ip_links (link_id, vpn_line_id, src_station, dst_station, ip_prefix) VALUES
(1, 2, '北京站', '上海站', '10.0.0.0/30');

INSERT INTO ports (port_id, device_id, port_type, owner_id, owner_type) VALUES
(1, 101, 'OPTICAL', 2, 'FIBER_SEGMENT'),
(2, 102, 'OPTICAL', 2, 'TRANSMISSION_SEGMENT');

INSERT INTO network_topology (topo_id, upper_id, upper_type, lower_id, lower_type, relation_type) VALUES
(1, 1, 'OTN', 2, 'FIBER', 'CARRIED_BY'),
(2, 1, 'VPN', 1, 'OTN', 'CARRIED_BY');

INSERT INTO alarms (alarm_id, source_type, source_id, severity, alarm_type, alarm_time, clear_time, description) VALUES
(1, 'FIBER', 2, 'CRITICAL', 'RX_POWER_LOW', '2024-08-20 14:30:00', NULL, '济南站收光功率-28dBm，低于阈值-22dBm'),
(2, 'TRANSMISSION', 2, 'CRITICAL', 'OTN_LOS', '2024-08-20 14:30:05', NULL, '济南-徐州段 OTN 信号丢失'),
(3, 'IP', 1, 'MAJOR', 'BGP_DOWN', '2024-08-20 14:30:10', NULL, '北京-上海 IP VPN BGP 邻居中断');