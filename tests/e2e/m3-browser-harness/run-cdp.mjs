import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const chromePath = process.env.M3_CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const debugPort = 9222;
const root = resolve(process.cwd(), "services/identity-service");
const outputDir = join(root, "target", "m3-browser-harness");
const profileDir = join(outputDir, "chrome-profile");

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Chrome endpoint failed: ${response.status}`);
  return response.json();
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.open = new Promise((resolvePromise, rejectPromise) => {
      this.socket.addEventListener("open", () => resolvePromise());
      this.socket.addEventListener("error", (error) => rejectPromise(error));
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.open;
    const id = this.nextId++;
    const result = new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) throw new Error("browser evaluation failed");
  return result.result?.value;
}

await mkdir(outputDir, { recursive: true });
const chrome = spawn(chromePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "--headless=new",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--disable-gpu-sandbox",
  "--in-process-gpu",
  "--disable-gpu-compositing",
  "--use-angle=swiftshader",
  "--window-size=1280,900",
  "http://localhost:5173"
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  let page;
  for (let attempt = 0; attempt < 60 && !page; attempt++) {
    try {
      const pages = await json(`http://127.0.0.1:${debugPort}/json/list`);
      page = pages.find((candidate) => candidate.type === "page");
    } catch (_) {
      await sleep(250);
    }
  }
  if (!page) throw new Error("Chrome page did not start");

  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await sleep(1000);
  await evaluate(cdp, "document.querySelector('#run')?.click()");

  let body = "";
  for (let attempt = 0; attempt < 300; attempt++) {
    await sleep(1000);
    body = await evaluate(cdp, "document.body.innerText") ?? "";
    if (body.includes('"afterLogout"') || body.includes("Browser fixture failed")) break;
  }

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outputDir, "browser-proof.png"), Buffer.from(screenshot.data, "base64"));
  const pathname = await evaluate(cdp, "window.location.pathname");
  process.stdout.write(JSON.stringify({ pathname, body }));
  if (!body.includes('"afterLogout"')) process.exitCode = 1;
} finally {
  if (cdp) {
    try { await cdp.send("Browser.close"); } catch (_) { /* process cleanup below */ }
    cdp.close();
  }
  if (!chrome.killed) chrome.kill();
}
