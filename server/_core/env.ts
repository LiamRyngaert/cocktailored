export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3Region: process.env.S3_REGION ?? "eu-central",
  printifyApiToken: process.env.PRINTIFY_API_TOKEN ?? "",
  // Confirmed via admin.shop.debugShops — "My new store" is the only shop
  // this Printify token can see, and its real id is 25691872 (not the "1"
  // that appears in Printify's own dashboard URLs, which is just a route
  // index, not the API shop id).
  printifyShopId: process.env.PRINTIFY_SHOP_ID ?? "25691872",
  // The single LeadConnector webhook the bar's automations listen on.
  webhookUrl: process.env.LEADCONNECTOR_WEBHOOK_URL
    ?? "https://services.leadconnectorhq.com/hooks/8nDL9BCU3hp9982tGYT1/webhook-trigger/71aa3d40-0ead-46d9-9255-2bbe7caa770d",
  // Legacy stubs — unused, kept for compilation only
  appId: "",
  oAuthServerUrl: "",
  ownerOpenId: "",
  forgeApiUrl: "",
  forgeApiKey: "",
};
