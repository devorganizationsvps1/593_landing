import { describe, expect, it } from "vitest";
import { deriveBudgetKind } from "@/lib/integrations/meta/structure";

describe("deriveBudgetKind", () => {
  it("daily wins when both present", () => {
    expect(deriveBudgetKind("10000", "50000")).toBe("daily");
  });
  it("lifetime when only lifetime", () => {
    expect(deriveBudgetKind(null, "50000")).toBe("lifetime");
  });
  it("none when empty/zero", () => {
    expect(deriveBudgetKind(null, null)).toBe("none");
    expect(deriveBudgetKind("0", "0")).toBe("none");
  });
});
