-- Piflea Market - 数据库更新脚本
-- 在 Supabase Dashboard > SQL Editor 中执行

-- 添加物流信息字段
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_company TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_no TEXT;

-- 添加运费字段到商品表
ALTER TABLE items ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0;

-- 添加索引提升查询性能
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_status_category ON items(status, category);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);

-- 添加订单唯一编号字段
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);

-- 添加 A2U 转账字段
ALTER TABLE orders ADD COLUMN IF NOT EXISTS a2u_payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS a2u_txid TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_a2u_txid ON orders(a2u_txid);
CREATE INDEX IF NOT EXISTS idx_orders_a2u_payment_id ON orders(a2u_payment_id);

-- 添加订单金额快照字段（资金安全）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0;

-- ========== favorites 表（用户收藏关系）==========
-- 存储 user_uid (Pi 用户 UID) 与 item_id 的收藏关系
-- items.fav_count 保留为已有字段，本表为真实数据源（COUNT 聚合）
-- 不手动维护 fav_count，避免增删收藏/异常回滚导致计数不同步
-- 如后期性能需要，再增加 trigger 自动维护 fav_count
CREATE TABLE IF NOT EXISTS favorites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_uid TEXT NOT NULL,                       -- Pi 用户 UID（与 orders.buyer_id/seller_id 一致）
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_uid, item_id)                     -- 同一用户对同一商品只能收藏一次（自动建联合唯一索引）
);

-- 单列索引：支撑"按用户查收藏列表"和"按商品统计收藏数"
CREATE INDEX IF NOT EXISTS idx_favorites_user_uid ON favorites(user_uid);
CREATE INDEX IF NOT EXISTS idx_favorites_item_id ON favorites(item_id);

-- RLS 策略（与 items/messages 表风格一致，测试网阶段宽松）
-- 用户身份由 backend-worker.js 通过 Pi Authorization token 校验，不信任前端传参
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS favorites_select ON favorites;
CREATE POLICY favorites_select ON favorites
  FOR SELECT USING (true);
DROP POLICY IF EXISTS favorites_insert ON favorites;
CREATE POLICY favorites_insert ON favorites
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS favorites_delete ON favorites;
CREATE POLICY favorites_delete ON favorites
  FOR DELETE USING (true);

-- ========== reports 表（用户举报）==========
-- 存储用户对商品的举报记录
-- reporter_uid 来自 Pi token 解析，不信任前端传参
-- 不设 UNIQUE：允许同一用户对同一商品多次举报（保留举报历史）
-- 不维护 items.report_count，真实数据来自 reports 表 COUNT 聚合
-- RLS：只开放 SELECT，不开放 INSERT（仅由 Worker 用 service_role key 写入）
CREATE TABLE IF NOT EXISTS reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_uid TEXT NOT NULL,                      -- Pi 用户 UID（与 orders.buyer_id 一致）
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,                            -- 虚假描述 / 违禁品 / 涉嫌诈骗 / 其他
  detail TEXT,                                     -- 可选补充说明（Worker 限长 500）
  status TEXT NOT NULL DEFAULT 'pending',          -- pending / reviewed / dismissed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_item_id ON reports(item_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_uid ON reports(reporter_uid);

-- RLS：仅开放 SELECT（前端只读），INSERT 不开放 policy → 只能由 Worker service_role 写入
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reports_select ON reports;
CREATE POLICY reports_select ON reports FOR SELECT USING (true);

-- 刷新 schema cache（让 REST API 识别新表/新列）
NOTIFY pgrst, 'reload schema';
