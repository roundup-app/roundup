import { afterEach, it } from "vitest";
import { actionSurvivesSurfaceClose, appAgentCases, tearDownActionTest } from "../testing/s3806b_support";

afterEach(tearDownActionTest);

it.each(appAgentCases)("s3806b_action_survives_surface_close: $row.owner $row.label by $how, pending reply $outcome", actionSurvivesSurfaceClose);
