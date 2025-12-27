/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

// PBKDF2 配置
const SCRYPT_KEYLEN = 64; // 生成的哈希长度
const SCRYPT_COST = 16384; // CPU/内存成本参数
const SCRYPT_BLOCK_SIZE = 8; // 块大小
const SCRYPT_PARALLELIZATION = 1; // 并行化参数

/**
 * 生成随机盐值
 */
export function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 使用 scrypt 算法哈希密码
 * @param password 明文密码
 * @param salt 盐值（hex 字符串）
 * @returns 哈希后的密码（hex 字符串）
 */
export function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      {
        cost: SCRYPT_COST,
        blockSize: SCRYPT_BLOCK_SIZE,
        parallelization: SCRYPT_PARALLELIZATION,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey.toString('hex'));
      }
    );
  });
}

/**
 * 生成完整的密码哈希字符串（包含盐值）
 * 格式: $scrypt$cost$blockSize$parallelization$salt$hash
 * @param password 明文密码
 * @returns 完整的密码哈希字符串
 */
export async function createPasswordHash(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  return `$scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${hash}`;
}

/**
 * 验证密码
 * @param password 明文密码
 * @param storedHash 存储的密码哈希字符串
 * @returns 是否匹配
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    // 检查是否是新的哈希格式
    if (!storedHash.startsWith('$scrypt$')) {
      // 如果是旧格式（明文），直接比较
      // 注意：这是为了向后兼容，实际使用中应该迁移所有旧密码
      return password === storedHash;
    }

    // 解析哈希字符串
    const parts = storedHash.split('$');
    if (parts.length !== 7) {
      throw new Error('Invalid hash format');
    }

    const [, algorithm, cost, blockSize, parallelization, salt, hash] = parts;

    if (algorithm !== 'scrypt') {
      throw new Error('Unsupported hash algorithm');
    }

    // 使用相同的参数计算哈希
    const computedHash = await new Promise<string>((resolve, reject) => {
      scrypt(
        password,
        salt,
        SCRYPT_KEYLEN,
        {
          cost: parseInt(cost),
          blockSize: parseInt(blockSize),
          parallelization: parseInt(parallelization),
        },
        (err, derivedKey) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(derivedKey.toString('hex'));
        }
      );
    });

    // 使用 timing-safe equal 防止时序攻击
    const hashBuffer = Buffer.from(hash, 'hex');
    const computedBuffer = Buffer.from(computedHash, 'hex');

    return timingSafeEqual(hashBuffer, computedBuffer);
  } catch (error) {
    console.error('密码验证失败:', error);
    return false;
  }
}

/**
 * 检查密码是否为哈希格式
 * @param password 密码字符串
 * @returns 是否为哈希格式
 */
export function isHashedPassword(password: string): boolean {
  return password.startsWith('$scrypt$');
}
