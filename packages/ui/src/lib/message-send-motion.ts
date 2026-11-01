/** Send motion sampled from F147–F190 of the owner's 2026-10-28 iMessage recording. */
export const messageSendMotion = {
  duration: 43 / 60,
  sampleInterval: 1 / 60,
  riseDelay: 2 / 60
} as const

// Each row contains horizontal closing, uniform glyph scale, glyph travel and history travel.
// F147 is the last draft frame; F148 is already partway through the contraction.
const samples = [
  [0, 1, 0, 0],
  [0.083_885, 0.957_895, 0, 0.014_388],
  [0.163_069, 0.936_842, 0, 0.093_525],
  [0.269_563, 0.915_789, 0.017_493, 0.208_633],
  [0.395_33, 0.894_737, 0.064_14, 0.338_129],
  [0.542_89, 0.866, 0.132_601, 0.460_432],
  [0.690_764, 0.836, 0.213_329, 0.568_345],
  [0.821_825, 0.807, 0.299_531, 0.654_676],
  [0.907_861, 0.784, 0.389_411, 0.733_813],
  [0.964_186, 0.77, 0.470_233, 0.791_367],
  [0.993_835, 0.764_706, 0.548_105, 0.848_921],
  [1, 0.764_706, 0.623_907, 0.884_892],
  [1, 0.770_053, 0.693_878, 0.906_475],
  [1, 0.780_749, 0.758_017, 0.935_252],
  [1, 0.796_791, 0.816_311, 0.949_64],
  [1, 0.818_182, 0.866_949, 0.964_029],
  [1, 0.839_572, 0.905_926, 0.971_223],
  [1, 0.860_963, 0.939_072, 0.978_417],
  [1, 0.882_353, 0.966_387, 0.985_612],
  [1, 0.898_396, 0.989_788, 0.992_806],
  [1, 0.914_439, 1.007_359, 0.992_806],
  [1, 0.930_481, 1.019_099, 1],
  [1, 0.946_524, 1.025_007, 1],
  [1, 0.957_219, 1.032_834, 1],
  [1, 0.967_914, 1.034_83, 1],
  [1, 0.973_262, 1.038_743, 1],
  [1, 0.983_957, 1.034_907, 1],
  [1, 0.989_305, 1.032_99, 1],
  [1, 0.989_305, 1.032_99, 1],
  [1, 0.994_652, 1.031_072, 1],
  [1, 0.994_652, 1.025_241, 1],
  [1, 1, 1.023_324, 1],
  [1, 1, 1.023_324, 1],
  [1, 1, 1.017_493, 1],
  [1, 1, 1.017_493, 1],
  [1, 1, 1.011_662, 1],
  [1, 1, 1.011_662, 1],
  [1, 1, 1.005_831, 1],
  [1, 1, 1.005_831, 1],
  [1, 1, 1.005_831, 1],
  [1, 1, 1.005_831, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1]
] as const

/** Preserve measured extrema instead of adding overshoot between adjacent video frames. */
function tangent(before: number, after: number): number {
  return before * after > 0 ? (2 * before * after) / (before + after) : 0
}

/** Interpolate the measured tracks continuously at any display refresh rate. */
export function getMessageSendPose(time: number) {
  const position = Math.max(
    0,
    Math.min(time / messageSendMotion.sampleInterval, samples.length - 1)
  )
  const index = Math.min(Math.floor(position), samples.length - 2)
  const fraction = position - index
  const before = samples[Math.max(0, index - 1)]
  const start = samples[index]
  const end = samples[index + 1]
  const after = samples[Math.min(samples.length - 1, index + 2)]
  const squared = fraction * fraction
  const cubed = squared * fraction

  /** Use shape-preserving cubic interpolation without changing any recorded sample. */
  function sample(channel: 0 | 1 | 2 | 3): number {
    const delta = end[channel] - start[channel]
    return (
      (2 * cubed - 3 * squared + 1) * start[channel] +
      (cubed - 2 * squared + fraction) * tangent(start[channel] - before[channel], delta) +
      (-2 * cubed + 3 * squared) * end[channel] +
      (cubed - squared) * tangent(delta, after[channel] - end[channel])
    )
  }

  return { contraction: sample(0), scale: sample(1), rise: sample(2), history: sample(3) }
}
