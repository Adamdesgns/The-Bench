import { createWebBetaAuth } from "../../server/webBeta.js";
import { createCloudReports } from "../../server/cloudReports.js";
import { createWebApi } from "../../server/webApi.js";
import { createNetlifyDispatcher } from "../../server/reportDispatch.js";

const auth = createWebBetaAuth();
const reports = createCloudReports({ auth });
const dispatchReport = createNetlifyDispatcher({ appOrigin: auth.appOrigin, secret: process.env.REPORT_DISPATCH_SECRET });
const handler = createWebApi({ auth, reports, dispatchReport });

export default handler;

export const config = {
  path: "/api/*",
  region: "iad",
};
