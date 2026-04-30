import { describe, it, expect } from "vitest";
import { paletteClassFor, AURORA_THRESHOLD } from "../palette.js";

const styles = {
  auroraColor1: "a1",
  auroraColor2: "a2",
  auroraColor3: "a3",
  auroraColor4: "a4",
  auroraColor5: "a5",
  auroraColor6: "a6",
  monochromeColor: "mono",
};

describe("paletteClassFor", () => {
  it("uses aurora colors when total count is at or below threshold", () => {
    for (let i = 0; i < AURORA_THRESHOLD; i++) {
      const cls = paletteClassFor(i, AURORA_THRESHOLD, styles);
      expect(cls).toBe(`a${i + 1}`);
    }
  });

  it("switches to monochrome for every row when total count exceeds threshold", () => {
    const total = AURORA_THRESHOLD + 1;
    for (let i = 0; i < total; i++) {
      expect(paletteClassFor(i, total, styles)).toBe("mono");
    }
  });

  it("cycles aurora colors if index exceeds palette size at threshold (defensive)", () => {
    expect(paletteClassFor(6, AURORA_THRESHOLD, styles)).toBe("a1");
  });
});
