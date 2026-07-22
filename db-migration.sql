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

-- 刷新 schema cache（让 REST API 识别新列）
NOTIFY pgrst, 'reload schema';
