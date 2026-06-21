import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Application, Request, Response } from "express";
import { ENV } from "./env";

export function registerStorageProxy(app: Application) {
  app.get("/storage/:key(*)", async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>).key;
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!ENV.s3Endpoint || !ENV.s3AccessKey || !ENV.s3SecretKey || !ENV.s3Bucket) {
      res.status(500).send("Storage not configured");
      return;
    }

    try {
      const s3 = new S3Client({
        endpoint: ENV.s3Endpoint,
        region: ENV.s3Region || "eu-central",
        credentials: {
          accessKeyId: ENV.s3AccessKey,
          secretAccessKey: ENV.s3SecretKey,
        },
        forcePathStyle: true,
      });

      const command = new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key });
      const url = await getSignedUrl(s3, command, { expiresIn: 300 });

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage error");
    }
  });
}
