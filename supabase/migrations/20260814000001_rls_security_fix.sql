-- ============================================================
-- Piflea 主网上线安全修复 — RLS 最小权限方案
-- ============================================================

-- 一、items 表 — 删除危险策略，保留公开读取
DROP POLICY IF EXISTS items_select ON items;
DROP POLICY IF EXISTS items_insert ON items;
DROP POLICY IF EXISTS items_update ON items;
DROP POLICY IF EXISTS items_delete ON items;

CREATE POLICY items_select ON items
  FOR SELECT USING (true);

-- 二、orders 表 — 启用 RLS，不创建任何 policy
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
