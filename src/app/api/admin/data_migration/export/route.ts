/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

export async function POST(req: NextRequest) {
  try {
    // 检查存储类型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行数据迁移' },
        { status: 400 }
      );
    }

    // 验证身份和权限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导出数据）
    const config = await getConfig();
    const user = config.UserConfig.Users.find(
      (u: any) => u.username === authInfo.username
    );
    if (!user || user.role !== 'owner' || user.banned) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导出数据' },
        { status: 401 }
      );
    }
    if (!config) {
      return NextResponse.json({ error: '无法获取配置' }, { status: 500 });
    }

    // 解析请求体获取密码
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请提供加密密码' }, { status: 400 });
    }

    // 收集所有数据
    const exportData = {
      timestamp: new Date().toISOString(),
      data: {
        // 管理员配置
        adminConfig: config,
        // 所有用户数据
        userData: {} as { [username: string]: any },
      },
    };

    // 获取所有用户
    let allUsers = await db.getAllUsers();
    allUsers = Array.from(new Set(allUsers));

    // 为每个用户收集数据
    for (const username of allUsers) {
      const userData = {
        // 播放记录
        playRecords: await db.getAllPlayRecords(username),
        // 收藏夹
        favorites: await db.getAllFavorites(username),
        // 搜索历史
        searchHistory: await db.getSearchHistory(username),
        // 跳过片头片尾配置
        skipConfigs: await db.getAllSkipConfigs(username),
        // 用户密码（通过验证空密码来检查用户是否存在，然后获取密码）
        password: await getUserPassword(username),
      };

      exportData.data.userData[username] = userData;
    }

    // 覆盖站长密码
    const ownerUser = config.UserConfig.Users.find(
      (u: any) => u.role === 'owner'
    );
    if (ownerUser) {
      exportData.data.userData[ownerUser.username].password =
        await getUserPassword(ownerUser.username);
    }

    // 将数据转换为JSON字符串
    const jsonData = JSON.stringify(exportData);

    // 先压缩数据
    const compressedData = await gzipAsync(jsonData);

    // 使用提供的密码加密压缩后的数据
    const encryptedData = SimpleCrypto.encrypt(
      compressedData.toString('base64'),
      password
    );

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(
      now.getMonth() + 1
    ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(
      now.getHours()
    ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds()
    ).padStart(2, '0')}`;
    const filename = `justtv-backup-${timestamp}.dat`;

    // 返回加密的数据作为文件下载
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    console.error('数据导出失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 }
    );
  }
}

// 辅助函数：获取用户密码（通过数据库直接访问）
async function getUserPassword(username: string): Promise<string | null> {
  try {
    const storage = (db as any).storage;

    // MySQL 存储的直接访问方法
    if (storage && typeof storage.getPool === 'function') {
      const connection = await storage.getPool().getConnection();
      try {
        const [rows] = await connection.query(
          'SELECT password FROM users WHERE username = ?',
          [username]
        );
        if (rows.length > 0) {
          return rows[0].password;
        }
      } finally {
        connection.release();
      }
    }

    return null;
  } catch (error) {
    console.error(`获取用户 ${username} 密码失败:`, error);
    return null;
  }
}
