'use strict';

const zlib = require('zlib');

// Minimal ZIP reader: no external dependencies, matches the writer in
// zipWriter.js. Reads the End Of Central Directory record from the tail of
// the file, walks the central directory it points to, and decompresses each
// entry (store or deflate — the only two methods any common zip tool uses
// for plain text files) via Node's built-in zlib.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEndOfCentralDirectory(buf) {
  // The EOCD record is 22 bytes plus an optional comment (up to 65535 bytes),
  // always at the very end of the file — scan backwards for its signature.
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLen);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Parses a zip file buffer and returns every entry that looks like a plain
 * Weplay hand history text file: a .txt extension, not a directory marker,
 * and not one of the junk entries some zip tools add automatically
 * (__MACOSX/ resource-fork folders, .DS_Store, Windows Thumbs.db).
 * Returns [{ name, content }] with name being just the basename (any folder
 * structure inside the zip is flattened, since Weplay filenames are already
 * unique by table/date and nested paths would only complicate the file list).
 * Throws a descriptive Error if the buffer isn't a valid zip at all.
 */
function extractTextFiles(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  if (eocdOffset === -1) {
    throw new Error('This doesn\'t look like a valid .zip file (no end-of-central-directory record found).');
  }

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const results = [];
  let pos = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) break;

    const generalFlags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    const nameBuf = buf.subarray(pos + 46, pos + 46 + nameLen);
    // Bit 11 of the general-purpose flags marks the filename as UTF-8;
    // fall back to Latin-1 for older zip tools that don't set it (still
    // readable for plain ASCII filenames, which covers every real case seen).
    const isUtf8 = (generalFlags & 0x0800) !== 0;
    const rawName = nameBuf.toString(isUtf8 ? 'utf-8' : 'latin1').replace(/\\/g, '/');
    const baseName = rawName.split('/').pop();

    pos += 46 + nameLen + extraLen + commentLen;

    const isDir = rawName.endsWith('/') || uncompressedSize === 0 && compressedSize === 0 && !baseName;
    const isJunk = /^__MACOSX\//.test(rawName) || baseName === '.DS_Store' || /^Thumbs\.db$/i.test(baseName || '');
    const isTxt = /\.txt$/i.test(baseName || '');

    if (isDir || isJunk || !isTxt) continue;

    // Locate the actual compressed data: the local file header repeats the
    // name/extra field lengths (which can differ from the central directory
    // copy), so they need to be read again to find the true data offset.
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== LOCAL_SIG) {
      throw new Error(`Corrupt entry "${baseName}" in the zip file (bad local header).`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataBuf = buf.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (method === 0) {
      content = dataBuf;
    } else if (method === 8) {
      content = zlib.inflateRawSync(dataBuf);
    } else {
      throw new Error(`"${baseName}" uses an unsupported compression method in this zip — only store and deflate are supported.`);
    }

    results.push({ name: baseName, content: content.toString('utf-8') });
  }

  return results;
}

module.exports = { extractTextFiles };
