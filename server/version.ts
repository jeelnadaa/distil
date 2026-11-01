import { readFileSync } from "node:fs";

// The app's version, from package.json (shipped beside the server in every build).
export const APP_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
