-- 批次 4 迁移：补齐 schema.sql 中定义、但历史增量迁移遗漏的索引（幂等，可安全重复执行）
CREATE INDEX IF NOT EXISTS idx_users_share_id ON users(share_id);

-- 回滚：DROP INDEX IF EXISTS idx_users_share_id;
