/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 生成签名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 导入密钥
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成签名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成认证Cookie（带签名）
async function generateAuthCookie(
  username: string,
  role: 'user' = 'user'
): Promise<string> {
  const authData: any = { username, role };

  // 使用环境变量PASSWORD或默认密钥
  const secret = process.env.PASSWORD || 'default-secret-key';
  const signature = await generateSignature(username, secret);
  authData.signature = signature;
  authData.timestamp = Date.now();

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    // 验证输入
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 用户名长度限制
    if (username.length < 3 || username.length > 20) {
      return NextResponse.json(
        { error: '用户名长度必须在3-20个字符之间' },
        { status: 400 }
      );
    }

    // 密码长度限制
    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码长度至少为6个字符' },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const userExists = await db.checkUserExist(username);
    if (userExists) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    // 注册用户
    await db.registerUser(username, password);

    // 注册成功后自动登录，设置认证cookie
    const response = NextResponse.json({ ok: true, message: '注册成功' });
    const cookieValue = await generateAuthCookie(username, 'user');
    const expires = new Date();
    expires.setDate(expires.getDate() + 7); // 7天过期

    response.cookies.set('auth', cookieValue, {
      path: '/',
      expires,
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    });

    return response;
  } catch (error) {
    console.error('注册接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
