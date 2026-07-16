// Turbo colormap (Google, polynomial approximation) for the DTS waterfall heatmap.
// Reference: https://ai.googleblog.com/2019/08/turbo-improved-rainbow-colormap-for.html

const TURBO_COEFFS = {
  r: [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943],
  g: [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604],
  b: [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973],
}

function poly(coeffs, t) {
  let x = 0
  let p = 1
  for (const c of coeffs) {
    x += c * p
    p *= t
  }
  return x
}

/** t in [0,1] -> [r,g,b] each 0-255. */
export function turbo(t) {
  const clamped = Math.min(1, Math.max(0, t))
  const r = Math.round(255 * Math.min(1, Math.max(0, poly(TURBO_COEFFS.r, clamped))))
  const g = Math.round(255 * Math.min(1, Math.max(0, poly(TURBO_COEFFS.g, clamped))))
  const b = Math.round(255 * Math.min(1, Math.max(0, poly(TURBO_COEFFS.b, clamped))))
  return [r, g, b]
}

const LUT_SIZE = 256
const TURBO_LUT = new Uint8ClampedArray(LUT_SIZE * 3)
for (let i = 0; i < LUT_SIZE; i++) {
  const [r, g, b] = turbo(i / (LUT_SIZE - 1))
  TURBO_LUT[i * 3] = r
  TURBO_LUT[i * 3 + 1] = g
  TURBO_LUT[i * 3 + 2] = b
}

/**
 * Map a value within [min, max] to an RGB triple using the precomputed turbo LUT.
 * Values outside the range are clamped.
 */
export function valueToRgb(value, min, max) {
  let t = max > min ? (value - min) / (max - min) : 0
  t = Math.min(1, Math.max(0, t))
  const idx = Math.round(t * (LUT_SIZE - 1))
  return [TURBO_LUT[idx * 3], TURBO_LUT[idx * 3 + 1], TURBO_LUT[idx * 3 + 2]]
}

export function valueToCss(value, min, max) {
  const [r, g, b] = valueToRgb(value, min, max)
  return `rgb(${r}, ${g}, ${b})`
}

/** CSS linear-gradient string sampling the turbo colormap, for a legend/colorbar swatch. */
export function turboGradientCss(steps = 12) {
  const stops = []
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    const [r, g, b] = turbo(t)
    stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(1)}%`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
