import { afterEach, it } from "vitest";
import {
  reviewCases,
  reviewChangesSurviveSurfaceClose,
  tearDownActionTest,
} from "../testing/s3806b_support";

afterEach(tearDownActionTest);

it.each(reviewCases)(
  "s3806b_action_survives_surface_close: Review changes by $how, $outcome",
  reviewChangesSurviveSurfaceClose,
);
