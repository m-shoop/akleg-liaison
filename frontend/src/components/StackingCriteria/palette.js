const AURORA_CLASSES = [
  "auroraColor1",
  "auroraColor2",
  "auroraColor3",
  "auroraColor4",
  "auroraColor5",
  "auroraColor6",
];

export const AURORA_THRESHOLD = 6;

export function paletteClassFor(criterionIndex, totalCount, styles) {
  if (totalCount > AURORA_THRESHOLD) return styles.monochromeColor;
  return styles[AURORA_CLASSES[criterionIndex % AURORA_CLASSES.length]];
}
