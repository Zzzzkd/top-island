import { app } from "electron"
import { join } from "node:path"

export function scriptPath(name: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "scripts", name)
  }
  return join(app.getAppPath(), "resources", "scripts", name)
}
