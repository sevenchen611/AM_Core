import https from 'node:https';
import dns from 'node:dns/promises';
import {Readable} from 'node:stream';
export function isPublicV4(address){
  const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b]=parts;
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)
    &&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
// Pin an independently checked public address to prevent DNS rebinding and private-network fetches.
export async function publicMedia(urlValue,redirects=0){
  const url=new URL(urlValue);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||redirects>4)throw Error('archive_media_url_invalid');
  const addresses=await dns.lookup(url.hostname,{family:4,all:true});
  if(!addresses.length||addresses.some(x=>!isPublicV4(x.address)))throw Error('archive_media_private_address');
  const address=addresses[0];
  const response=await new Promise((resolve,reject)=>{
    const request=https.get(url,{lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)},resolve);
    request.on('error',reject);request.setTimeout(90000,()=>request.destroy(Error('archive_media_timeout')));
  });
  if(response.statusCode>=300&&response.statusCode<400){response.resume();if(!response.headers.location)throw Error('archive_media_redirect_invalid');
    return publicMedia(new URL(response.headers.location,url).href,redirects+1);}
  if(response.statusCode!==200){response.resume();throw Error('archive_media_http_'+response.statusCode);}
  return {stream:Readable.toWeb(response),contentType:response.headers['content-type']||'application/octet-stream',contentLength:Number(response.headers['content-length'])||0};
}
