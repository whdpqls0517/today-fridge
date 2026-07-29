"use strict";

require("dotenv").config({ quiet: true });
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function decode(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!match) return null;
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return {
    contentType: match[1],
    extension: extensions[match[1]],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function main() {
  const { data: products, error } = await client.from("products").select("id,images");
  if (error) throw error;
  let migratedProducts = 0;
  let migratedImages = 0;

  for (const product of products || []) {
    const images = Array.isArray(product.images) ? product.images : [];
    let changed = false;
    const nextImages = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const decoded = decode(image);
      if (!decoded) {
        nextImages.push(image);
        continue;
      }
      const fingerprint = crypto.createHash("sha1").update(decoded.buffer).digest("hex").slice(0, 12);
      const path = `legacy/${product.id}/${index + 1}-${fingerprint}.${decoded.extension}`;
      const { error: uploadError } = await client.storage
        .from("product-images")
        .upload(path, decoded.buffer, {
          contentType: decoded.contentType,
          cacheControl: "31536000",
          upsert: true
        });
      if (uploadError) throw uploadError;
      const { data: publicData } = client.storage.from("product-images").getPublicUrl(path);
      if (!publicData?.publicUrl) throw new Error(`이미지 공개 URL 생성 실패: ${product.id}`);
      nextImages.push(publicData.publicUrl);
      changed = true;
      migratedImages += 1;
    }

    if (changed) {
      const { error: updateError } = await client.from("products")
        .update({ images: nextImages })
        .eq("id", product.id);
      if (updateError) throw updateError;
      migratedProducts += 1;
    }
  }

  console.log(`상품 ${migratedProducts}개, 이미지 ${migratedImages}개를 Storage URL로 전환했습니다.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
