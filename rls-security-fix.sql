-- ============================================================
-- Piflea 主网上线安全修复 — RLS 最小权限方案
-- 生成日期：2026-08-14
-- 说明：本文件仅生成，不执行。需在 Supabase SQL Editor 中手动执行。
-- ============================================================

-- ============================================================
-- 一、items 表 — 删除危险策略，保留公开读取
-- ============================================================

-- 删除旧的宽松策略
DROP POLICY IF EXISTS items_select ON items;
DROP POLICY IF EXISTS items_insert ON items;
DROP POLICY IF EXISTS items_update ON items;
DROP POLICY IF EXISTS items_delete ON items;

-- 1. 公开读取：所有用户可读所有商品
--    （首页/搜索/详情/我的发布/收藏/管理员都需要）
CREATE POLICY items_select ON items
  FOR SELECT USING (true);

-- 2. 不创建 INSERT policy = 默认拒绝 anon/authenticated 插入
--    所有商品创建通过 Worker API /api/items/create（service_role 绕过 RLS）

-- 3. 不创建 UPDATE policy = 默认拒绝 anon/authenticated 更新
--    所有商品更新通过 Worker API（service_role 绕过 RLS）

-- 4. 不创建 DELETE policy = 默认拒绝 anon/authenticated 删除
--    所有商品删除通过 Worker API（service_role 绕过 RLS）

-- ============================================================
-- 二、orders 表 — 启用 RLS，不创建任何 policy
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 不创建任何 policy = 默认拒绝所有 anon/authenticated 操作
-- 所有订单操作通过 Worker API（service_role 绕过 RLS）：
--   - /api/approve（创建订单、更新状态）
--   - /api/complete（完成支付）
--   - /api/mark-shipped（卖家发货）
--   - /api/transfer-to-seller（A2U 转账）
--   - /api/my-orders（我的订单列表）
--   - /api/admin/*（管理员操作）

-- ============================================================
-- 三、验证 RLS 状态
-- ============================================================

-- 检查 items 表 RLS 状态
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'items';

-- 检查 orders 表 RLS 状态
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'orders';

-- 检查 items 表策略
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'items';

-- 检查 orders 表策略
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'orders';