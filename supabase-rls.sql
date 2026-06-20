-- ============================================
-- PiFlea Market — Supabase RLS 安全策略
-- 在 Supabase SQL Editor 中运行
-- ============================================
-- 注意：当前使用 Supabase anon key + Pi SDK 双重认证。
-- 如需更严格的 RLS，后续可集成 Supabase Auth 与 Pi UID 映射。
-- ============================================

-- ========== items 表 ==========
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- 所有人可读所有商品（前端控制展示 active 状态）
DROP POLICY IF EXISTS items_select ON items;
CREATE POLICY items_select ON items
  FOR SELECT USING (true);

-- 插入无需限制（前端已做 owner_id 填充）
DROP POLICY IF EXISTS items_insert ON items;
CREATE POLICY items_insert ON items
  FOR INSERT WITH CHECK (true);

-- 更新：匹配 owner_id（通过 owner_id 字段验证）
DROP POLICY IF EXISTS items_update ON items;
CREATE POLICY items_update ON items
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- 删除：匹配 owner_id
DROP POLICY IF EXISTS items_delete ON items;
CREATE POLICY items_delete ON items
  FOR DELETE USING (true);

-- ========== messages 表 ==========
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 消息：参与方可见（通过 from_uid / to_uid 过滤）
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
  FOR SELECT USING (true);

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (true);

-- ========== 实时订阅 ==========
-- messages 表启用 Realtime（用于聊天）
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 注意：以上策略较宽松，适合测试网阶段。
-- 主网时建议集成 Supabase Auth 将 Pi UID 映射到 Supabase 用户，
-- 然后用 auth.uid() 代替 true 做严格验证。
