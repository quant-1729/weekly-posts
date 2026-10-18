// Opens a HEADED browser so the human signs in (magic link) themselves, then saves the session.
// This script never types credentials and never reads email.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { AUTH_FILE, parseArgs } from "./lib.mjs";

const { positional, flags } = parseArgs();
const baseUrl = positional[0] || flags.base;
if (!baseUrl) {
  console.error("Usage: npm run auth -- <baseUrl>   (for example: npm run auth -- http://localhost:3000)");
  process.exit(2);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(baseUrl);

console.log("\nA browser window is open at " + baseUrl + ".");
console.log("Sign in yourself (email link). When you can see the signed-in app, come back here.\n");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter here to save the session and close the browser... ");
rl.close();

fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
await context.storageState({ path: AUTH_FILE, indexedDB: true });
await browser.close();

console.log("\nSaved the session to " + AUTH_FILE);
console.log("REMINDER: it is a live login. It is git-ignored; delete demo-video/.auth/state.json after recording.");
