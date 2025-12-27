#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */

const http = require('http');

async function initDefaultAdmin() {
  return new Promise((resolve, reject) => {
    // 使用 HTTP 请求调用注册 API
    const postData = JSON.stringify({
      username: 'admin',
      password: '123456',
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 409) {
          console.log('ℹ️  Admin account already exists');
          resolve();
        } else if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(
            '✅ Default admin account created: username=admin, password=123456'
          );
          resolve();
        } else {
          console.error(
            '❌ Failed to create admin account:',
            res.statusCode,
            data
          );
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (_err) => {
      // 服务器可能还没启动，忽略错误
      console.log(
        'ℹ️  Server not ready yet, will create admin on first request'
      );
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

initDefaultAdmin()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
