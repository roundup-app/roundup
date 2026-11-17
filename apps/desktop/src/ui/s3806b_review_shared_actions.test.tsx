import { afterEach, it } from "vitest";
import { reviewChangesSurviveSurfaceClose, reviewSharedCases, tearDownActionTest } from "../testing/s3806b_support";

afterEach(tearDownActionTest);

it.each(reviewSharedCases)("s3806b_action_survives_surface_close: Review changes $readPath by $how, $removal, $outcome", reviewChangesSurviveSurfaceClose);
