#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */

const http = require('http');

async function resetConfig() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/reset',
      method: 'GET',
      headers: {
        Cookie:
          'auth=' +
          encodeURIComponent(
            JSON.stringify({
              username: 'admin',
              role: 'admin',
              signature: 'dummy',
              timestamp: Date.now(),
            })
          ),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Configuration reset successfully');
          console.log('Response:', data);
          resolve();
        } else {
          console.error(
            '❌ Failed to reset configuration:',
            res.statusCode,
            data
          );
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Request error:', err.message);
      reject(err);
    });

    req.end();
  });
}

resetConfig()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
