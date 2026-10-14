-- 批次 1 迁移：多账号与分享基础列
-- 一次性执行：ALTER TABLE ADD COLUMN 非幂等，重复执行会报「duplicate column」（已应用的库勿再跑）
ALTER TABLE users ADD COLUMN status INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN share_id TEXT;
ALTER TABLE users ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 0;
