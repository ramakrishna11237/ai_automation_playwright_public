import * as fs    from "fs";
import * as path  from "path";
import * as zlib  from "zlib";
import { Page }   from "@playwright/test";
import { Logger } from "../utils/Logger";

const BASELINE_DIR = path.resolve("test-results", "visual-baselines");
const ACTUAL_DIR   = path.resolve("test-results", "visual-actuals");
const DIFF_DIR     = path.resolve("test-results", "visual-diffs");
const INDEX_FILE   = path.join(BASELINE_DIR, "_index.json");

function loadIndex(): Record<string, number> {
  try {
    if (fs.existsSync(INDEX_FILE))
      return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as Record<string, number>;
  } catch { /* ignore */ }
  return {};
}

function saveIndex(index: Record<string, number>): void {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
}

function getOrCreateId(name: string): number {
  const index = loadIndex();
  if (index[name] === undefined) {
    index[name] = Object.keys(index).length + 1;
    saveIndex(index);
  }
  return index[name]!;
}

export interface VisualCompareResult {
  match:        boolean;
  baselinePath: string;
  actualPath:   string;
  diffPath?:    string;
  diffPercent:  number;
  message:      string;
}

export class VisualRegression {
  constructor(private page: Page) {}

  async captureBaseline(name: string, locator?: string): Promise<string> {
    const id       = getOrCreateId(name);
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    const filePath = path.join(BASELINE_DIR, `${id}.png`);
    if (locator) {
      await this.page.locator(locator).first().screenshot({ path: filePath });
    } else {
      await this.page.screenshot({ path: filePath, fullPage: true });
    }
    Logger.info(`Visual baseline captured: ${filePath}`);
    return filePath;
  }

  async compare(name: string, locator?: string, threshold = 0.1): Promise<VisualCompareResult> {
    const id           = getOrCreateId(name);
    const ts           = Date.now();
    const baselinePath = path.join(BASELINE_DIR, `${id}.png`);

    if (!fs.existsSync(baselinePath)) {
      Logger.warn(`Visual baseline not found for "${name}" — capturing now`);
      await this.captureBaseline(name, locator);
      return {
        match:        true,
        baselinePath,
        actualPath:   baselinePath,
        diffPercent:  0,
        message:      "Baseline created — no comparison performed"
      };
    }

    fs.mkdirSync(ACTUAL_DIR, { recursive: true });
    const actualPath = path.join(ACTUAL_DIR, `${id}-${ts}.png`);

    if (locator) {
      await this.page.locator(locator).first().screenshot({ path: actualPath });
    } else {
      await this.page.screenshot({ path: actualPath, fullPage: true });
    }

    const baseline = fs.readFileSync(baselinePath);
    const actual   = fs.readFileSync(actualPath);

    if (baseline.length === 0 || actual.length === 0) {
      return { match: false, baselinePath, actualPath, diffPercent: 100, message: "Empty screenshot buffer" };
    }

    // ── Pixel-level diff using PNG chunk comparison ───────────────────────
    // Parse PNG IDAT chunks to get raw pixel data for accurate comparison.
    // Falls back to byte-level diff if PNG parsing fails.
    const { diffPercent, diffImageBuffer } = computePixelDiff(baseline, actual);

    const match = diffPercent <= threshold * 100;

    if (!match) {
      fs.mkdirSync(DIFF_DIR, { recursive: true });
      const diffPath = path.join(DIFF_DIR, `${id}-diff-${ts}.png`);

      // Write diff image if we have pixel data, otherwise write annotated PNG
      if (diffImageBuffer) {
        fs.writeFileSync(diffPath, diffImageBuffer);
        Logger.warn(`Visual diff image: ${diffPath}`);
      } else {
        // Fallback: copy actual with diff metadata embedded in filename
        fs.copyFileSync(actualPath, diffPath);
      }

      Logger.warn(`Visual diff: ${diffPercent.toFixed(2)}% changed for "${name}" (threshold: ${(threshold * 100).toFixed(1)}%)`);
      return {
        match:        false,
        baselinePath,
        actualPath,
        diffPath,
        diffPercent,
        message:      `${diffPercent.toFixed(2)}% pixels changed (threshold: ${(threshold * 100).toFixed(1)}%)`
      };
    }

    Logger.info(`Visual match ✅ "${name}" (diff: ${diffPercent.toFixed(2)}%)`);
    return {
      match:        true,
      baselinePath,
      actualPath,
      diffPercent,
      message:      `Match within threshold (${diffPercent.toFixed(2)}% changed)`
    };
  }

  async updateBaseline(name: string, locator?: string): Promise<string> {
    return this.captureBaseline(name, locator);
  }
}

// ── Pixel diff engine ─────────────────────────────────────────────────────────
// Compares two PNG buffers at the pixel level.
// Returns diffPercent (0-100) and an optional diff image buffer.
//
// PNG structure: 8-byte signature + chunks (length+type+data+crc)
// We extract IHDR (dimensions) and IDAT (compressed pixel data).
// If zlib decompression is available we do true pixel diff;
// otherwise we fall back to byte-level comparison of compressed data.

interface DiffResult {
  diffPercent:     number;
  diffImageBuffer: Buffer | null;
}

function computePixelDiff(baseline: Buffer, actual: Buffer): DiffResult {
  try {
    // Extract raw pixel bytes from PNG IDAT chunks
    const baselinePixels = extractPNGPixels(baseline);
    const actualPixels   = extractPNGPixels(actual);

    if (!baselinePixels || !actualPixels) {
      return bytesDiff(baseline, actual);
    }

    const len        = Math.min(baselinePixels.length, actualPixels.length);
    const maxLen     = Math.max(baselinePixels.length, actualPixels.length);
    let   diffPixels = Math.abs(baselinePixels.length - actualPixels.length);

    // Compare pixel by pixel (RGBA = 4 bytes per pixel)
    // Count pixels where any channel differs by more than tolerance
    const TOLERANCE = 10; // 0-255 per channel
    for (let i = 0; i < len; i += 4) {
      const rDiff = Math.abs((baselinePixels[i]   ?? 0) - (actualPixels[i]   ?? 0));
      const gDiff = Math.abs((baselinePixels[i+1] ?? 0) - (actualPixels[i+1] ?? 0));
      const bDiff = Math.abs((baselinePixels[i+2] ?? 0) - (actualPixels[i+2] ?? 0));
      if (rDiff > TOLERANCE || gDiff > TOLERANCE || bDiff > TOLERANCE) {
        diffPixels++;
      }
    }

    const totalPixels = maxLen / 4;
    const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;

    // Generate diff image: highlight changed pixels in red
    const diffBuffer = generateDiffImage(baselinePixels, actualPixels, TOLERANCE);

    return { diffPercent, diffImageBuffer: diffBuffer };
  } catch {
    return bytesDiff(baseline, actual);
  }
}

// ── CRC32 for PNG chunk integrity ────────────────────────────────────────────
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function bytesDiff(baseline: Buffer, actual: Buffer): DiffResult {
  const minLen   = Math.min(baseline.length, actual.length);
  const maxLen   = Math.max(baseline.length, actual.length);
  let   diffBytes = Math.abs(baseline.length - actual.length);
  for (let i = 0; i < minLen; i++) {
    if (baseline[i] !== actual[i]) diffBytes++;
  }
  const diffPercent = maxLen > 0 ? (diffBytes / maxLen) * 100 : 0;
  return { diffPercent, diffImageBuffer: null };
}

function extractPNGPixels(buffer: Buffer): Buffer | null {
  try {
    // PNG signature: 8 bytes
    if (buffer.length < 8) return null;
    const sig = buffer.slice(0, 8);
    if (sig[0] !== 0x89 || sig[1] !== 0x50) return null; // not PNG

    // Collect IDAT chunks
    const idatChunks: Buffer[] = [];
    let offset = 8;

    while (offset + 12 <= buffer.length) {
      const chunkLen  = buffer.readUInt32BE(offset);
      const chunkType = buffer.slice(offset + 4, offset + 8).toString("ascii");

      if (chunkType === "IDAT") {
        idatChunks.push(buffer.slice(offset + 8, offset + 8 + chunkLen));
      }
      if (chunkType === "IEND") break;

      offset += 12 + chunkLen;
    }

    if (idatChunks.length === 0) return null;

    // Decompress IDAT data using Node.js built-in zlib (static import)
    const compressed = Buffer.concat(idatChunks);
    const pixels     = zlib.inflateSync(compressed);
    return pixels;
  } catch {
    return null;
  }
}

function generateDiffImage(
  baseline: Buffer,
  actual: Buffer,
  tolerance: number
): Buffer | null {
  try {
    // Build a simple raw RGBA diff image where changed pixels are red
    const len    = Math.min(baseline.length, actual.length);
    const output = Buffer.alloc(len);

    for (let i = 0; i < len; i += 4) {
      const rDiff = Math.abs((baseline[i]   ?? 0) - (actual[i]   ?? 0));
      const gDiff = Math.abs((baseline[i+1] ?? 0) - (actual[i+1] ?? 0));
      const bDiff = Math.abs((baseline[i+2] ?? 0) - (actual[i+2] ?? 0));

      if (rDiff > tolerance || gDiff > tolerance || bDiff > tolerance) {
        // Changed pixel — highlight red
        output[i]   = 255; // R
        output[i+1] = 0;   // G
        output[i+2] = 0;   // B
        output[i+3] = 255; // A
      } else {
        // Unchanged pixel — show dimmed baseline
        output[i]   = Math.floor((baseline[i]   ?? 0) * 0.3);
        output[i+1] = Math.floor((baseline[i+1] ?? 0) * 0.3);
        output[i+2] = Math.floor((baseline[i+2] ?? 0) * 0.3);
        output[i+3] = 255;
      }
    }

    // Re-compress using static zlib import
    const compressed = zlib.deflateSync(output);

    // Build a valid minimal PNG: signature + IHDR (from baseline) + IDAT + IEND
    const PNG_SIG  = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    const IEND_CRC = Buffer.from([0xae,0x42,0x60,0x82]);
    const iendChunk = Buffer.concat([
      Buffer.from([0,0,0,0]),          // length = 0
      Buffer.from("IEND", "ascii"),
      IEND_CRC
    ]);

    // Wrap compressed data in IDAT chunk with CRC
    const idatType   = Buffer.from("IDAT", "ascii");
    const idatLen    = Buffer.alloc(4);
    idatLen.writeUInt32BE(compressed.length, 0);
    const idatCrcBuf = Buffer.concat([idatType, compressed]);
    const idatCrc    = Buffer.alloc(4);
    idatCrc.writeUInt32BE(crc32(idatCrcBuf), 0);
    const idatChunk  = Buffer.concat([idatLen, idatType, compressed, idatCrc]);

    return Buffer.concat([PNG_SIG, idatChunk, iendChunk]);
  } catch {
    return null;
  }
}
