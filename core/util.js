// AM Platform core — 共用小工具(無外部相依)
// 從 BuildAM src/server.js 的 HTTP 基礎/Notion 小工具原封抽出,供整個 core 共用。

// Notion / 群組 ID 正規化:去掉連字號、轉小寫,供資料隔離比對。
export function normalizeId(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

// Notion rich_text / title 用的文字片段。
export function textItem(content) {
  return { type: 'text', text: { content: String(content) } };
}

// LINE 訊息類型 → 中文標籤(與 BuildAM 一致,另加 audio)。
export function mapMessageType(type) {
  return { text: '文字', image: '照片', file: '檔案', sticker: '貼圖', audio: '語音' }[type] || '其他';
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// 讀取整個 request body 為 UTF-8 字串(LINE 簽章驗證需要原始 body)。
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// snake_UPPER 環境變數尾段 → camelCase 資料源鍵(WORK_ITEMS → workItems)。
export function camelFromEnv(snakeUpper) {
  return String(snakeUpper).toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
