import sharp from "sharp";
import type { MockDb } from "@/lib/db/mock";
import type { BrandKit } from "@/lib/design/types";

export async function jpeg(color: string, size = 96): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } }).jpeg().toBuffer();
}

export async function png(color: string, size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer();
}

export const KIT: BrandKit = {
  colors: { primary: "#1F4E9C", secondary: "#EAF1FB", accent: "#F59E0B", background: "#FFFFFF" },
  fonts: { headline: "sans", body: "sans" },
  style: { corners: "rounded", mode: "light", energy: "calm" },
  themeId: "clean",
  textLogo: true,
  mascot: false,
  source: "default",
};

export async function clearBrand(db: MockDb, brand: string): Promise<void> {
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.usage_events where brand_id = $1", [brand]);
    await tx.query("delete from public.backgrounds where brand_id = $1", [brand]);
    await tx.query("delete from public.photos where brand_id = $1", [brand]);
  });
}
