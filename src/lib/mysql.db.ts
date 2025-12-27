/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-var-requires */

import { AdminConfig } from './admin.types';
import {
  createPasswordHash,
  isHashedPassword,
  verifyPassword,
} from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据库连接池
let pool: any = null;

// 获取数据库连接池
function getPool(): any {
  if (!pool) {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'justtv',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: 'Z', // 使用 UTC 时区，然后在应用层转换为北京时间
      dateStrings: false, // 返回 Date 对象而不是字符串
      // 连接保活设置，避免连接被重置
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      // 连接超时设置
      connectTimeout: 10000, // 10秒连接超时
      // 空闲连接超时
      idleTimeout: 60000, // 60秒空闲超时
    });

    pool.on('connection', (_connection: any) => {
      console.log('MySQL 连接已建立');
    });

    pool.on('error', (err: any) => {
      console.error('MySQL 连接池错误:', err);
    });

    pool.on('acquire', (_connection: any) => {
      // 从连接池获取连接时
    });

    pool.on('release', (_connection: any) => {
      // 释放连接到连接池时
    });
  }
  return pool;
}

// 初始化数据库表结构
async function initDatabase(): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    // 创建用户表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(50) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 创建播放记录表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS play_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        record JSON NOT NULL,
        updated_at DATETIME,
        UNIQUE KEY unique_user_key (username, \`key\`),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 创建收藏表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        favorite JSON NOT NULL,
        updated_at DATETIME,
        UNIQUE KEY unique_user_key (username, \`key\`),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 创建搜索历史表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS search_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        created_at DATETIME,
        INDEX idx_username_created (username, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 创建跳过片头片尾配置表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS skip_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        config JSON NOT NULL,
        updated_at DATETIME,
        UNIQUE KEY unique_user_key (username, \`key\`),
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    // 创建管理员配置表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admin_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        config JSON NOT NULL,
        updated_at DATETIME
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ MySQL 数据库表结构初始化完成');

    // 初始化默认管理员账号
    await initDefaultAdmin(connection);
  } finally {
    connection.release();
  }
}

// 初始化默认管理员账号
async function initDefaultAdmin(connection: any): Promise<void> {
  try {
    // 检查管理员账号是否已存在
    const [rows] = await connection.query(
      'SELECT username, role, password FROM users WHERE username = ?',
      ['admin']
    );

    if (rows.length === 0) {
      // 插入默认管理员账号，角色设置为 owner，密码使用哈希
      const hashedPassword = await createPasswordHash('admin123');
      await connection.execute(
        'INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00"))',
        ['admin', hashedPassword, 'owner']
      );
      console.log(
        '✅ 默认管理员账号已创建: username=admin, password=admin123, role=owner'
      );
    } else {
      // 如果admin用户存在但角色不是owner，更新为owner
      if (rows[0].role !== 'owner') {
        await connection.execute(
          'UPDATE users SET role = ? WHERE username = ?',
          ['owner', 'admin']
        );
        console.log('✅ 管理员角色已更新为 owner');
      } else {
        console.log('ℹ️  管理员账号已存在 (角色: owner)');
      }

      // 检查密码是否已经是哈希格式，如果不是则更新
      if (!isHashedPassword(rows[0].password)) {
        const hashedPassword = await createPasswordHash('admin123');
        await connection.execute(
          'UPDATE users SET password = ? WHERE username = ?',
          [hashedPassword, 'admin']
        );
        console.log('✅ 管理员密码已更新为哈希格式');
      }
    }
  } catch (error) {
    console.error('初始化管理员账号失败:', error);
  }
}

// MySQL 存储实现
export class MySQLStorage implements IStorage {
  constructor() {
    // 初始化数据库表
    initDatabase().catch((err) => {
      console.error('数据库初始化失败:', err);
    });
  }

  // ---------- 播放记录 ----------
  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT record FROM play_records WHERE username = ? AND `key` = ?',
        [userName, key]
      );
      if (rows.length === 0) return null;
      // MySQL JSON 类型返回的可能是对象，也可能是字符串
      const record = rows[0].record;
      return typeof record === 'string'
        ? (JSON.parse(record) as PlayRecord)
        : (record as PlayRecord);
    } finally {
      connection.release();
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'INSERT INTO play_records (username, `key`, record, updated_at) VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")) ON DUPLICATE KEY UPDATE record = VALUES(record), updated_at = CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")',
        [userName, key, JSON.stringify(record)]
      );
    } finally {
      connection.release();
    }
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT `key`, record FROM play_records WHERE username = ?',
        [userName]
      );
      const result: { [key: string]: PlayRecord } = {};
      for (const row of rows as any[]) {
        // MySQL JSON 类型返回的可能是对象，也可能是字符串
        const record = row.record;
        result[row.key as string] =
          typeof record === 'string'
            ? (JSON.parse(record) as PlayRecord)
            : (record as PlayRecord);
      }
      return result;
    } finally {
      connection.release();
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'DELETE FROM play_records WHERE username = ? AND `key` = ?',
        [userName, key]
      );
    } finally {
      connection.release();
    }
  }

  // ---------- 收藏 ----------
  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT favorite FROM favorites WHERE username = ? AND `key` = ?',
        [userName, key]
      );
      if (rows.length === 0) return null;
      // MySQL JSON 类型返回的可能是对象，也可能是字符串
      const favorite = rows[0].favorite;
      return typeof favorite === 'string'
        ? (JSON.parse(favorite) as Favorite)
        : (favorite as Favorite);
    } finally {
      connection.release();
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'INSERT INTO favorites (username, `key`, favorite, updated_at) VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")) ON DUPLICATE KEY UPDATE favorite = VALUES(favorite), updated_at = CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")',
        [userName, key, JSON.stringify(favorite)]
      );
    } finally {
      connection.release();
    }
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT `key`, favorite FROM favorites WHERE username = ?',
        [userName]
      );
      const result: { [key: string]: Favorite } = {};
      for (const row of rows as any[]) {
        // MySQL JSON 类型返回的可能是对象，也可能是字符串
        const favorite = row.favorite;
        result[row.key as string] =
          typeof favorite === 'string'
            ? (JSON.parse(favorite) as Favorite)
            : (favorite as Favorite);
      }
      return result;
    } finally {
      connection.release();
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'DELETE FROM favorites WHERE username = ? AND `key` = ?',
        [userName, key]
      );
    } finally {
      connection.release();
    }
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      // 使用密码哈希存储
      const hashedPassword = await createPasswordHash(password);
      await connection.execute(
        'INSERT INTO users (username, password, created_at) VALUES (?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00"))',
        [userName, hashedPassword]
      );
    } finally {
      connection.release();
    }
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT password FROM users WHERE username = ?',
        [userName]
      );
      if (rows.length === 0) return false;
      // 使用密码验证函数
      return await verifyPassword(password, rows[0].password);
    } finally {
      connection.release();
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT COUNT(*) as count FROM users WHERE username = ?',
        [userName]
      );
      return (rows[0].count as number) > 0;
    } finally {
      connection.release();
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      // 使用密码哈希存储新密码
      const hashedPassword = await createPasswordHash(newPassword);
      await connection.execute(
        'UPDATE users SET password = ? WHERE username = ?',
        [hashedPassword, userName]
      );
    } finally {
      connection.release();
    }
  }

  async deleteUser(userName: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      try {
        // 删除用户
        await connection.execute('DELETE FROM users WHERE username = ?', [
          userName,
        ]);
        // 删除播放记录
        await connection.execute(
          'DELETE FROM play_records WHERE username = ?',
          [userName]
        );
        // 删除收藏
        await connection.execute('DELETE FROM favorites WHERE username = ?', [
          userName,
        ]);
        // 删除搜索历史
        await connection.execute(
          'DELETE FROM search_history WHERE username = ?',
          [userName]
        );
        // 删除跳过片头片尾配置
        await connection.execute(
          'DELETE FROM skip_configs WHERE username = ?',
          [userName]
        );
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      }
    } finally {
      connection.release();
    }
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ?',
        [userName, SEARCH_HISTORY_LIMIT]
      );
      return rows.map((row: any) => row.keyword as string);
    } finally {
      connection.release();
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      // 先删除旧的相同关键词
      await connection.execute(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?',
        [userName, keyword]
      );
      // 插入新的
      await connection.execute(
        'INSERT INTO search_history (username, keyword, created_at) VALUES (?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00"))',
        [userName, keyword]
      );
      // 限制数量 - 查询需要保留的 ID，然后删除其他记录
      const [rows] = await connection.query(
        `SELECT id FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT ${SEARCH_HISTORY_LIMIT}`,
        [userName]
      );
      const idsToKeep = (rows as any[]).map((row) => row.id);

      if (idsToKeep.length > 0) {
        // 使用 query 方法直接执行 SQL，避免 prepared statement 的参数化问题
        const idsString = idsToKeep.join(',');
        await connection.query(
          `DELETE FROM search_history WHERE username = ? AND id NOT IN (${idsString})`,
          [userName]
        );
      }
    } finally {
      connection.release();
    }
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      if (keyword) {
        await connection.execute(
          'DELETE FROM search_history WHERE username = ? AND keyword = ?',
          [userName, keyword]
        );
      } else {
        await connection.execute(
          'DELETE FROM search_history WHERE username = ?',
          [userName]
        );
      }
    } finally {
      connection.release();
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query('SELECT username FROM users');
      return rows.map((row: any) => row.username as string);
    } finally {
      connection.release();
    }
  }

  // 获取全部用户及其角色
  async getAllUsersWithRole(): Promise<
    Array<{ username: string; role?: string }>
  > {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query('SELECT username, role FROM users');
      return rows.map((row: any) => ({
        username: row.username as string,
        role: row.role as string | undefined,
      }));
    } finally {
      connection.release();
    }
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT config FROM admin_config ORDER BY updated_at DESC LIMIT 1'
      );
      if (rows.length === 0) return null;
      // MySQL JSON 类型查询出来已经是对象，不需要再 parse
      const config = rows[0].config;
      // 如果是字符串才需要 parse，否则直接返回
      return typeof config === 'string' ? JSON.parse(config) : config;
    } finally {
      connection.release();
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      // 先检查是否存在配置记录
      const [rows] = await connection.query(
        'SELECT id FROM admin_config LIMIT 1'
      );

      if (rows.length === 0) {
        // 如果不存在，插入新记录
        await connection.execute(
          'INSERT INTO admin_config (config, updated_at) VALUES (?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00"))',
          [JSON.stringify(config)]
        );
      } else {
        // 如果存在，更新第一条记录
        await connection.execute(
          'UPDATE admin_config SET config = ?, updated_at = CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00") WHERE id = ?',
          [JSON.stringify(config), rows[0].id]
        );
      }
    } finally {
      connection.release();
    }
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const key = `${source}+${id}`;
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT config FROM skip_configs WHERE username = ? AND `key` = ?',
        [userName, key]
      );
      if (rows.length === 0) return null;
      // MySQL JSON 类型返回的可能是对象，也可能是字符串
      const config = rows[0].config;
      return typeof config === 'string'
        ? (JSON.parse(config) as SkipConfig)
        : (config as SkipConfig);
    } finally {
      connection.release();
    }
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    const key = `${source}+${id}`;
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'INSERT INTO skip_configs (username, `key`, config, updated_at) VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")) ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = CONVERT_TZ(UTC_TIMESTAMP(), "+00:00", "+08:00")',
        [userName, key, JSON.stringify(config)]
      );
    } finally {
      connection.release();
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = `${source}+${id}`;
    const connection = await getPool().getConnection();
    try {
      await connection.execute(
        'DELETE FROM skip_configs WHERE username = ? AND `key` = ?',
        [userName, key]
      );
    } finally {
      connection.release();
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const connection = await getPool().getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT `key`, config FROM skip_configs WHERE username = ?',
        [userName]
      );
      const result: { [key: string]: SkipConfig } = {};
      for (const row of rows as any[]) {
        // MySQL JSON 类型返回的可能是对象，也可能是字符串
        const config = row.config;
        result[row.key as string] =
          typeof config === 'string'
            ? (JSON.parse(config) as SkipConfig)
            : (config as SkipConfig);
      }
      return result;
    } finally {
      connection.release();
    }
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      try {
        await connection.execute('DELETE FROM users');
        await connection.execute('DELETE FROM play_records');
        await connection.execute('DELETE FROM favorites');
        await connection.execute('DELETE FROM search_history');
        await connection.execute('DELETE FROM skip_configs');
        await connection.execute('DELETE FROM admin_config');
        await connection.commit();
        console.log('所有数据已清空');
      } catch (err) {
        await connection.rollback();
        throw err;
      }
    } finally {
      connection.release();
    }
  }
}
