import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const metadataDirectory = resolve(root, "dist/.openai");

await mkdir(metadataDirectory, { recursive: true });
await cp(resolve(root, ".openai/hosting.json"), resolve(metadataDirectory, "hosting.json"));
await cp(resolve(root, "drizzle"), resolve(metadataDirectory, "drizzle"), {
  recursive: true,
  force: true,
});
