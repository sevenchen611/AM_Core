const extensions = new Map(Object.entries({
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-msvideo': '.avi',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/mpeg': '.mp3', 'audio/aac': '.aac',
  'audio/ogg': '.ogg', 'audio/amr': '.amr', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'application/pdf': '.pdf',
}));

export function normalizedMediaType(value) {
  const type=String(value||'').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)?type:'application/octet-stream';
}

export function mediaFilename(name, contentType) {
  const filename=String(name||'attachment').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180);
  // Preserve supplied extensions; recovery may know the MIME but not the author's original name.
  return /\.[a-z0-9]{1,12}$/i.test(filename)?filename:filename+(extensions.get(normalizedMediaType(contentType))||'');
}

export function asciiDownloadFilename(name) {
  const extension=String(name).match(/\.[a-z0-9]{1,12}$/i)?.[0]||'';
  return `attachment${extension.toLowerCase()}`;
}
