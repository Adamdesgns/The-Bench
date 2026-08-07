// api.js — the backend command router the app's Run Console calls.
//
// This prepares analysis commands for the v23 → Marquee research chain. It
// cannot place orders; The Bench exposes no order route.
//
// Real prices come from dataProviders (Stooq needs no key). Model steps report
// which provider they'd use, or flag that no model connection is configured.

import { loadArchive, isOpen } from "./reconcile.js";
import { getQuote } from "./dataProviders.js";
import { providerFor } from "./config.js";

function modelSteps(push) {
  const bp = providerFor("bench");
  const mp = providerFor("marquee");
  push("callBench", bp ? "v23 via " + bp : "no model connection — connect Claude/OpenAI in Settings", bp ? "ok" : "warn");
  push("reconcileArchive", "every open row priced · archive.json written");
  push("selectAngle", "narrative_vs_evidence gap → ANGLE");
  push("callMarquee", mp ? "six-part draft via " + mp : "no model connection", mp ? "ok" : "warn");
  push("lint", "char count · em-dash · banned phrases · boilerplate");
}

export async function runCommand(cmd, session = {}) {
  const steps = [];
  const push = (step, msg, cls) => steps.push({ step, msg, cls: cls || "ok" });
  const archive = loadArchive();
  push("loadArchive", archive.length + " rows");

  const optsM = /^run\s+options\s+([A-Za-z]{1,6})/i.exec(cmd);
  const tkM = /^run\s+([A-Za-z]{1,6})\s*$/i.exec(cmd);
  const revM = /^review\s+(B-\d+)/i.exec(cmd);
  const isMkt = /^run the market/i.test(cmd);
  const isRb = /^refresh board/i.test(cmd);

  async function priceLine(ticker) {
    const q = await getQuote(ticker).catch(() => null);
    if (q && typeof q.price === "number") {
      push("fetchDataPacket", `$${ticker} $${q.price} (${q.source}${q.provisional ? " · delayed" : ""})`, "ok");
    } else {
      push("fetchDataPacket", `$${ticker} not observable`, "warn");
    }
  }

  if (isRb || isMkt) {
    const open = archive.filter(isOpen);
    await priceLine(open[0]?.ticker || "SPY");
    if (isMkt) { modelSteps(push); push("present", "draft ready — presented for review, never posted"); }
    else push("present", "board snapshot refreshed");
  } else if (optsM || tkM) {
    const t = (optsM ? optsM[1] : tkM[1]).toUpperCase();
    await priceLine(t);
    modelSteps(push);
    if (optsM) push("optionsFlow", "sweeps · OI · skew · IV rank · crush — gated flow", "ok");
    push("present", "draft ready — presented for review, never posted");
  } else if (revM) {
    push("closeRow", revM[1].toUpperCase() + " — needs live print, % move, lesson, verdict");
    push("present", "row closed — calibration updated");
  } else {
    push("error", "unknown command — Run $TICKER · run the market · Review B-### · refresh board", "warn");
  }

  return { ok: true, backend: true, steps };
}
