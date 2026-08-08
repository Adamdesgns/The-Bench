import { createWebBetaAuth } from "../../server/webBeta.js";
import { createCloudReports } from "../../server/cloudReports.js";
import { verifyDispatchRequest } from "../../server/reportDispatch.js";

const auth = createWebBetaAuth();
const reports = createCloudReports({ auth });

export default async function reportWorker(request) {
  if (!verifyDispatchRequest(request, process.env.REPORT_DISPATCH_SECRET)) throw new Error("unauthorized report dispatch");
  const body = await request.json().catch(() => null);
  if (!/^[0-9a-f-]{36}$/i.test(String(body?.job_id || ""))) throw new Error("invalid report dispatch");
  await reports.processOne();
}

export const config = {
  background: true,
  path: "/internal/report-worker",
  method: "POST",
  region: "iad",
};
