import { initializeClientRegistry, initializeOwnerRegistry } from "./xecutor/auth.js";
import { xecutorDataDir } from "./xecutor/runtime.js";

try {
  const root = xecutorDataDir();
  let created = false;
  try {
    const owner = initializeOwnerRegistry(root);
    created = true;
    process.stdout.write(`The Xecutor owner approval code was created at ${owner.path}.\n`);
    process.stdout.write("Save this code in your password manager. It is required to open the owner desk and is not stored in recoverable form.\n\n");
    process.stdout.write(`OWNER APPROVAL CODE\n${owner.code}\n\n`);
  } catch (error) {
    if (!/already exists/.test(error.message)) throw error;
    process.stdout.write("Owner approval registry already exists. It was not overwritten and its code cannot be reprinted.\n\n");
  }
  try {
    const result = initializeClientRegistry(root);
    created = true;
    process.stdout.write(`The Xecutor bot credentials were created at ${result.path}.\n`);
    process.stdout.write("Copy each token now. Only its SHA-256 hash is stored; these values cannot be recovered later.\n\n");
    for (const item of result.issued) process.stdout.write(`${item.id.toUpperCase()}\n${item.token}\n\n`);
  } catch (error) {
    if (!/already exists/.test(error.message)) throw error;
    process.stdout.write("Bot credential registry already exists. It was not overwritten and tokens cannot be reprinted.\n\n");
  }
  if (!created) process.stdout.write("No credentials changed.\n\n");
  process.stdout.write("LIVE BROKER ROUTE: ABSENT. These credentials can only submit, read, or withdraw proposals.\n");
} catch (error) {
  process.stderr.write(`Setup refused: ${error.message}\n`);
  process.exitCode = 1;
}
