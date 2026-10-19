// ../plugin/three-view-asset-panel/extensions/main/render-image-tool.source.mjs
import { resolve, relative, isAbsolute, extname, basename } from "node:path";

// packages/protocol-validation/src/safe-image.ts
var USER_MESSAGE_IMAGE_LIMITS = Object.freeze({
  maxBytesPerImage: 100 * 1024 * 1024,
  // Matches the 1456 edge limit the vision paths enforce: a full-HD screenshot is 2,073,600px,
  // which a round 2,000,000 rejects along with most Retina and phone captures.
  maxPixelsPerImage: 1456 * 1456,
  maxAggregateBytes: 100 * 1024 * 1024,
  maxAggregatePixels: 8e6
});
var SafeImageError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "SafeImageError";
    this.code = code;
  }
};
var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var BASE64_VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) BASE64_VALUE[BASE64.charCodeAt(i)] = i;
var typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
var typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}
function checkedLimits(input) {
  return {
    maxBytesPerImage: positiveLimit(input.maxBytesPerImage, "maxBytesPerImage"),
    maxPixelsPerImage: positiveLimit(input.maxPixelsPerImage, "maxPixelsPerImage"),
    maxAggregateBytes: positiveLimit(input.maxAggregateBytes, "maxAggregateBytes"),
    maxAggregatePixels: positiveLimit(input.maxAggregatePixels, "maxAggregatePixels")
  };
}
function u16(bytes, offset) {
  return bytes[offset] << 8 | bytes[offset + 1];
}
function u32(bytes, offset) {
  return bytes[offset] * 16777216 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}
function dimensions(width, height, maxPixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new SafeImageError("DIMENSIONS_INVALID", "image dimensions must be positive integers");
  if (width > Math.floor(maxPixels / height))
    throw new SafeImageError("PIXEL_LIMIT", "image dimensions exceed pixel limit");
  return { width, height, pixels: width * height };
}
var PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
var CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  CRC32_TABLE[index] = value >>> 0;
}
function crc32(bytes, start, end) {
  let crc = 4294967295;
  for (let offset = start; offset < end; offset += 1)
    crc = CRC32_TABLE[(crc ^ bytes[offset]) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
var BitReader = class {
  bytes;
  bitOffset = 0;
  constructor(bytes) {
    this.bytes = bytes;
  }
  read(count) {
    if (count < 0 || count > 24 || this.bitOffset + count > this.bytes.length * 8)
      throw new SafeImageError("FORMAT_INVALID", "truncated PNG deflate stream");
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const offset = this.bitOffset + bit;
      value |= (this.bytes[offset >>> 3] >>> (offset & 7) & 1) << bit;
    }
    this.bitOffset += count;
    return value;
  }
  align() {
    this.bitOffset = this.bitOffset + 7 & ~7;
  }
};
function reverseBits(value, length) {
  let reversed = 0;
  for (let bit = 0; bit < length; bit += 1) reversed = reversed << 1 | value >>> bit & 1;
  return reversed;
}
function huffman(lengths, options = {}) {
  const counts = new Uint16Array(16);
  let maxLength = 0;
  for (const length of lengths) {
    if (!Number.isInteger(length) || length < 0 || length > 15)
      throw new SafeImageError("FORMAT_INVALID", "PNG deflate tree has an invalid code length");
    if (length > 0) {
      counts[length] = counts[length] + 1;
      maxLength = Math.max(maxLength, length);
    }
  }
  if (maxLength === 0) {
    if (options.allowEmpty) return void 0;
    throw new SafeImageError("FORMAT_INVALID", "PNG deflate tree is empty");
  }
  let available = 1;
  for (let length = 1; length <= 15; length += 1) {
    available = available * 2 - counts[length];
    if (available < 0) throw new SafeImageError("FORMAT_INVALID", "PNG deflate tree is oversubscribed");
  }
  if (available > 0 && !(options.allowSingleIncomplete && maxLength === 1 && counts[1] === 1))
    throw new SafeImageError("FORMAT_INVALID", "PNG deflate tree is incomplete");
  const next = new Uint16Array(16);
  let code = 0;
  for (let length = 1; length <= 15; length += 1) {
    code = code + counts[length - 1] << 1;
    next[length] = code;
  }
  const byLength = Array.from({ length: maxLength + 1 }, () => /* @__PURE__ */ new Map());
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol];
    if (length === 0) continue;
    const canonical = next[length];
    next[length] = canonical + 1;
    byLength[length]?.set(reverseBits(canonical, length), symbol);
  }
  return { byLength, maxLength };
}
function decodeSymbol(reader, tree) {
  if (!tree) throw new SafeImageError("FORMAT_INVALID", "PNG deflate distance tree is missing");
  let code = 0;
  for (let length = 1; length <= tree.maxLength; length += 1) {
    code |= reader.read(1) << length - 1;
    const symbol = tree.byLength[length]?.get(code);
    if (symbol !== void 0) return symbol;
  }
  throw new SafeImageError("FORMAT_INVALID", "PNG deflate stream uses an invalid Huffman code");
}
var FIXED_LITERAL_LENGTHS = Array.from(
  { length: 288 },
  (_, symbol) => symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8
);
var FIXED_DISTANCE_LENGTHS = Array.from({ length: 32 }, () => 5);
var FIXED_LITERAL_TREE = huffman(FIXED_LITERAL_LENGTHS);
var FIXED_DISTANCE_TREE = huffman(FIXED_DISTANCE_LENGTHS);
var LENGTH_BASE = [
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258
];
var LENGTH_EXTRA = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0
];
var DISTANCE_BASE = [
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577
];
var DISTANCE_EXTRA = [
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13
];
var CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function dynamicTrees(reader) {
  const literalCount = reader.read(5) + 257;
  if (literalCount > 286) throw new SafeImageError("FORMAT_INVALID", "PNG deflate literal count is reserved");
  const distanceCount = reader.read(5) + 1;
  const codeLengthCount = reader.read(4) + 4;
  const codeLengths = new Array(19).fill(0);
  for (let index = 0; index < codeLengthCount; index += 1)
    codeLengths[CODE_LENGTH_ORDER[index]] = reader.read(3);
  const codeLengthTree = huffman(codeLengths);
  const lengths = [];
  while (lengths.length < literalCount + distanceCount) {
    const symbol = decodeSymbol(reader, codeLengthTree);
    if (symbol <= 15) {
      lengths.push(symbol);
      continue;
    }
    let repeat;
    let value;
    if (symbol === 16) {
      if (lengths.length === 0)
        throw new SafeImageError("FORMAT_INVALID", "PNG deflate repeats a missing code length");
      repeat = reader.read(2) + 3;
      value = lengths[lengths.length - 1];
    } else if (symbol === 17) {
      repeat = reader.read(3) + 3;
      value = 0;
    } else if (symbol === 18) {
      repeat = reader.read(7) + 11;
      value = 0;
    } else throw new SafeImageError("FORMAT_INVALID", "PNG deflate code-length symbol is invalid");
    if (lengths.length + repeat > literalCount + distanceCount)
      throw new SafeImageError("FORMAT_INVALID", "PNG deflate code lengths overflow their trees");
    for (let count = 0; count < repeat; count += 1) lengths.push(value);
  }
  if (lengths[256] === 0)
    throw new SafeImageError("FORMAT_INVALID", "PNG deflate literal tree has no end marker");
  return [
    huffman(lengths.slice(0, literalCount), { allowSingleIncomplete: true }),
    huffman(lengths.slice(literalCount), { allowEmpty: true, allowSingleIncomplete: true })
  ];
}
function inflateSink(expected, rowLengths, maxDistance) {
  const window = new Uint8Array(32768);
  let output = 0;
  let row = 0;
  let withinRow = 0;
  let adlerA = 1;
  let adlerB = 0;
  const write = (value) => {
    if (output >= expected)
      throw new SafeImageError("PIXEL_LIMIT", "PNG decompressed data exceeds its scanline bound");
    if (withinRow === 0 && value > 4)
      throw new SafeImageError("FORMAT_INVALID", "PNG scanline uses an invalid filter");
    window[output & 32767] = value;
    output += 1;
    withinRow += 1;
    adlerA = (adlerA + value) % 65521;
    adlerB = (adlerB + adlerA) % 65521;
    if (withinRow === rowLengths[row]) {
      row += 1;
      withinRow = 0;
    }
  };
  return {
    expected,
    rowLengths,
    write,
    finish: () => {
      if (output !== expected || row !== rowLengths.length || withinRow !== 0)
        throw new SafeImageError("FORMAT_INVALID", "PNG decompressed data does not match its scanlines");
    },
    adler: () => (adlerB << 16 | adlerA) >>> 0,
    produced: () => output,
    prior: (distance) => {
      if (distance < 1 || distance > Math.min(output, maxDistance))
        throw new SafeImageError("FORMAT_INVALID", "PNG deflate stream uses an invalid distance");
      return window[output - distance & 32767];
    }
  };
}
function inflateCodes(reader, literalTree, distanceTree, sink) {
  for (; ; ) {
    const symbol = decodeSymbol(reader, literalTree);
    if (symbol < 256) {
      sink.write(symbol);
      continue;
    }
    if (symbol === 256) return;
    if (symbol < 257 || symbol > 285)
      throw new SafeImageError("FORMAT_INVALID", "PNG deflate stream uses an invalid length");
    const lengthIndex = symbol - 257;
    const length = LENGTH_BASE[lengthIndex] + reader.read(LENGTH_EXTRA[lengthIndex]);
    const distanceSymbol = decodeSymbol(reader, distanceTree);
    if (distanceSymbol > 29)
      throw new SafeImageError("FORMAT_INVALID", "PNG deflate stream uses an invalid distance");
    const distance = DISTANCE_BASE[distanceSymbol] + reader.read(DISTANCE_EXTRA[distanceSymbol]);
    for (let copied = 0; copied < length; copied += 1) sink.write(sink.prior(distance));
  }
}
function inflateZlib(compressed, expected, rowLengths) {
  if (compressed.length < 6) throw new SafeImageError("FORMAT_INVALID", "PNG zlib stream is truncated");
  const cmf = compressed[0];
  const flags = compressed[1];
  if ((cmf & 15) !== 8 || cmf >>> 4 > 7 || (cmf << 8 | flags) % 31 !== 0 || (flags & 32) !== 0)
    throw new SafeImageError("FORMAT_INVALID", "PNG zlib header is invalid or unsupported");
  const deflate = compressed.subarray(2, compressed.length - 4);
  const reader = new BitReader(deflate);
  const sink = inflateSink(expected, rowLengths, 1 << (cmf >>> 4) + 8);
  let final = false;
  while (!final) {
    final = reader.read(1) === 1;
    const blockType = reader.read(2);
    if (blockType === 0) {
      reader.align();
      const length = reader.read(16);
      const inverse = reader.read(16);
      if ((length ^ 65535) !== inverse)
        throw new SafeImageError("FORMAT_INVALID", "PNG deflate stored block length is invalid");
      for (let index = 0; index < length; index += 1) sink.write(reader.read(8));
    } else if (blockType === 1) inflateCodes(reader, FIXED_LITERAL_TREE, FIXED_DISTANCE_TREE, sink);
    else if (blockType === 2) {
      const [literalTree, distanceTree] = dynamicTrees(reader);
      inflateCodes(reader, literalTree, distanceTree, sink);
    } else throw new SafeImageError("FORMAT_INVALID", "PNG deflate block type is reserved");
  }
  sink.finish();
  if (Math.ceil(reader.bitOffset / 8) !== deflate.length)
    throw new SafeImageError("FORMAT_INVALID", "PNG zlib stream has trailing compressed data");
  const expectedAdler = u32(compressed, compressed.length - 4);
  if (sink.adler() !== expectedAdler)
    throw new SafeImageError("FORMAT_INVALID", "PNG zlib checksum does not match");
}
var ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2]
];
function pngScanlines(width, height, bitDepth, colorType, interlace) {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const bitsPerPixel = channels * bitDepth;
  const rows = [];
  const passes = interlace === 0 ? [[0, 0, 1, 1]] : ADAM7;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
    const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowLength = 1 + Math.ceil(passWidth * bitsPerPixel / 8);
    if (!Number.isSafeInteger(rowLength) || !Number.isSafeInteger(rowLength * passHeight))
      throw new SafeImageError("PIXEL_LIMIT", "PNG scanline size is unsafe");
    for (let row = 0; row < passHeight; row += 1) rows.push(rowLength);
  }
  return rows;
}
function rejectCompressedAncillary(type, data) {
  if (type === "acTL" || type === "fcTL" || type === "fdAT")
    throw new SafeImageError("FORMAT_INVALID", "animated PNG chunks are not accepted");
  if (type === "zTXt" || type === "iCCP")
    throw new SafeImageError("FORMAT_INVALID", "PNG compressed ancillary chunks are not accepted");
  if (type !== "iTXt") return;
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 1 || keywordEnd > 79 || keywordEnd + 2 >= data.length || data[keywordEnd + 1] !== 0 && data[keywordEnd + 1] !== 1 || data[keywordEnd + 2] !== 0)
    throw new SafeImageError("FORMAT_INVALID", "PNG iTXt compression fields are invalid");
  if (data[keywordEnd + 1] === 1)
    throw new SafeImageError("FORMAT_INVALID", "PNG compressed ancillary chunks are not accepted");
}
function pngDimensions(bytes, maxPixels) {
  if (bytes.length < 33 || !PNG_MAGIC.every((value, index) => bytes[index] === value))
    throw new SafeImageError("FORMAT_INVALID", "invalid PNG signature or header");
  let offset = PNG_MAGIC.length;
  let size;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawData = false;
  let endedData = false;
  let sawPalette = false;
  const dataChunks = [];
  let compressedLength = 0;
  for (; ; ) {
    if (offset + 12 > bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated PNG chunk");
    const length = u32(bytes, offset);
    const dataOffset = offset + 8;
    const end = dataOffset + length + 4;
    if (!Number.isSafeInteger(end) || end > bytes.length)
      throw new SafeImageError("FORMAT_INVALID", "truncated PNG chunk data");
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset + 6] & 32) !== 0)
      throw new SafeImageError("FORMAT_INVALID", "PNG chunk type is invalid");
    if (crc32(bytes, offset + 4, dataOffset + length) !== u32(bytes, dataOffset + length))
      throw new SafeImageError("FORMAT_INVALID", `PNG ${type} CRC does not match`);
    if (!size) {
      if (type !== "IHDR" || length !== 13)
        throw new SafeImageError("FORMAT_INVALID", "PNG must begin with a complete IHDR");
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      interlace = bytes[dataOffset + 12];
      const validDepth = colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth) || colorType === 2 && [8, 16].includes(bitDepth) || colorType === 3 && [1, 2, 4, 8].includes(bitDepth) || (colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth);
      if (!validDepth || bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || interlace > 1)
        throw new SafeImageError(
          "FORMAT_INVALID",
          "PNG IHDR uses unsupported compression, filter, or interlace"
        );
      size = dimensions(u32(bytes, dataOffset), u32(bytes, dataOffset + 4), maxPixels);
    } else if (type === "IHDR")
      throw new SafeImageError("FORMAT_INVALID", "PNG contains multiple IHDR chunks");
    else if (type === "PLTE") {
      if (sawPalette || sawData || colorType === 0 || colorType === 4 || length === 0 || length % 3 !== 0 || length > 768 || colorType === 3 && length / 3 > 2 ** bitDepth)
        throw new SafeImageError("FORMAT_INVALID", "PNG palette is misplaced or invalid");
      sawPalette = true;
    } else if (type === "IDAT") {
      if (endedData) throw new SafeImageError("FORMAT_INVALID", "PNG IDAT chunks must be consecutive");
      sawData = true;
      compressedLength += length;
      dataChunks.push(bytes.subarray(dataOffset, dataOffset + length));
    } else if (sawData && type !== "IEND") endedData = true;
    rejectCompressedAncillary(type, bytes.subarray(dataOffset, dataOffset + length));
    if ((bytes[offset + 4] & 32) === 0 && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type))
      throw new SafeImageError("FORMAT_INVALID", `PNG critical chunk ${type} is unsupported`);
    if (type === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.length || colorType === 3 && !sawPalette)
        throw new SafeImageError("FORMAT_INVALID", "PNG has an invalid or non-terminal IEND");
      const compressed = new Uint8Array(compressedLength);
      let writeOffset = 0;
      for (const chunk of dataChunks) {
        compressed.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }
      const rows = pngScanlines(size.width, size.height, bitDepth, colorType, interlace);
      const expected = rows.reduce((sum, rowLength) => sum + rowLength, 0);
      if (!Number.isSafeInteger(expected))
        throw new SafeImageError("PIXEL_LIMIT", "PNG decompressed scanline size is unsafe");
      inflateZlib(compressed, expected, rows);
      return size;
    }
    offset = end;
  }
}
function isStartOfFrame(marker) {
  return marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker);
}
function jpegDimensions(bytes, maxPixels) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new SafeImageError("FORMAT_INVALID", "invalid JPEG signature");
  let offset = 2;
  let size;
  let sawScan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255) throw new SafeImageError("FORMAT_INVALID", "JPEG marker prefix is missing");
    while (offset < bytes.length && bytes[offset] === 255) offset += 1;
    if (offset >= bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated JPEG marker");
    const marker = bytes[offset++];
    if (marker === 0)
      throw new SafeImageError("FORMAT_INVALID", "unexpected stuffed byte outside JPEG scan");
    if (marker === 217) {
      if (!size || !sawScan || offset !== bytes.length)
        throw new SafeImageError("FORMAT_INVALID", "JPEG ended before image data or has trailing bytes");
      return size;
    }
    if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue;
    if (offset + 2 > bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated JPEG segment length");
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length)
      throw new SafeImageError("FORMAT_INVALID", "truncated JPEG segment");
    if (isStartOfFrame(marker)) {
      if (length < 8) throw new SafeImageError("FORMAT_INVALID", "JPEG frame header is too short");
      const found = dimensions(u16(bytes, offset + 5), u16(bytes, offset + 3), maxPixels);
      if (size && (size.width !== found.width || size.height !== found.height))
        throw new SafeImageError("FORMAT_INVALID", "JPEG frame dimensions disagree");
      size = found;
    }
    offset += length;
    if (marker !== 218) continue;
    if (!size) throw new SafeImageError("FORMAT_INVALID", "JPEG scan precedes its frame header");
    sawScan = true;
    for (; ; ) {
      if (offset >= bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated JPEG scan data");
      if (bytes[offset++] !== 255) continue;
      if (offset >= bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated JPEG scan marker");
      const markerOffset = offset - 1;
      while (offset < bytes.length && bytes[offset] === 255) offset += 1;
      if (offset >= bytes.length) throw new SafeImageError("FORMAT_INVALID", "truncated JPEG scan marker");
      const next = bytes[offset];
      if (next === 0 || next >= 208 && next <= 215) {
        offset += 1;
        continue;
      }
      offset = markerOffset;
      break;
    }
  }
  throw new SafeImageError("FORMAT_INVALID", "JPEG is missing EOI");
}
function detectedMime(bytes) {
  if (PNG_MAGIC.every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  throw new SafeImageError("FORMAT_INVALID", "image magic is neither PNG nor JPEG");
}
function inspectSafeImage(bytes, mimeType, limits) {
  if (mimeType !== "image/png" && mimeType !== "image/jpeg")
    throw new SafeImageError("MIME_MISMATCH", "declared image MIME is unsupported");
  const mime = detectedMime(bytes);
  if (mime !== mimeType)
    throw new SafeImageError("MIME_MISMATCH", "declared image MIME does not match image magic");
  const size = mime === "image/png" ? pngDimensions(bytes, limits.maxPixelsPerImage) : jpegDimensions(bytes, limits.maxPixelsPerImage);
  return Object.freeze({ bytes, mime, ...size });
}
function decodeSafeImageBytes(input, limitsInput) {
  const limits = checkedLimits(limitsInput);
  if (!(input.bytes instanceof Uint8Array) || !typedArrayByteLength)
    throw new SafeImageError("FORMAT_INVALID", "image bytes must be a Uint8Array");
  const byteLength = typedArrayByteLength.call(input.bytes);
  if (byteLength > limits.maxBytesPerImage)
    throw new SafeImageError("BYTE_LIMIT", "decoded image exceeds byte limit");
  const bytes = new Uint8Array(byteLength);
  Uint8Array.prototype.set.call(bytes, input.bytes);
  return inspectSafeImage(bytes, input.mimeType, limits);
}

// packages/protocol-validation/src/attachments.ts
var USER_MESSAGE_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 50,
  maxAggregateBytes: USER_MESSAGE_IMAGE_LIMITS.maxAggregateBytes
});

// packages/protocol-validation/src/json-data.ts
var encoder = new TextEncoder();

// ../plugin/three-view-asset-panel/extensions/main/render-image-tool.source.mjs
var MAX_BYTES = 4 * 1024 * 1024;
var MAX_PIXELS = 1456 * 1456;
var Kind = /* @__PURE__ */ Symbol.for("TypeBox.Kind");
function workspaceTool() {
  return {
    name: "three_view_workspace",
    description: "Get the authoritative AGH session workspace and render root before Blender rendering. Blender os.getcwd() is NOT the AGH workspace. Does not read files or modify anything.",
    parameters: { [Kind]: "Object", type: "object", properties: {}, required: [], additionalProperties: false },
    meta: { isReadOnly: true, isDestructive: false, isConcurrencySafe: true, isOpenWorld: true, replay: "safe", costHint: void 0, deferLoading: false, requiresApproval: "never" },
    async execute(_input, ctx) {
      const data = { cwd: ctx.cwd, renderRoot: resolve(ctx.cwd, "three-view-assets") };
      return { content: [{ type: "text", text: JSON.stringify(data) }], structured: data };
    }
  };
}
function renderImageTool() {
  return {
    name: "three_view_read_render",
    description: "Read a saved Blender PNG/JPEG render as REAL IMAGE content for visual self-review. Use after rendering; ordinary text read cannot show an image. Reads only current workspace three-view-assets directory. Call one view at a time; render at <=1456 pixels per edge and <=4 MiB. The returned image is available to this same AGH model; compare it to original references before modifying.",
    parameters: { [Kind]: "Object", type: "object", properties: { path: { [Kind]: "String", type: "string", maxLength: 1024, description: "Absolute path or workspace-relative three-view-assets/.../front.png" }, view: { [Kind]: "String", type: "string", enum: ["front", "side", "back", "perspective"] } }, required: ["path", "view"], additionalProperties: false },
    meta: { isReadOnly: true, isDestructive: false, isConcurrencySafe: true, isOpenWorld: true, replay: "safe", costHint: void 0, deferLoading: false, requiresApproval: "never" },
    async execute(input, ctx) {
      try {
        if (!input || typeof input.path !== "string" || !["front", "side", "back", "perspective"].includes(input.view)) throw new Error("path and view required");
        const root = resolve(ctx.cwd, "three-view-assets");
        const path = resolve(ctx.cwd, input.path);
        const local = relative(root, path);
        if (!local || local === ".." || local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(local)) throw new Error("Render must be under current workspace three-view-assets. Select the asset workspace in AGH.");
        const ext = extname(path).toLowerCase();
        if (![".png", ".jpg", ".jpeg"].includes(ext)) throw new Error("Only PNG/JPEG render files are allowed");
        const segments = local.split(/[\\/]/);
        let directory = root;
        for (const segment of [".", ...segments.slice(0, -1)]) {
          if (segment !== ".") directory = resolve(directory, segment);
          const folder = await ctx.fs.stat(directory);
          if (folder.kind !== "dir") throw new Error("Render directory must be a regular directory, not a link");
        }
        const stat = await ctx.fs.stat(path);
        if (stat.kind !== "file" || stat.size < 1 || stat.size > MAX_BYTES) throw new Error("Render is missing, not a regular file, or exceeds 4 MiB");
        ctx.signal.throwIfAborted();
        const bytes = await ctx.fs.read(path);
        const image = decodeSafeImageBytes({ bytes, mimeType: ext === ".png" ? "image/png" : "image/jpeg" }, { maxBytesPerImage: MAX_BYTES, maxPixelsPerImage: MAX_PIXELS, maxAggregateBytes: MAX_BYTES, maxAggregatePixels: MAX_PIXELS });
        if (image.width > 1456 || image.height > 1456) throw new Error("Render edge exceeds 1456px; render a smaller review image");
        const ref = await ctx.artifacts.put(image.bytes, { mime: image.mime, name: `render-${input.view}-${basename(path)}` });
        const file = basename(local);
        const referenceCopy = /(?:^|[\\/])(?:reference|references)[\\/]/i.test(local) || /^r\d+[_-]/i.test(file) || /^(?:target|original|source)[_-]/i.test(file);
        const kind = referenceCopy ? "reference-copy" : "render";
        const note = referenceCopy ? "This is a copy of an original reference image, not a Blender render. Use it as evidence about the target; do not treat it as your own output." : "This is your actual Blender output, not the target. Inspect it visually; file existence and successful tool execution are not quality checks.";
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, view: input.view, path, kind, width: image.width, height: image.height, note }) }, { type: "image", ref, mime: image.mime }], structured: { ok: true, path, view: input.view, kind, width: image.width, height: image.height, artifact: ref } };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(error.message), next: "Fix render path/size first. Do not claim visual verification or replace images with text descriptions." }) }] };
      }
    }
  };
}
export {
  renderImageTool,
  workspaceTool
};
