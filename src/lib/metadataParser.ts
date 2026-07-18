// Pure, DOM-free metadata parsing. No `Audio`, no `URL.createObjectURL` — only
// TypedArrays / TextDecoder / atob, all of which exist inside a Web Worker.
// This lets the exact same parsing code run in scanner.ts (main thread) and
// import.worker.ts (background thread), which is what makes it possible to
// parse several files' metadata in parallel across CPU cores.

function u32be(b: Uint8Array, o: number) { return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; }
function u32le(b: Uint8Array, o: number) { return ((b[o+3]<<24)|(b[o+2]<<16)|(b[o+1]<<8)|b[o])>>>0; }
function u16be(b: Uint8Array, o: number) { return (b[o]<<8)|b[o+1]; }
function sync(b: Uint8Array, o: number) { return ((b[o]&0x7f)<<21)|((b[o+1]&0x7f)<<14)|((b[o+2]&0x7f)<<7)|(b[o+3]&0x7f); }
function lstr(b: Uint8Array, o: number, l: number) { return Array.from(b.slice(o,o+l)).map(c=>String.fromCharCode(c)).join('').replace(/\0/g,'').trim(); }
function utf8(b: Uint8Array) { return new TextDecoder('utf-8',{fatal:false}).decode(b).replace(/\0/g,'').trim(); }

// 80-bit "IEEE 754 extended" float, used by AIFF's COMM chunk for sample rate.
// JS has no native support for this format so we decode it by hand.
function readExtendedFloat80(b: Uint8Array, o: number): number {
  const sign = (b[o] & 0x80) ? -1 : 1;
  const exponent = ((b[o] & 0x7f) << 8) | b[o+1];
  // Mantissa is a 64-bit unsigned integer split across two 32-bit reads to
  // stay within safe-integer range for the sample rates we actually see.
  const hi = u32be(b, o+2);
  const lo = u32be(b, o+6);
  const mantissa = hi * Math.pow(2, 32) + lo;
  if (exponent === 0 && mantissa === 0) return 0;
  return sign * mantissa * Math.pow(2, exponent - 16383 - 63);
}

export interface Meta { title?: string; artist?: string; album?: string; duration?: number; kbps?: number; artData?: ArrayBuffer; artMime?: string; }

// ID3v2's "unsynchronisation" scheme stuffs a 0x00 byte after every 0xFF
// byte that would otherwise look like an MPEG frame sync marker (FF Ex) or
// just FF 00, so a naive MP3 player scanning for sync bits inside the tag
// doesn't get confused. Plenty of real-world taggers set this (it's the
// default in several encoders), and it has to be undone before frame
// content is used. Text frames are mostly ASCII/extended-latin and rarely
// contain the FF-then-{00,Ex} pattern, so titles/artists usually come
// through fine either way -- but a JPEG cover literally starts with
// FF D8 FF E0/E1 and is dense binary data throughout, so it's very likely
// to contain that pattern repeatedly. Leaving it un-desynced means the
// image bytes have extra 0x00s spliced in at random points and the decoded
// image is corrupt (browser <img> fails to render it, silently falling
// back to the letter-tile placeholder) even though the tag was read and
// the art frame was found.
function desync(b: Uint8Array): Uint8Array {
  let hasStuffing = false;
  for (let i = 0; i < b.length - 1; i++) { if (b[i] === 0xFF && b[i + 1] === 0x00) { hasStuffing = true; break; } }
  if (!hasStuffing) return b;
  const out = new Uint8Array(b.length);
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    out[w++] = b[i];
    if (b[i] === 0xFF && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, w);
}

function parseID3v2(buf: Uint8Array): Meta {
  if (buf[0]!==0x49||buf[1]!==0x44||buf[2]!==0x33) return {};
  const ver=buf[3]; const tagSize=sync(buf,6);
  // Header flags byte: bit 0x80 = whole tag was unsynchronised at write
  // time (applies to every frame's content, v2.3 and v2.4 alike).
  const globalUnsync = (buf[5] & 0x80) !== 0;
  const meta:Meta={}; let pos=10; const end=Math.min(10+tagSize,buf.length);
  const fl=ver===2?3:4; const hdr=fl+(ver===2?3:4)+(ver===2?0:2);
  while(pos+hdr<end) {
    const id=lstr(buf,pos,fl); if(!id||id.charCodeAt(0)<65) break;
    let sz: number;
    if(ver===2) sz=(buf[pos+3]<<16)|(buf[pos+4]<<8)|buf[pos+5];
    else if(ver===4) sz=sync(buf,pos+4);
    else sz=u32be(buf,pos+4);
    const ds=pos+hdr; const de=ds+sz;
    if(sz<=0||de>end) break;
    // v2.4 also allows a *per-frame* unsynchronisation flag (independent of
    // the tag-level one) plus an optional 4-byte "data length indicator"
    // prefix that some encoders always emit alongside it -- skip that
    // prefix (it describes the post-desync length, which we don't need
    // since desync() recomputes it) so it doesn't get parsed as content.
    const flags2 = ver===4 ? buf[pos+hdr-1] : 0;
    const frameUnsync = globalUnsync || (flags2 & 0x02) !== 0;
    const hasDataLenIndicator = ver===4 && (flags2 & 0x01) !== 0;
    const raw = buf.slice(hasDataLenIndicator ? ds+4 : ds, de);
    const data = frameUnsync ? desync(raw) : raw;
    const enc=data[0]; const tb=data.slice(1);
    const rt=()=>{
      // ID3v2 text encoding byte: 1 = UTF-16 with a BOM (endianness given by
      // the BOM itself), 2 = UTF-16BE with NO BOM (v2.4 only). Decoding both
      // with the same 'utf-16' decoder is wrong for encoding 2: with no BOM
      // present, TextDecoder('utf-16') silently assumes little-endian, which
      // swaps every byte pair of genuinely big-endian data. That doesn't
      // throw -- it just produces different, wrong Unicode code points
      // (often landing in the CJK range), which is why a mis-tagged file
      // shows up with its title/artist rendered as unrelated foreign
      // characters instead of an error. 'unicodefffe' is the label the
      // WHATWG Encoding spec defines for UTF-16BE and is what every browser
      // implements it under.
      if(enc===1){try{return new TextDecoder('utf-16').decode(tb).replace(/\0/g,'').trim();}catch{return '';}}
      if(enc===2){try{return new TextDecoder('unicodefffe').decode(tb).replace(/\0/g,'').trim();}catch{return '';}}
      if(enc===3) return utf8(tb);
      return lstr(tb,0,tb.length);
    };
    if(id==='TIT2'||id==='TT2') meta.title=rt();
    else if(id==='TPE1'||id==='TP1') meta.artist=rt();
    else if(id==='TALB'||id==='TAL') meta.album=rt();
    else if(id==='APIC'||id==='PIC'){
      try{
        let me=1; while(me<data.length&&data[me]!==0)me++;
        const mime=lstr(data,1,me-1)||'image/jpeg';
        // BUG FIX (corrupted/undecodable embedded art): the byte right after
        // the mime type is the picture-type byte, then a free-text
        // "description" string, then the raw image bytes. That description
        // is encoded per the frame's own `enc` byte (same as the title/
        // artist text above) -- and taggers commonly write it as UTF-16
        // (enc 1/2), same as they do for TIT2/TPE1. A UTF-16 string's null
        // terminator is TWO 0x00 bytes, not one, and can't be found by
        // scanning for a single 0x00: any ASCII character in UTF-16LE (e.g.
        // "cover" -> 63 00 6f 00 76 00 65 00 72 00 00 00) already contains
        // plenty of lone 0x00 bytes. Scanning for a single 0x00 terminator
        // regardless of encoding stops after the very first character,
        // leaving the back half of the description sitting right before
        // the real image bytes -- so what got stored as "image data" was a
        // handful of leftover description bytes glued onto the front of an
        // otherwise-valid JPEG/PNG, which no decoder can make sense of.
        // Text frames (TIT2 etc, handled by `rt()` above) never hit this
        // because they don't have a separate description field to skip
        // over in the first place.
        let ds2=me+2;
        if(enc===1||enc===2){
          while(ds2+1<data.length&&!(data[ds2]===0&&data[ds2+1]===0))ds2+=2;
          ds2 = ds2+1<data.length ? ds2+2 : data.length;
        } else {
          while(ds2<data.length&&data[ds2]!==0)ds2++; ds2++;
        }
        const pic=data.slice(ds2);
        if(pic.length>100){meta.artData=pic.buffer.slice(pic.byteOffset,pic.byteOffset+pic.byteLength);meta.artMime=mime;}
      }catch{ /* best-effort: fall through to already-computed value */ }
    }
    pos=de;
  }
  return meta;
}

function parseID3v1(buf: Uint8Array): Meta {
  if(buf.length<128) return {};
  const t=buf.slice(buf.length-128);
  if(lstr(t,0,3)!=='TAG') return {};
  return {title:lstr(t,3,30)||undefined,artist:lstr(t,33,30)||undefined,album:lstr(t,63,30)||undefined};
}

function parseVorbis(buf: Uint8Array, o: number): Meta {
  const meta:Meta={};
  try{
    const vl=u32le(buf,o); let p=o+4+vl; const cc=u32le(buf,p); p+=4;
    for(let i=0;i<cc&&p<buf.length;i++){
      const l=u32le(buf,p); p+=4;
      const c=new TextDecoder().decode(buf.slice(p,p+l)); p+=l;
      const eq=c.indexOf('='); if(eq<0) continue;
      const k=c.slice(0,eq).toLowerCase(); const v=c.slice(eq+1).trim();
      if(k==='title') meta.title=v;
      else if(k==='artist') meta.artist=v;
      else if(k==='album') meta.album=v;
      else if(k==='metadata_block_picture'){
        try{
          const pb=Uint8Array.from(atob(v),c2=>c2.charCodeAt(0));
          let pp=4; const ml=u32be(pb,pp);pp+=4;
          const mime=lstr(pb,pp,ml);pp+=ml;
          const dl=u32be(pb,pp);pp+=4+dl+16;
          const rl=u32be(pb,pp);pp+=4;
          const img=pb.slice(pp,pp+rl);
          if(img.length>100){meta.artData=img.buffer.slice(img.byteOffset,img.byteOffset+img.byteLength);meta.artMime=mime;}
        }catch{ /* best-effort: fall through to already-computed value */ }
      }
    }
  }catch{ /* best-effort: fall through to already-computed value */ }
  return meta;
}

function parseFlac(buf: Uint8Array, fileSize: number): Meta {
  if(buf[0]!==0x66||buf[1]!==0x4c||buf[2]!==0x61||buf[3]!==0x43) return {};
  let pos=4; const meta:Meta={};
  while(pos+4<buf.length){
    const b0=buf[pos]; const last=(b0&0x80)!==0; const type=b0&0x7f;
    const len=(buf[pos+1]<<16)|(buf[pos+2]<<8)|buf[pos+3]; pos+=4;
    if(type===0&&len>=18){
      const sr=((buf[pos+10]<<12)|(buf[pos+11]<<4)|(buf[pos+12]>>4))&0xfffff;
      const totalSamples=((buf[pos+13]&0xf)<<32)|(u32be(buf,pos+14));
      if(sr>0&&totalSamples>0) meta.duration=totalSamples/sr;
      if(meta.duration&&meta.duration>0) meta.kbps=Math.round((fileSize*8)/(meta.duration*1000));
    }
    if(type===4) Object.assign(meta,parseVorbis(buf,pos));
    else if(type===6){
      try{
        let p=pos; const pt=u32be(buf,p); p+=4;
        if(pt===3||pt===0){
          const ml=u32be(buf,p); p+=4; const mime=lstr(buf,p,ml); p+=ml;
          const dl=u32be(buf,p); p+=4+dl+16;
          const rl=u32be(buf,p); p+=4;
          const img=buf.slice(p,p+rl);
          if(img.length>100){meta.artData=img.buffer.slice(img.byteOffset,img.byteOffset+img.byteLength);meta.artMime=mime;}
        }
      }catch{ /* best-effort: fall through to already-computed value */ }
    }
    pos+=len; if(last) break;
  }
  return meta;
}

// Handles both Ogg Vorbis and Ogg Opus streams. The two codecs share the Ogg
// container and the same trailing "comment header" layout (title/artist/
// METADATA_BLOCK_PICTURE), but differ in:
//  - the magic string on the identification header ("\x01vorbis" vs "OpusHead")
//  - where the comment header's payload starts (7 bytes in vs 8 bytes in)
//  - how a granule position converts to seconds: Vorbis divides by the
//    stream's own sample rate, but the Opus spec fixes the granule-position
//    clock at 48kHz regardless of the input sample rate, so using the header
//    sample rate for Opus would give a wrong (usually much longer) duration.
function parseOgg(buf: Uint8Array, fileSize: number): Meta {
  let pos=0; const pages:Uint8Array[]=[]; let lastGranule=0; let sampleRate=0; let isOpus=false;
  while(pos+27<buf.length){
    if(buf[pos]!==0x4f||buf[pos+1]!==0x67||buf[pos+2]!==0x67||buf[pos+3]!==0x53) break;
    const granule=Number(BigInt(u32le(buf,pos+6))|(BigInt(u32le(buf,pos+10))<<BigInt(32)));
    if(granule>0&&granule<0x7fffffff) lastGranule=granule;
    const segs=buf[pos+26]; const lt=buf.slice(pos+27,pos+27+segs);
    const dl=Array.from(lt).reduce((a,b)=>a+b,0); const ds=pos+27+segs;
    if(pages.length<3) pages.push(buf.slice(ds,ds+dl));
    pos=ds+dl;
  }
  const meta:Meta={};
  for(const pg of pages){
    if(pg[0]===0x01&&pg[1]===0x76){ // "\x01vorbis" identification header
      sampleRate=u32le(pg,12);
      const nomBitrate=(u32le(pg,16)|0)/1000;
      if(nomBitrate>0) meta.kbps=Math.round(nomBitrate);
    } else if(lstr(pg,0,8)==='OpusHead'){
      isOpus=true;
      // Input sample rate is informational only for Opus (granule clock is
      // always 48kHz), but kept in case we ever want to display it.
      sampleRate=u32le(pg,12);
    }
    if(pg[0]===0x03&&pg[1]===0x76) Object.assign(meta,parseVorbis(pg,7)); // "\x03vorbis" comment header
    else if(lstr(pg,0,8)==='OpusTags') Object.assign(meta,parseVorbis(pg,8));
  }
  const clockRate = isOpus ? 48000 : sampleRate;
  if(clockRate>0&&lastGranule>0) meta.duration=lastGranule/clockRate;
  if(!meta.kbps&&meta.duration&&meta.duration>0) meta.kbps=Math.round((fileSize*8)/(meta.duration*1000));
  return meta;
}

function parseM4a(buf: Uint8Array, fileSize: number): Meta {
  const meta:Meta={};
  const find=(d:Uint8Array,name:string,sp=0):{s:number;sz:number}|null=>{
    let p=sp;while(p+8<=d.length){const sz=u32be(d,p);const n=lstr(d,p+4,4);if(sz<8)break;if(n===name)return{s:p,sz};p+=sz;}return null;
  };
  const moov=find(buf,'moov'); if(!moov) return meta;
  const mvhd=find(buf,'mvhd',moov.s+8);
  if(mvhd){
    const version=buf[mvhd.s+8];
    const timescale=u32be(buf,mvhd.s+(version===1?28:20));
    const dur=version===1?Number(BigInt(u32be(buf,mvhd.s+32))<<BigInt(32)|BigInt(u32be(buf,mvhd.s+36))):u32be(buf,mvhd.s+24);
    if(timescale>0) meta.duration=dur/timescale;
    if(meta.duration&&meta.duration>0) meta.kbps=Math.round((fileSize*8)/(meta.duration*1000));
  }
  const udta=find(buf,'udta',moov.s+8);
  const ilst=find(buf,'ilst',(udta?.s??moov.s)+8); if(!ilst) return meta;
  const id=buf.slice(ilst.s+8,ilst.s+ilst.sz);
  const rda=(parent:Uint8Array)=>{const d=find(parent,'data');if(!d)return'';const flags=u32be(parent,d.s+8);const pl=parent.slice(d.s+16,d.s+d.sz);if(flags===13||flags===14||flags===1)return new TextDecoder().decode(pl).trim();return'';};
  const rca=(parent:Uint8Array)=>{const d=find(parent,'data');if(!d)return null;const flags=u32be(parent,d.s+8);const mime=flags===14?'image/png':'image/jpeg';const pl=parent.slice(d.s+16,d.s+d.sz);if(pl.length>100)return{data:pl,mime};return null;};
  const tags:Record<string,string>={'\xa9nam':'t','\xa9ART':'a','\xa9alb':'b',covr:'c'};
  let p=0;while(p+8<=id.length){const sz=u32be(id,p);if(sz<8)break;
    const k=Array.from(id.slice(p+4,p+8)).map(b=>String.fromCharCode(b)).join('');
    const atom=id.slice(p+8,p+sz);const f=tags[k];
    if(f==='t')meta.title=rda(atom);
    else if(f==='a')meta.artist=rda(atom);
    else if(f==='b')meta.album=rda(atom);
    else if(f==='c'){const r=rca(atom);if(r){meta.artData=r.data.buffer.slice(r.data.byteOffset,r.data.byteOffset+r.data.byteLength);meta.artMime=r.mime;}}
    p+=sz;
  }
  return meta;
}

const MPEG_BITRATES = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const MPEG_SR = [44100,48000,32000,0];

function parseMp3(buf: Uint8Array, fileSize: number): Meta {
  const meta = parseID3v2(buf);
  if (!meta.title && !meta.artist) Object.assign(meta, {...parseID3v1(buf), ...meta});
  let pos = 0;
  if(buf[0]===0x49&&buf[1]===0x44&&buf[2]===0x33) pos=10+sync(buf,6);
  while(pos+4<buf.length){
    if(buf[pos]===0xff&&(buf[pos+1]&0xe0)===0xe0){
      const b2=buf[pos+2];
      const brIdx=(b2>>4)&0xf;
      const srIdx=(b2>>2)&0x3;
      const bitrate=MPEG_BITRATES[brIdx]*1000;
      const sr=MPEG_SR[srIdx];
      if(!bitrate||!sr){pos++;continue;}
      const isMpeg1 = (buf[pos+1] & 0x18) === 0x18;
      const isMono = (buf[pos+3] & 0xC0) === 0xC0;
      const sideInfoLen = isMpeg1 ? (isMono ? 17 : 32) : (isMono ? 9 : 17);
      const xingOff = pos + 4 + sideInfoLen;
      if(xingOff+8<buf.length){
        const tag=lstr(buf,xingOff,4);
        if(tag==='Xing'||tag==='Info'){
          const flags=u32be(buf,xingOff+4);
          if(flags&1){
            const frames=u32be(buf,xingOff+8);
            meta.duration=frames*1152/sr;
            meta.kbps=meta.duration>0?Math.round((fileSize*8)/(meta.duration*1000)):Math.round(bitrate/1000);
            return meta;
          }
        }
        if(tag==='VBRI'){
          const vbrBitrate=u16be(buf,xingOff+10)*1000;
          const vbrFrames=u32be(buf,xingOff+14);
          meta.duration=vbrFrames*1152/sr;
          meta.kbps=Math.round(vbrBitrate/1000);
          return meta;
        }
      }
      meta.kbps=Math.round(bitrate/1000);
      meta.duration=(fileSize-pos)/(bitrate/8);
      return meta;
    }
    pos++;
  }
  return meta;
}

function parseWav(buf: Uint8Array): Meta {
  const meta:Meta={};
  if(lstr(buf,0,4)!=='RIFF'||lstr(buf,8,4)!=='WAVE') return meta;
  let pos=12;
  while(pos+8<buf.length){
    const id=lstr(buf,pos,4); const sz=u32le(buf,pos+4); pos+=8;
    if(id==='fmt '){
      const byteRate=u32le(buf,pos+8);
      meta.kbps=Math.round(byteRate*8/1000);
    } else if(id==='data'){
      const byteRate=meta.kbps?meta.kbps*1000/8:0;
      if(byteRate>0) meta.duration=sz/byteRate;
    } else if(id==='id3 '||id==='ID3 '){
      Object.assign(meta,parseID3v2(buf.slice(pos)));
    }
    pos+=sz+(sz%2);
  }
  return meta;
}

// AIFF/AIFC: big-endian "FORM"/"AIFF" container. Metadata tags (title/artist/
// album/art) aren't part of the AIFF spec itself — in practice they're stored
// as an embedded ID3v2 tag inside an 'ID3 ' chunk, same convention as WAV.
// Duration/bitrate come from the mandatory 'COMM' chunk, whose sample rate is
// encoded as an 80-bit extended float (no native JS type for that).
function parseAiff(buf: Uint8Array, fileSize: number): Meta {
  const meta:Meta={};
  if(lstr(buf,0,4)!=='FORM'||(lstr(buf,8,4)!=='AIFF'&&lstr(buf,8,4)!=='AIFC')) return meta;
  let pos=12;
  while(pos+8<buf.length){
    const id=lstr(buf,pos,4); const sz=u32be(buf,pos+4); const ds=pos+8;
    if(id==='COMM'&&sz>=18){
      const numChannels=u16be(buf,ds);
      const numFrames=u32be(buf,ds+2);
      const sampleSize=u16be(buf,ds+6);
      const sampleRate=readExtendedFloat80(buf,ds+8);
      if(sampleRate>0&&numFrames>0) meta.duration=numFrames/sampleRate;
      if(sampleRate>0) meta.kbps=Math.round((sampleRate*sampleSize*numChannels)/1000);
    } else if(id==='ID3 '||id==='id3 '){
      Object.assign(meta,parseID3v2(buf.slice(ds,ds+sz)));
    }
    pos=ds+sz+(sz%2);
  }
  if(!meta.kbps&&meta.duration&&meta.duration>0) meta.kbps=Math.round((fileSize*8)/(meta.duration*1000));
  return meta;
}

// PERF FIX (slow import of non-fast-start M4A/AAC libraries): finding the
// 'moov' atom used to mean reading the *entire* file into memory
// (file.arrayBuffer()) whenever it wasn't within the first 768KB — see the
// old comment on the m4a branch below. For a desktop library of multi-MB
// (or lossless-sized) M4A files with moov at the end, that meant copying
// the whole audio payload into memory (many GB across a real library) just
// to reach a metadata atom that's typically a few KB to a few hundred KB.
// That work happens inside the background worker, so the UI stayed
// responsive throughout -- but it dominated total wall-clock import time,
// especially for libraries produced by ffmpeg/DAWs without
// `-movflags +faststart`.
//
// MP4/M4A's top-level structure is a flat sequence of boxes
// (ftyp/free/mdat/moov/...), each starting with an 8-byte header (4-byte
// size + 4-byte type; size 1 means a 64-bit size follows in the next 8
// bytes, size 0 means "extends to EOF"). Walking that list only requires
// reading each box's header, not its content -- so we can skip straight
// over a multi-GB 'mdat' box with a single 16-byte read, and only read the
// full byte range of the *one* box we actually want ('moov') once we've
// located it. This turns a full-file read into a handful of tiny reads
// plus one read sized to just the metadata atom.
async function findTopLevelBox(file: File, name: string): Promise<{ start: number; size: number } | null> {
  let pos = 0;
  const fileSize = file.size;
  // Real files have a handful of top-level boxes (ftyp, free, mdat, moov,
  // ...); this cap just guards against a malformed/adversarial file sending
  // us into a long loop of tiny reads.
  const MAX_BOXES = 10000;
  for (let i = 0; i < MAX_BOXES && pos + 8 <= fileSize; i++) {
    const header = new Uint8Array(await file.slice(pos, Math.min(pos + 16, fileSize)).arrayBuffer());
    if (header.length < 8) break;
    let size = u32be(header, 0);
    const type = lstr(header, 4, 4);
    let headerLen = 8;
    if (size === 1) {
      if (header.length < 16) break;
      const hi = u32be(header, 8);
      const lo = u32be(header, 12);
      size = hi * Math.pow(2, 32) + lo;
      headerLen = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < headerLen || pos + size > fileSize) break; // malformed box
    if (type === name) return { start: pos, size };
    pos += size;
  }
  return null;
}

/**
 * Extracts title/artist/album/duration/bitrate/embedded-art from an audio
 * file. Reads only the first 768KB (plus, for Ogg, a small tail chunk) up
 * front since that covers the metadata for the overwhelming majority of
 * files — full-file reads only happen as a last-resort fallback so import
 * stays fast on large libraries.
 */
export async function extractMeta(file: File): Promise<Meta> {
  try {
    const headBuf = new Uint8Array(await file.slice(0, 768*1024).arrayBuffer());
    const name = file.name.toLowerCase();
    if (name.endsWith('.mp3')) {
      const meta = parseMp3(headBuf, file.size);
      // BUG FIX (missing album art on mobile-ripped/desktop libraries):
      // the ID3v2 tag sits at the start of the file, same as its text
      // frames (TIT2/TPE1/TALB) -- but the embedded cover image (APIC
      // frame) is also *inside* that same tag, and rippers commonly embed
      // full-resolution JPEGs (1-3MB+). When the declared tag size is
      // bigger than the 768KB head we read, parseID3v2()'s frame loop hits
      // the end of the buffer before it reaches APIC and just stops --
      // no error, no warning, art silently missing. (A native file-manager
      // or media player reads the whole file, so the art shows up fine
      // there, which is why this looked like "the file has art but the
      // app doesn't see it".) Fix: if the header declares a tag bigger
      // than what we read, re-read exactly that many bytes (plus a little
      // extra so the first audio frame for duration/bitrate is still in
      // range) and reparse.
      if (headBuf[0] === 0x49 && headBuf[1] === 0x44 && headBuf[2] === 0x33) {
        const declaredTagEnd = 10 + sync(headBuf, 6);
        if (declaredTagEnd > headBuf.length && declaredTagEnd < file.size) {
          try {
            const readTo = Math.min(declaredTagEnd + 4096, file.size);
            const fullBuf = new Uint8Array(await file.slice(0, readTo).arrayBuffer());
            return parseMp3(fullBuf, file.size);
          } catch { /* best-effort: fall through to already-computed value */ }
        }
      }
      return meta;
    }
    if (name.endsWith('.flac')) {
      const meta = parseFlac(headBuf, file.size);
      // Same class of bug as MP3 above: FLAC's PICTURE metadata block can
      // also carry a large embedded image and sit after other blocks, so a
      // big enough cover can push it past the 768KB head. Only worth the
      // extra read when we came up empty-handed on art.
      if (!meta.artData && headBuf.length < file.size) {
        try {
          const readTo = Math.min(6 * 1024 * 1024, file.size);
          const fullBuf = new Uint8Array(await file.slice(0, readTo).arrayBuffer());
          const fullMeta = parseFlac(fullBuf, file.size);
          if (fullMeta.artData) return fullMeta;
        } catch { /* best-effort: fall through to already-computed value */ }
      }
      return meta;
    }
    if (name.endsWith('.ogg') || name.endsWith('.opus')) {
      const tailBuf = new Uint8Array(await file.slice(-4096).arrayBuffer());
      const combined = new Uint8Array(headBuf.length + tailBuf.length);
      combined.set(headBuf); combined.set(tailBuf, headBuf.length);
      return parseOgg(combined, file.size);
    }
    if (name.endsWith('.m4a') || name.endsWith('.aac')) {
      // BUG FIX (missing album art on desktop): parseM4a() was only ever
      // given the first 768KB of the file (`headBuf`). Unlike ID3 (mp3) or
      // Vorbis comments (flac/ogg), the MP4/M4A container has no rule that
      // metadata — the 'moov' atom, which holds the 'covr' cover-art tag —
      // has to come before the audio data ('mdat'). Files that are
      // "web-optimized" / "fast-start" put moov first, but a lot of files
      // that get added to a desktop library are NOT web-optimized: e.g.
      // ffmpeg writes moov at the very end of the file by default unless
      // `-movflags +faststart` is passed, and several desktop rippers/DAWs
      // do the same. For anything but a small file, that means 'moov' (and
      // therefore the embedded artwork and title/artist tags) sits well
      // past the 768KB head we read, so parseM4a() would find no 'moov' box
      // at all and silently return {} — no art, no metadata, nothing to log
      // because nothing actually threw. Mobile-recorded/streamed clips tend
      // to be short enough that moov still lands inside 768KB even when it's
      // at the end, which is why this shows up so much more on desktop
      // libraries with longer, non-optimized files.
      //
      // Fix: try the head chunk first (cheap, and correct for the common
      // fast-start case). If that didn't find a 'moov' box, don't fall back
      // to reading the whole file — walk the top-level box headers (a
      // handful of tiny reads) to find exactly where 'moov' lives, then
      // read only that atom. This is what made import slow for desktop
      // libraries: a multi-hundred-MB file no longer means a
      // multi-hundred-MB read just to reach a metadata atom that's usually
      // well under 1MB.
      const headMeta = parseM4a(headBuf, file.size);
      if (headMeta.artData || (headMeta.title && headMeta.artist)) return headMeta;
      if (file.size <= headBuf.length) return headMeta; // already read the whole file
      try {
        const moovBox = await findTopLevelBox(file, 'moov');
        if (moovBox) {
          const moovBuf = new Uint8Array(await file.slice(moovBox.start, moovBox.start + moovBox.size).arrayBuffer());
          const moovMeta = parseM4a(moovBuf, file.size);
          if (Object.keys(moovMeta).length > 0) return moovMeta;
        }
      } catch (e) {
        console.warn(`Album art: failed to re-scan "${file.name}" for a trailing moov atom`, e);
      }
      return headMeta;
    }
    if (name.endsWith('.wav')) return parseWav(headBuf);
    if (name.endsWith('.aiff') || name.endsWith('.aif')) return parseAiff(headBuf, file.size);
  } catch { /* best-effort: fall through to already-computed value */ }
  return {};
}
