// prompt-rewriter/lib/r2.ts
//
// Cloudflare R2 上传客户端,基于 @aws-sdk/client-s3(R2 兼容 S3 API)。
//
// 凭据**全部**从 env 读,代码里不出现明文 key:
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_ENDPOINT          (e.g. https://<account>.r2.cloudflarestorage.com)
//   R2_BUCKET            (e.g. lovart-assets)
//   R2_PUBLIC_BASE_URL   (可选,公开访问的 URL 前缀;不传就用 endpoint/bucket 拼
//                        但默认 endpoint 是私有访问,可能 GET 拿不到。
//                        启用 r2.dev 公开访问后填 https://pub-<id>.r2.dev,
//                        或自定义域名,或保持默认走预签名 URL)
//
// 上传逻辑是幂等的:用图的 sha-1 / etag 当 key 一部分,同一文件多次 put 等效。
// 这里用 task_id + filename 做 key(R2 自带 dedupe,且业务语义更直观)。

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 凭据未配置:请在 .env.local 设置 R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY"
    );
  }
  _client = new S3Client({
    region: "auto", // R2 不区分 region,固定填 "auto"
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // 默认 path-style:R2 兼容更稳
    forcePathStyle: true,
  });
  return _client;
}

function getBucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) {
    throw new Error("R2 bucket 未配置:请在 .env.local 设置 R2_BUCKET");
  }
  return b;
}

// 检查对象是否已存在(幂等优化:同 key 第二次上传时,直接跳过 put)
export async function r2HeadObject(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key })
    );
    return true;
  } catch (e) {
    // 404 / NoSuchKey 走 false;别的网络/权限错误抛出
    const code =
      (e as { name?: string; $metadata?: { httpStatusCode?: number } }).name ??
      "";
    const status = (e as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 404 || code === "NotFound" || code === "NoSuchKey") {
      return false;
    }
    throw e;
  }
}

// 上传字节到 R2,key 是 R2 内部路径(不含 bucket),body 是图片字节
export async function r2PutObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      // 缓存策略:图片 immutable,前 30 天浏览器缓存
      CacheControl: "public, max-age=2592000, immutable",
    })
  );
}

// 公网 URL 拼装。
// - 优先用 R2_PUBLIC_BASE_URL(用户在 R2 控制台启用 r2.dev 公开访问 / 绑定自定义域名后)
// - 没配就 fallback 到 endpoint/bucket 形式 —— 但这个 URL 默认私有,
//   外部 fetch 会 403。fallback 仅供调试,生产期望用户配 R2_PUBLIC_BASE_URL。
export function r2PublicUrl(key: string): string {
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, "")}/${key}`;
  }
  const endpoint = process.env.R2_ENDPOINT?.replace(/\/+$/, "") ?? "";
  return `${endpoint}/${getBucket()}/${key}`;
}

// 高阶 helper:确保 key 已上传(幂等),返回公网 URL
export async function r2EnsureUploaded(
  key: string,
  body: Buffer,
  contentType: string
): Promise<{ url: string; uploaded: boolean }> {
  const exists = await r2HeadObject(key);
  if (!exists) {
    await r2PutObject(key, body, contentType);
  }
  return { url: r2PublicUrl(key), uploaded: !exists };
}
