// 驗證 undici:一個 fetch 的 response.body(ReadableStream)能否直接當另一個 fetch 的 body(duplex:'half')
import http from 'node:http';
const SIZE = 3 * 1024 * 1024; // 3MB
// Server A:吐 3MB
const a = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(Buffer.alloc(SIZE, 7)); });
// Server B:收 body,回收到幾 bytes
const b = http.createServer((req, res) => { let n = 0; req.on('data', (c) => { n += c.length; }); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ received: n })); }); });
await new Promise((r) => a.listen(0, r)); await new Promise((r) => b.listen(0, r));
const aPort = a.address().port, bPort = b.address().port;
try {
  const src = await fetch(`http://127.0.0.1:${aPort}/`);
  // 關鍵:把 src.body(下載串流)直接灌給另一個 POST,不進記憶體整包
  const up = await fetch(`http://127.0.0.1:${bPort}/`, { method: 'POST', body: src.body, duplex: 'half' });
  const j = await up.json();
  const ok = j.received === SIZE;
  console.log(`${ok ? '✅' : '❌'} 串流轉送:送 ${SIZE} bytes,對端收到 ${j.received} bytes`);
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.log('❌ duplex 串流失敗:', e.message);
  process.exitCode = 1;
} finally { a.close(); b.close(); }
