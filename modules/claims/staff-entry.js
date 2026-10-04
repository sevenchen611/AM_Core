import fs from 'node:fs';
const template=fs.readFileSync(new URL('./staff-entry.html',import.meta.url),'utf8');
export function renderStaffEntry({token='',liffId='',preview=false}={}) {
  return (preview?template.replace('<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>',''):template).replace('__STAFF_ENTRY_DATA__',JSON.stringify({token,liffId,preview}).replace(/</g,'\\u003c'));
}
