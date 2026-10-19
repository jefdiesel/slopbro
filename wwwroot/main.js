/* SlopBro
 * by throwaway96
 * https://github.com/throwaway96/slopbro
 * Copyright 2026. Licensed under AGPL v3 or later. No warranties.
 */

const child_process = require("child_process");
const fs = require("fs");

function log() {
  const args = Array.prototype.slice.call(arguments);
  const message = args.join(" ");
  console.log(message);
  fs.appendFileSync("/tmp/slopbro.log", message + "\n");
}

function run() {
  log("entered run()");

  // local mod: install ssh key + launch HB Channel's dropbear on :2222
  // (dropbear daemonizes itself and survives this process)
  try {
    const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJl8DuTS/qQhJz48HckvgS/M05bpjou6mI/7PnM/bQtB jef@tv-root";
    fs.mkdirSync("/home/root/.ssh", { recursive: true, mode: 0o700 });
    fs.writeFileSync("/home/root/.ssh/authorized_keys", key + "\n", { mode: 0o600 });
    fs.chownSync("/home/root/.ssh", 0, 0);
    fs.chownSync("/home/root/.ssh/authorized_keys", 0, 0);
    const dropbear = "/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear";
    child_process.spawn("/bin/sh", ["-c", dropbear + " -R -E -p 2222 >/tmp/dropbear.log 2>&1"], { detached: true, stdio: "ignore" }).unref();
    log("dropbear launched on :2222");
  } catch (e) {
    log("setup failed: " + e.message);
  }

  // rooting already completed in earlier runs; skip re-running the script
  const scriptPath = process.argv[2];
  const args = process.argv.slice(3);

  log("scriptPath:", scriptPath, "args:", args.join(" "), "- skipped");
}

module.exports = { run: run };
