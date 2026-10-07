import crypto from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from './store.js';
import {publicMedia} from './public-media.js';

export function legacyMediaMessageId(name){
  return String(name||'').match(/^(?:image|audio|video|file|meeting|照片|圖片|語音|音訊|影片|檔案)-([0-9]{15,30})(?:\.[A-Za-z0-9]+)?$/)?.[1]||'';
}

// Old schemas stored a message and its related attachment in separate rows. Reuse
// the verified canonical copy only with explicit source-page relation evidence.
export async function archiveReference({job,canonical,drive}){
  const media=job.payload.media||{},relation=media.legacyRelation;
  const pageId=url=>String(url||'').match(/([a-f0-9]{32})(?:\?|$)/i)?.[1]?.toLowerCase()||'';
  const normalized=id=>String(id||'').replaceAll('-','').toLowerCase();
  if(!canonical||canonical.key===job.key||media.canonicalJobKey!==canonical.key||
    canonical.conversation_key!==job.conversation_key||canonical.drive_folder_id!==job.drive_folder_id||
    canonical.payload?.direction!=='incoming'||job.payload.direction!=='incoming'||
    canonical.payload?.tenantKey!==job.payload.tenantKey||canonical.result?.canonicalJobKey||
    !relation?.messagePageId||!relation?.attachmentPageId||
    pageId(job.payload.sourceUrl)!==normalized(relation.messagePageId)||
    pageId(canonical.payload.sourceUrl)!==normalized(relation.attachmentPageId)||
    (relation.match==='message-filename'&&legacyMediaMessageId(canonical.payload.legacyFileName||canonical.result?.name)!==job.payload.event?.message?.id))throw Error('archive_reference_invalid');
  if(canonical.state==='needs_source')throw Error('archive_legacy_file_missing');
  if(canonical.state!=='done'||!canonical.result?.driveId)throw Error('archive_reference_pending');
  const r=canonical.result;
  const file=await drive.verifyAttachment(r.driveId,job.drive_folder_id,{amCentralArchive:digest(canonical.key)},r.size,r.md5);
  return {canonicalJobKey:canonical.key,driveId:file.id,driveUrl:file.webViewLink,name:file.name,
    size:Number(file.size),md5:file.md5Checksum,...(r.sha256?{sha256:r.sha256}:{}),attachmentStatus:'已保存（沿用已驗證原檔）'};
}

// No format filter: arbitrary LINE file binaries use exactly the same path as images/audio/video.
export async function archiveMedia({job,drive,line,notion,fetchImpl=fetch}){
  const m=job.payload.event?.message||{},prior=job.result||{};
  const identity={amCentralArchive:digest(job.key)};
  const parent=job.drive_folder_id;
  const existing=await drive.findAttachment(parent,identity);
  if(existing){const file=await drive.verifyAttachment(existing.id,parent,identity,Number(prior.size)||0,prior.md5||'');
    return {...prior,driveId:file.id,driveUrl:file.webViewLink,name:file.name,size:Number(file.size),md5:file.md5Checksum,attachmentStatus:'已保存'};}
  let source;
  if(job.payload.media?.missingSource)throw Error('archive_legacy_file_missing');
  if(job.payload.media?.driveId&&drive.copyOriginal){
    const media=job.payload.media;
    const file=await drive.copyOriginal(media.driveId,parent,media.name,identity);
    return {driveId:file.id,driveUrl:file.webViewLink,name:file.name,size:Number(file.size),md5:file.md5Checksum,
      ...(media.md5===file.md5Checksum&&media.sha256?{sha256:media.sha256}:{}),attachmentStatus:'已保存'};
  }
  if(job.payload.media?.url){source=await publicMedia(job.payload.media.url);}
  else if(job.payload.media?.driveId){source=await drive.streamDownload(job.payload.media.driveId);source.contentType=job.payload.media.contentType||'application/octet-stream';}
  else if(job.payload.media?.notionPageId){
    const media=job.payload.media;
    const page=await notion.request('/pages/'+encodeURIComponent(media.notionPageId));
    const file=page.properties?.[media.property]?.files?.[media.index||0];
    if(file?.type!=='file'||file.name!==media.name)throw Error('archive_legacy_file_missing');
    const url=new URL(file.file.url);
    if(url.protocol!=='https:'||!/(?:^|\.)(?:amazonaws\.com|notion-static\.com|notion\.so)$/.test(url.hostname))throw Error('archive_legacy_file_host_invalid');
    const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(900000)});
    if(!r.ok)throw Error('archive_legacy_file_unavailable');
    source={stream:r.body,contentType:r.headers.get('content-type'),contentLength:Number(r.headers.get('content-length'))||0};
  }else{
    source=m.contentProvider?.type==='external'?await publicMedia(m.contentProvider.originalContentUrl):await line.streamLineContent(m.id,{tries:1,timeoutMs:900000});
  }
  const contentType=source.contentType||'application/octet-stream';
  const name=job.payload.media?.name||line.resolveLineFilename(m,m.type,m.id,contentType);
  let temporary=''; let stream=Readable.fromWeb(source.stream),size=source.contentLength||Number(m.fileSize)||0;
  const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');
  const hashing=new Transform({transform(chunk,encoding,done){sha.update(chunk);md5.update(chunk);done(null,chunk);}});
  try{
    if(!size){
      temporary=fs.mkdtempSync(path.join(os.tmpdir(),'am-archive-'));
      const filePath=path.join(temporary,'original');
      await pipeline(stream,hashing,fs.createWriteStream(filePath));
      size=fs.statSync(filePath).size;if(!size)throw Error('archive_empty_content');
      stream=fs.createReadStream(filePath);
    }else {stream.on('error',error=>hashing.destroy(error));stream=stream.pipe(hashing);}
    const uploaded=await drive.uploadStream(stream,name,contentType,parent,size,{appProperties:identity});
    const expectedMd5=md5.digest('hex'),expectedSha=sha.digest('hex');
    const file=await drive.verifyAttachment(uploaded.id,parent,identity,size,expectedMd5);
    return {driveId:file.id,driveUrl:file.webViewLink,name:file.name,size:Number(file.size),sha256:expectedSha,md5:file.md5Checksum,attachmentStatus:'已保存'};
  }finally{
    stream.destroy?.();
    // The directory is an OS-generated task-owned spool; no user path is accepted.
    if(temporary){
      const target=path.resolve(temporary),root=path.resolve(os.tmpdir());
      if(path.dirname(target)!==root||!path.basename(target).startsWith('am-archive-'))throw Error('archive_spool_path_invalid');
      fs.rmSync(target,{recursive:true,force:true});
    }
  }
}
