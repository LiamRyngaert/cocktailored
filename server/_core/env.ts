export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Anthropic API (replaces Manus Forge proxy)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // Admin credentials (move out of source code)
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  // Hetzner Object Storage (S3-compatible)
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3Region: process.env.S3_REGION ?? "eu-central",
  // Legacy Manus stubs — unused in Vercel deployment, kept for compilation only
  forgeApiUrl: "",
  forgeApiKey: "",
  oAuthServerUrl: "",
  appId: "",
  ownerOpenId: "",
};
