import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ImageRejected, MAX_SIDE_PX, MAX_UPLOAD_BYTES, reencodePhoto } from "@/lib/images/reencode";

const solid = (w: number, h: number, channels: 3 | 4 = 3) => sharp({ create: { width: w, height: h, channels, background: channels === 4 ? { r: 200, g: 40, b: 40, alpha: 0.5 } : "#C03030" } });

const rejection = async (bytes: Buffer) => {
  try {
    await reencodePhoto(bytes);
  } catch (e) {
    return e instanceof ImageRejected ? e.code : `other: ${String(e)}`;
  }
  return "accepted";
};

describe("photos uploaded by an admin are re-encoded before they are stored", () => {
  it("removes the EXIF block (position, camera, software, copyright) and turns the photo upright", async () => {
    // a phone photo: landscape pixels with orientation 6 (the phone was held upright), a copyright and a software name in the EXIF
    const photo = await solid(300, 200).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Studio Secret", Software: "PhoneCam 9" } } }).toBuffer();
    const before = await sharp(photo).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);
    expect(photo.toString("latin1")).toContain("Studio Secret");

    const out = await reencodePhoto(photo);
    const after = await sharp(out.data).metadata();
    expect(after.format).toBe("webp");
    expect(out.contentType).toBe("image/webp");
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(out.data.toString("latin1")).not.toContain("Studio Secret");
    expect(out.data.toString("latin1")).not.toContain("PhoneCam");
    // turned upright: 200 wide, 300 tall
    expect([after.width, after.height]).toEqual([200, 300]);
    expect([out.width, out.height]).toEqual([200, 300]);
  });

  it("limits the longest side to 2000 px, keeps the proportions and never enlarges", async () => {
    const big = await reencodePhoto(await solid(4000, 3000).png().toBuffer());
    expect([big.width, big.height]).toEqual([MAX_SIDE_PX, 1500]);
    const portrait = await reencodePhoto(await solid(3000, 5000).jpeg().toBuffer());
    expect([portrait.width, portrait.height]).toEqual([1200, MAX_SIDE_PX]);
    const small = await reencodePhoto(await solid(320, 240).png().toBuffer());
    expect([small.width, small.height]).toEqual([320, 240]);
  });

  it("accepts JPEG, PNG, WebP and AVIF, and keeps transparency", async () => {
    for (const make of [() => solid(64, 64).jpeg(), () => solid(64, 64).png(), () => solid(64, 64).webp(), () => solid(64, 64).avif()]) {
      expect((await sharp((await reencodePhoto(await make().toBuffer())).data).metadata()).format).toBe("webp");
    }
    const withAlpha = await reencodePhoto(await solid(64, 64, 4).png().toBuffer());
    expect((await sharp(withAlpha.data).metadata()).hasAlpha).toBe(true);
  });

  it("keeps the colors (a re-encoded red swatch is still red)", async () => {
    const out = await reencodePhoto(await solid(120, 120).png().toBuffer());
    const { data } = await sharp(out.data).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0]! - 0xc0)).toBeLessThan(8);
    expect(Math.abs(data[1]! - 0x30)).toBeLessThan(8);
    expect(Math.abs(data[2]! - 0x30)).toBeLessThan(8);
  });

  it("refuses what is not a photo, whatever it is called", async () => {
    expect(await rejection(Buffer.from("<html><script>alert(1)</script></html>"))).toBe("decode");
    expect(await rejection(Buffer.from("not an image at all"))).toBe("decode");
    expect(await rejection(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'))).toMatch(/format|decode/);
    expect(await rejection((await solid(32, 32).gif().toBuffer()))).toBe("format");
    const truncated = (await solid(400, 400).jpeg().toBuffer()).subarray(0, 300);
    expect(await rejection(truncated)).toBe("decode");
  });

  it("refuses empty files and files over 10 MB, without decoding them", async () => {
    expect(await rejection(Buffer.alloc(0))).toBe("size");
    expect(await rejection(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1))).toBe("size");
  });
});
