#!/usr/bin/env node
import { main } from "./launcher.mjs";

try {
  await main();
} catch (error) {
  console.error(`bravia: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
