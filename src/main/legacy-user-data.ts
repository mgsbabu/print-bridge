// Must be the FIRST import in index.ts: store.ts / jobs/db.ts resolve
// app.getPath("userData") at import time.
//
// The app was renamed from "TailorApp Print Bridge" to "FabPos Print Bridge".
// Electron derives the userData folder from productName, so without this an
// upgraded install would look at an empty folder and lose its pairing token
// (bridge.json) and job history (jobs.db). If the old folder exists, keep using it.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const LEGACY_DIR_NAME = "TailorApp Print Bridge";

const legacy = path.join(app.getPath("appData"), LEGACY_DIR_NAME);
if (path.basename(app.getPath("userData")) !== LEGACY_DIR_NAME && fs.existsSync(legacy)) {
  app.setPath("userData", legacy);
}
